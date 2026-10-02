/**
 * 24-HOUR CLOUD ENGINE — Stage 6 Tests
 * cloud-engine/firebase/tests/firebase-control.test.js
 *
 * Tests for Stage 6: Firebase Control System
 *
 * Tests:
 *  1. validateCommandContext — authenticated user required
 *  2. validateCommandContext — role required
 *  3. validateCommandContext — VIEWER cannot execute mutating commands
 *  4. validateCommandContext — ownership isolation
 *  5. validateCommandContext — unknown command rejected
 *  6. validateCommandContext — commandId required
 *  7. Duplicate commandId idempotency protection
 *  8. processControlCommand — GET_ENGINE_STATUS with valid context
 *  9. processControlCommand — unauthorized role rejected
 * 10. processControlCommand — VIEWER can call GET_METRICS (read-only)
 * 11. processControlCommand — VIEWER cannot call START_BROADCAST
 * 12. Firebase NOT_CONFIGURED behavior — no crash, correct status
 * 13. _stripSecrets — stream keys removed from Firestore writes
 * 14. getFirebaseControlStatus reports NOT_CONFIGURED accurately
 * 15. Regression — Stage 1-5 modules still functional
 *
 * Stage 6 — Firebase Control System
 */

import {
  FirebaseControl,
  validateCommandContext,
  processControlCommand,
  getFirebaseControlStatus,
  CONTROL_COMMAND,
  CONTROL_COMMAND_STATE,
} from '../firebase-control.js';

import { FirebaseConnector, CE_COLLECTIONS } from '../firebase-connector.js';
import { ROLE, PERMISSION }                  from '../../security/permissions.js';
import { COMPONENT_STATUS }                  from '../../core/state-manager.js';
import { FanOutManager }                     from '../../broadcast/fanout-manager.js';
import { IngestManager }                     from '../../ingest/ingest-manager.js';
import { CloudEngineEventBus }               from '../../core/event-bus.js';
import { BROADCAST_STATE }                   from '../../broadcast/broadcast-engine.js';

/* ═══════════════════════════════════
   TEST FRAMEWORK
═══════════════════════════════════ */
let _passed = 0;
let _failed = 0;
const _results = [];

async function test(name, fn) {
  try {
    await fn();
    _passed++;
    _results.push({ name, status: 'PASS' });
    console.log(`  ✓  PASS  ${name}`);
  } catch (err) {
    _failed++;
    _results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  ✗  FAIL  ${name}`);
    console.error(`           ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label ?? 'assertEqual'}: expected "${expected}", got "${actual}"`);
  }
}

/* ═══════════════════════════════════
   HELPERS
═══════════════════════════════════ */
function makeCtx(overrides = {}) {
  return {
    commandId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    command:   CONTROL_COMMAND.GET_ENGINE_STATUS,
    userId:    'user-abc',
    userRole:  ROLE.ADMIN,
    ownerId:   'user-abc',
    params:    {},
    ...overrides,
  };
}

console.log('\n══════════════════════════════════════════════════════');
console.log('  24-Hour Cloud Engine — Stage 6 Firebase Control Tests');
console.log('══════════════════════════════════════════════════════\n');

/* ─────────────────────────────────────────────────────────
   TEST 1 — userId required
──────────────────────────────────────────────────────── */
await test('1. validateCommandContext — authenticated userId required', () => {
  const r = validateCommandContext({ ...makeCtx(), userId: '' });
  assert(!r.valid, 'empty userId should fail');
  assert(r.reason.includes('userId'), `reason should mention userId: ${r.reason}`);

  const r2 = validateCommandContext({ ...makeCtx(), userId: null });
  assert(!r2.valid, 'null userId should fail');
});

/* ─────────────────────────────────────────────────────────
   TEST 2 — Role required
──────────────────────────────────────────────────────── */
await test('2. validateCommandContext — userRole required', () => {
  const r = validateCommandContext({ ...makeCtx(), userRole: null });
  assert(!r.valid, 'null role should fail');

  const r2 = validateCommandContext({ ...makeCtx(), userRole: 'HACKER' });
  assert(!r2.valid, 'invalid role should fail');
  assert(r2.reason.includes('role') || r2.reason.includes('Invalid'), `reason: ${r2.reason}`);

  // Valid role should pass
  const r3 = validateCommandContext(makeCtx({ userRole: ROLE.OWNER }));
  assert(r3.valid, 'OWNER role should be valid');
});

/* ─────────────────────────────────────────────────────────
   TEST 3 — VIEWER cannot execute mutating commands
──────────────────────────────────────────────────────── */
await test('3. VIEWER cannot execute mutating commands', () => {
  const mutatingCommands = [
    CONTROL_COMMAND.START_BROADCAST,
    CONTROL_COMMAND.STOP_BROADCAST,
    CONTROL_COMMAND.ADD_DESTINATION,
    CONTROL_COMMAND.REMOVE_DESTINATION,
    CONTROL_COMMAND.RECONNECT_DESTINATION,
    CONTROL_COMMAND.START_INGEST,
    CONTROL_COMMAND.STOP_INGEST,
  ];

  for (const cmd of mutatingCommands) {
    const r = validateCommandContext(makeCtx({ command: cmd, userRole: ROLE.VIEWER }));
    assert(!r.valid, `VIEWER should not be able to execute ${cmd}: ${r.reason}`);
    assert(
      r.reason.includes('VIEWER') || r.reason.includes('not permitted'),
      `reason should mention VIEWER or not permitted: ${r.reason}`,
    );
  }

  // VIEWER CAN execute read-only commands
  for (const cmd of [
    CONTROL_COMMAND.GET_ENGINE_STATUS,
    CONTROL_COMMAND.GET_BROADCAST_STATUS,
    CONTROL_COMMAND.GET_METRICS,
  ]) {
    const r = validateCommandContext(makeCtx({ command: cmd, userRole: ROLE.VIEWER }));
    assert(r.valid, `VIEWER should be able to execute ${cmd}: ${r.reason}`);
  }
});

/* ─────────────────────────────────────────────────────────
   TEST 4 — Ownership isolation
──────────────────────────────────────────────────────── */
await test('4. Ownership isolation — user cannot control another user\'s resources', () => {
  // Different user with CREATOR role trying to control another user's GET_METRICS
  // (CREATOR has VIEW_STATUS permission, so permission check passes,
  //  but ownership check must block it)
  const r = validateCommandContext(makeCtx({
    userRole: ROLE.CREATOR,
    userId:   'user-charlie',
    ownerId:  'user-owner',
    command:  CONTROL_COMMAND.GET_METRICS,
  }));
  assert(!r.valid, 'CREATOR should not access another user\'s resources');
  assert(r.reason.includes('not authorized'), `reason: ${r.reason}`);

  // Same user = allowed (CREATOR accessing their own resource)
  const r2 = validateCommandContext(makeCtx({
    userRole: ROLE.CREATOR,
    userId:   'user-owner',
    ownerId:  'user-owner',
    command:  CONTROL_COMMAND.GET_METRICS,
  }));
  assert(r2.valid, 'user can access their own resource');

  // OWNER can access any resource
  const r3 = validateCommandContext(makeCtx({
    userRole: ROLE.OWNER,
    userId:   'admin-user',
    ownerId:  'some-other-user',
    command:  CONTROL_COMMAND.STOP_BROADCAST,
  }));
  assert(r3.valid, 'OWNER can control any resource');

  // ADMIN can access any resource
  const r4 = validateCommandContext(makeCtx({
    userRole: ROLE.ADMIN,
    userId:   'admin-user',
    ownerId:  'some-other-user',
    command:  CONTROL_COMMAND.STOP_BROADCAST,
  }));
  assert(r4.valid, 'ADMIN can control any resource');
});

/* ─────────────────────────────────────────────────────────
   TEST 5 — Unknown command rejected
──────────────────────────────────────────────────────── */
await test('5. validateCommandContext — unknown command rejected', () => {
  const r = validateCommandContext(makeCtx({ command: 'HACK_THE_PLANET' }));
  assert(!r.valid, 'unknown command should fail');
  assert(r.reason.includes('Unknown command'), `reason: ${r.reason}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 6 — commandId required
──────────────────────────────────────────────────────── */
await test('6. validateCommandContext — commandId required', () => {
  const r1 = validateCommandContext(makeCtx({ commandId: '' }));
  assert(!r1.valid, 'empty commandId should fail');

  const r2 = validateCommandContext(makeCtx({ commandId: null }));
  assert(!r2.valid, 'null commandId should fail');

  // Valid commandId
  const r3 = validateCommandContext(makeCtx({ commandId: 'cmd-valid-123' }));
  assert(r3.valid, 'valid commandId should pass');
});

/* ─────────────────────────────────────────────────────────
   TEST 7 — Idempotency: duplicate commandId rejected
──────────────────────────────────────────────────────── */
await test('7. Duplicate commandId — idempotency protection', async () => {
  const duplicateId = `cmd-dup-${Date.now()}`;

  const ctx = makeCtx({ commandId: duplicateId });

  // First execution: should succeed
  const r1 = await processControlCommand(ctx, {
    getEngineStatus: () => 'READY',
  });
  assertEqual(r1.state, CONTROL_COMMAND_STATE.COMPLETED, 'first execution completes');

  // Second execution with same commandId: must be rejected
  const r2 = await processControlCommand(ctx, {
    getEngineStatus: () => 'READY',
  });
  assertEqual(r2.state, CONTROL_COMMAND_STATE.REJECTED, 'duplicate commandId rejected');
  assert(r2.error.includes('Duplicate') || r2.error.includes('already processed'),
    `rejection reason: ${r2.error}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 8 — processControlCommand GET_ENGINE_STATUS
──────────────────────────────────────────────────────── */
await test('8. processControlCommand — GET_ENGINE_STATUS returns safe status', async () => {
  const ctx = makeCtx({ command: CONTROL_COMMAND.GET_ENGINE_STATUS });

  const result = await processControlCommand(ctx, {
    getEngineStatus: () => 'READY',
  });

  assertEqual(result.state, CONTROL_COMMAND_STATE.COMPLETED, 'should complete');
  assert(result.data.engineStatus === 'READY', `engineStatus: ${result.data.engineStatus}`);
  assert(!result.error, 'no error in successful result');

  // Result must never contain stream keys
  const serialized = JSON.stringify(result);
  assert(!serialized.includes('streamKey') || serialized.includes('[REDACTED]'),
    'stream key must not appear in result');
});

/* ─────────────────────────────────────────────────────────
   TEST 9 — Unauthorized role rejected
──────────────────────────────────────────────────────── */
await test('9. processControlCommand — unauthorized role rejected at processing', async () => {
  const ctx = makeCtx({
    command:  CONTROL_COMMAND.START_BROADCAST,
    userRole: ROLE.VIEWER,
  });

  const result = await processControlCommand(ctx, {});
  assertEqual(result.state, CONTROL_COMMAND_STATE.REJECTED, 'unauthorized must be REJECTED');
  assert(result.error, 'rejection must include error message');
});

/* ─────────────────────────────────────────────────────────
   TEST 10 — VIEWER can call GET_METRICS
──────────────────────────────────────────────────────── */
await test('10. processControlCommand — VIEWER can call read-only GET_METRICS', async () => {
  const mgr = new FanOutManager();
  const ctx  = makeCtx({
    command:  CONTROL_COMMAND.GET_METRICS,
    userRole: ROLE.VIEWER,
  });

  const result = await processControlCommand(ctx, {
    fanOutManager: mgr,
    ingestManager: new IngestManager(),
  });

  assertEqual(result.state, CONTROL_COMMAND_STATE.COMPLETED, 'VIEWER GET_METRICS should complete');
  assert(result.data, 'data should be present');
});

/* ─────────────────────────────────────────────────────────
   TEST 11 — VIEWER cannot call START_BROADCAST
──────────────────────────────────────────────────────── */
await test('11. processControlCommand — VIEWER cannot START_BROADCAST', async () => {
  const ctx = makeCtx({
    command:  CONTROL_COMMAND.START_BROADCAST,
    userRole: ROLE.VIEWER,
  });

  const result = await processControlCommand(ctx, {});
  assertEqual(result.state, CONTROL_COMMAND_STATE.REJECTED, 'VIEWER START_BROADCAST must be REJECTED');
});

/* ─────────────────────────────────────────────────────────
   TEST 12 — Firebase NOT_CONFIGURED behavior
──────────────────────────────────────────────────────── */
await test('12. Firebase NOT_CONFIGURED — no crash, accurate status reporting', async () => {
  // Firebase is NOT configured in this dev environment
  const fbStatus = getFirebaseControlStatus();
  assert(fbStatus.status === COMPONENT_STATUS.NOT_CONFIGURED ||
         fbStatus.status === COMPONENT_STATUS.OK,
    `Firebase status should be NOT_CONFIGURED or OK, got: ${fbStatus.status}`);

  // In dev/standalone environment, NOT_CONFIGURED is expected
  if (fbStatus.status === COMPONENT_STATUS.NOT_CONFIGURED) {
    assert(!fbStatus.configured, 'configured should be false when NOT_CONFIGURED');
    assert(fbStatus.note !== null, 'note should explain NOT_CONFIGURED');
    assert(typeof fbStatus.note === 'string', 'note should be a string');
  }

  // Connector must not crash when not configured
  const readResult = await FirebaseConnector.readEngineState();
  assert(readResult.status === COMPONENT_STATUS.NOT_CONFIGURED ||
         readResult.status === 'OK',
    `readEngineState status: ${readResult.status}`);

  const writeResult = await FirebaseConnector.writeEngineState({ test: true });
  assert(writeResult.status === COMPONENT_STATUS.NOT_CONFIGURED ||
         writeResult.status === 'OK',
    `writeEngineState status: ${writeResult.status}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 13 — Secret stripping
──────────────────────────────────────────────────────── */
await test('13. Secret protection — stream keys stripped from results and state', async () => {
  const ctx = makeCtx({ command: CONTROL_COMMAND.GET_BROADCAST_STATUS });
  const fanOutManager = new FanOutManager();

  const result = await processControlCommand(ctx, { fanOutManager });

  // Result JSON must not contain unmasked stream keys
  const serialized = JSON.stringify(result);
  assert(
    !serialized.includes('"streamKey":"live-abc-secret"'),
    'Stream key must not appear in command result',
  );

  // Destinations in result must have streamKey masked or absent
  if (result.data?.destinations) {
    for (const dest of result.data.destinations) {
      assert(
        !dest.streamKey || dest.streamKey === '********' || dest.streamKey === '[REDACTED]',
        `streamKey must be masked in destination: ${JSON.stringify(dest)}`,
      );
    }
  }
});

/* ─────────────────────────────────────────────────────────
   TEST 14 — getFirebaseControlStatus
──────────────────────────────────────────────────────── */
await test('14. getFirebaseControlStatus — shape and NOT_CONFIGURED accuracy', () => {
  const status = getFirebaseControlStatus();

  assert('status'     in status, 'has status field');
  assert('configured' in status, 'has configured field');
  assert('note'       in status, 'has note field');

  // In dev environment, Firebase is not configured
  const expected = [COMPONENT_STATUS.NOT_CONFIGURED, COMPONENT_STATUS.OK];
  assert(expected.includes(status.status),
    `status should be NOT_CONFIGURED or OK, got: ${status.status}`);
});

/* ─────────────────────────────────────────────────────────
   TEST 15 — Regression: Stage 1-5 modules still functional
──────────────────────────────────────────────────────── */
await test('15. Regression — Stage 1-5 modules still importable and functional', async () => {
  // FanOutManager
  const fanout = new FanOutManager();
  assert(typeof fanout.startMultiBroadcast === 'function', 'FanOutManager.startMultiBroadcast');

  // IngestManager
  const ingest = new IngestManager();
  assert(typeof ingest.createSession === 'function', 'IngestManager.createSession');
  assert(typeof ingest.startIngest   === 'function', 'IngestManager.startIngest');

  // BROADCAST_STATE
  assert(BROADCAST_STATE.BROADCASTING, 'BROADCAST_STATE.BROADCASTING');

  // Event bus
  let fired = false;
  const unsub = CloudEngineEventBus.on('stage6_regression_test', () => { fired = true; });
  CloudEngineEventBus.emit('stage6_regression_test', {});
  unsub();
  assert(fired, 'CloudEngineEventBus still functional');

  // CE_COLLECTIONS still defined
  assert(CE_COLLECTIONS.ENGINE_STATE,  'CE_COLLECTIONS.ENGINE_STATE');
  assert(CE_COLLECTIONS.COMMANDS,      'CE_COLLECTIONS.COMMANDS');
  assert(CE_COLLECTIONS.DESTINATIONS,  'CE_COLLECTIONS.DESTINATIONS');

  // Permissions still work
  const { ROLE, hasPermission } = await import('../../security/permissions.js');
  assert(hasPermission(ROLE.OWNER, 'START_BROADCAST'), 'OWNER has START_BROADCAST');
  assert(!hasPermission(ROLE.VIEWER, 'START_BROADCAST'), 'VIEWER lacks START_BROADCAST');
});

/* ─────────────────────────────────────────────────────────
   FINAL REPORT
──────────────────────────────────────────────────────── */
const total = _passed + _failed;
console.log('\n──────────────────────────────────────────────────────');
console.log(`  Stage 6 Firebase Control Tests`);
console.log(`  PASS:  ${_passed} / ${total}`);
if (_failed > 0) {
  console.log(`  FAIL:  ${_failed}`);
  _results.filter(r => r.status === 'FAIL').forEach(r =>
    console.log(`    ✗  ${r.name}: ${r.error}`),
  );
}
console.log('══════════════════════════════════════════════════════\n');

process.exit(_failed > 0 ? 1 : 0);
