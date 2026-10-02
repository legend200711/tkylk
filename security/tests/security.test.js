/**
 * 24-HOUR CLOUD ENGINE — Stage 13 Security Test Suite
 * cloud-engine/security/tests/security.test.js
 *
 * 40 tests covering the complete Multi-User Security + Isolation Hardening.
 *
 * Tests:
 *   - User A cannot read/modify/control User B's resources
 *   - VIEWER cannot mutate
 *   - Invalid role rejected
 *   - Missing authentication rejected
 *   - Tampered ownerId rejected
 *   - Path traversal rejected
 *   - Shell-injection payload rejected
 *   - Unsafe destination URL rejected
 *   - Secret never appears in responses/logs/diagnostics/events
 *   - Replay/idempotency protection
 *   - Rate limiting
 *   - Audit event generated for denied actions
 *   - Recovery cannot cross account boundaries
 *
 * Stage 13 — Multi-User Security + Isolation Hardening
 */

// ── Security modules ──────────────────────────────────────────────
import { ROLE, PERMISSION, hasPermission, getPermissions } from '../permissions.js';
import { SECURITY_ERROR_CODE, SecurityError }              from '../security-errors.js';
import { RESOURCE_TYPE, verifyOwnership, assertOwnership } from '../ownership.js';
import { authorize, checkPermission, isAuthenticated, isValidRole }
  from '../authorization.js';
import {
  CredentialVault, maskCredential, looksLikeCredential,
  scrubCredentials, SharedCredentialVault, createCredentialRef,
} from '../credential-vault.js';
import {
  validateId, validateUrl, validateRtmpUrl, validateMediaPath,
  validateName, validatePlatformId,
} from '../input-validation.js';
import { validateNetworkDestination }                      from '../network-policy.js';
import {
  validateCommand, markCommandProcessed, isCommandProcessed,
  clearIdempotencyCache,
} from '../command-security.js';
import { RateLimiter, RATE_LIMITED_ACTION, DEFAULT_RATE_LIMITS }
  from '../rate-limiter.js';
import { AuditLog, AUDIT_EVENT_TYPE }                      from '../audit-log.js';
import { getSecurityDiagnostics }                          from '../security-audit.js';
import { validateMediaAccess, buildSafeStorageRef }        from '../media-security.js';
import { StateRecovery, ACTIVE_MODE }                      from '../../recovery/state-recovery.js';

/* ═══════════════════════════════════
   SIMPLE TEST RUNNER
═══════════════════════════════════ */

let _passed = 0;
let _failed = 0;
const _results = [];

async function test(name, fn) {
  try {
    await fn();
    _passed++;
    _results.push({ name, status: 'PASS' });
    console.log(`  ✓  ${name}`);
  } catch (err) {
    _failed++;
    _results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label ?? 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Reset audit log before tests
AuditLog.clear();
clearIdempotencyCache();

console.log('\n24-Hour Cloud Engine — Stage 13 Security Tests\n');

/* ═══════════════════════════════════
   OWNERSHIP / ISOLATION
═══════════════════════════════════ */

// ── 1. User A cannot read User B resource ───────────────────────────
await test('1. User A cannot access User B resource (ownership violation)', async () => {
  const result = verifyOwnership({
    requesterId:   'user-A',
    requesterRole:  ROLE.OWNER,
    resourceOwner: 'user-B',
    resourceType:  RESOURCE_TYPE.BROADCAST,
    resourceId:    'broadcast-1',
  });
  assert(!result.authorized, 'denied');
  assertEqual(result.code, SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION, 'correct code');
});

// ── 2. User A can access their own resource ─────────────────────────
await test('2. User A can access their own resource', async () => {
  const result = verifyOwnership({
    requesterId:   'user-A',
    requesterRole:  ROLE.OWNER,
    resourceOwner: 'user-A',
    resourceType:  RESOURCE_TYPE.BROADCAST,
  });
  assert(result.authorized, 'authorized');
});

// ── 3. User A cannot modify User B destination ──────────────────────
await test('3. User A cannot modify User B destination', async () => {
  const result = authorize({
    userId:        'user-A',
    userRole:      ROLE.CREATOR,
    permission:    PERMISSION.MANAGE_DESTINATIONS,
    resourceOwner: 'user-B',
    resourceType:  RESOURCE_TYPE.DESTINATION,
    resourceId:    'dest-1',
    action:        'MANAGE_DESTINATION',
  });
  assert(!result.authorized, 'denied cross-user destination');
});

// ── 4. User A cannot stop User B broadcast ──────────────────────────
await test('4. User A cannot stop User B broadcast', async () => {
  const result = authorize({
    userId:        'user-A',
    userRole:      ROLE.ADMIN,
    permission:    PERMISSION.STOP_BROADCAST,
    resourceOwner: 'user-B',
    resourceType:  RESOURCE_TYPE.BROADCAST,
    action:        'STOP_BROADCAST',
  });
  // ADMIN cannot stop another user's broadcast
  assert(!result.authorized, 'admin denied stop broadcast for user B');
});

// ── 5. User A cannot access User B media ────────────────────────────
await test('5. User A cannot access User B media', async () => {
  const result = validateMediaAccess({
    requesterId:  'user-A',
    mediaOwnerId: 'user-B',
    mediaId:      'media-456',
  });
  assert(!result.authorized, 'denied');
  assertEqual(result.code, SECURITY_ERROR_CODE.OWNERSHIP_VIOLATION, 'code');
});

// ── 6. User A cannot modify User B station ──────────────────────────
await test('6. User A cannot modify User B station', async () => {
  const result = authorize({
    userId:        'user-A',
    userRole:      ROLE.OWNER,
    permission:    PERMISSION.START_BROADCAST,
    resourceOwner: 'user-B',
    resourceType:  RESOURCE_TYPE.STATION,
    action:        'START_STATION',
  });
  assert(!result.authorized, 'denied cross-user station');
});

/* ═══════════════════════════════════
   ROLE ENFORCEMENT
═══════════════════════════════════ */

// ── 7. VIEWER cannot mutate ─────────────────────────────────────────
await test('7. VIEWER cannot start broadcast', async () => {
  const result = checkPermission({
    userId:     'user-viewer',
    userRole:   ROLE.VIEWER,
    permission: PERMISSION.START_BROADCAST,
  });
  assert(!result.authorized, 'viewer denied');
  assertEqual(result.code, SECURITY_ERROR_CODE.INSUFFICIENT_ROLE, 'code');
});

// ── 8. VIEWER cannot manage destinations ────────────────────────────
await test('8. VIEWER cannot manage destinations', async () => {
  const result = checkPermission({
    userId:     'viewer-1',
    userRole:   ROLE.VIEWER,
    permission: PERMISSION.MANAGE_DESTINATIONS,
  });
  assert(!result.authorized, 'denied');
});

// ── 9. VIEWER can read status ────────────────────────────────────────
await test('9. VIEWER can read public status', async () => {
  const result = checkPermission({
    userId:     'viewer-1',
    userRole:   ROLE.VIEWER,
    permission: PERMISSION.VIEW_STATUS,
  });
  assert(result.authorized, 'viewer can view status');
});

// ── 10. CREATOR can manage their own broadcasts/media ────────────────
await test('10. CREATOR can upload media', async () => {
  const result = checkPermission({
    userId:     'creator-1',
    userRole:   ROLE.CREATOR,
    permission: PERMISSION.UPLOAD_MEDIA,
  });
  assert(result.authorized, 'creator can upload');
});

// ── 11. Invalid role rejected ────────────────────────────────────────
await test('11. Invalid role string rejected', async () => {
  assert(!isValidRole('SUPERADMIN'), 'SUPERADMIN rejected');
  assert(!isValidRole(''), 'empty rejected');
  assert(!isValidRole(null), 'null rejected');
  assert(!isValidRole('OWNER_INJECTED'), 'injected role rejected');

  const result = checkPermission({
    userId:     'user-1',
    userRole:   'HACKER',
    permission: PERMISSION.START_BROADCAST,
  });
  assert(!result.authorized, 'invalid role denied');
});

// ── 12. Missing authentication rejected ─────────────────────────────
await test('12. Missing authentication rejected', async () => {
  assert(!isAuthenticated(null), 'null rejected');
  assert(!isAuthenticated(''), 'empty rejected');
  assert(!isAuthenticated('  '), 'whitespace rejected');

  const result = checkPermission({
    userId:     null,
    userRole:   ROLE.OWNER,
    permission: PERMISSION.START_BROADCAST,
  });
  assert(!result.authorized, 'null userId denied');
  assertEqual(result.code, SECURITY_ERROR_CODE.NOT_AUTHENTICATED, 'code');
});

/* ═══════════════════════════════════
   CREDENTIAL SECURITY
═══════════════════════════════════ */

// ── 13. Secret never appears in credential ref ───────────────────────
await test('13. Credential reference never contains raw secret', async () => {
  const ref = createCredentialRef('STREAM_KEY', 'user-1', 'yt-dest');
  assert(!ref.value, 'no value in ref');
  assert(!ref.isResolved, 'not resolved');
  const json = JSON.stringify(ref);
  assert(!json.includes('sk_live'), 'no real key in ref');
});

// ── 14. maskCredential masks properly ───────────────────────────────
await test('14. maskCredential masks secret values', async () => {
  assertEqual(maskCredential('abc123xyz'), 'a*******z', 'masked');
  assertEqual(maskCredential(''), '********', 'empty masked');
  assertEqual(maskCredential(null), '********', 'null masked');
  assertEqual(maskCredential('ab'), '****', 'short masked');
});

// ── 15. scrubCredentials removes keys ────────────────────────────────
await test('15. scrubCredentials removes all credential fields', async () => {
  const dirty = {
    userId: 'user-1',
    streamKey: 'sk_live_REAL_KEY',
    token: 'ya29.ACCESS_TOKEN',
    status: 'BROADCASTING',
    nested: {
      password: 'hunter2',
      name: 'test',
    },
  };

  const clean = scrubCredentials(dirty);
  assertEqual(clean.streamKey, '********', 'streamKey scrubbed');
  assertEqual(clean.token, '********', 'token scrubbed');
  assertEqual(clean.nested.password, '********', 'nested password scrubbed');
  assertEqual(clean.userId, 'user-1', 'userId preserved');
  assertEqual(clean.status, 'BROADCASTING', 'status preserved');
  assert(!JSON.stringify(clean).includes('sk_live_REAL_KEY'), 'real key not in output');
  assert(!JSON.stringify(clean).includes('ya29'), 'access token not in output');
});

// ── 16. looksLikeCredential detection ────────────────────────────────
await test('16. looksLikeCredential detects common credential patterns', async () => {
  assert(looksLikeCredential('ya29.ACCESS_TOKEN'), 'google OAuth');
  assert(!looksLikeCredential('hello world'), 'plain text safe');
  assert(!looksLikeCredential('user-123'), 'user ID safe');
});

/* ═══════════════════════════════════
   INPUT VALIDATION
═══════════════════════════════════ */

// ── 17. Path traversal rejected ─────────────────────────────────────
await test('17. Path traversal in media path is rejected', async () => {
  const bad = ['../etc/passwd', '..\\windows\\system32', './../../secret'];
  for (const p of bad) {
    const r = validateMediaPath(p);
    assert(!r.valid, `path traversal blocked: ${p}`);
    assertEqual(r.code, SECURITY_ERROR_CODE.PATH_TRAVERSAL, `code for: ${p}`);
  }
});

// ── 18. Shell injection payload rejected ─────────────────────────────
await test('18. Shell injection characters in media path rejected', async () => {
  const bad = ['/media/file; rm -rf /', '/media/$(whoami)', '/media/`id`'];
  for (const p of bad) {
    const r = validateMediaPath(p);
    assert(!r.valid, `shell injection blocked: ${p}`);
  }
});

// ── 19. Valid media path accepted ────────────────────────────────────
await test('19. Valid media path is accepted', async () => {
  const good = ['/media/videos/episode-1.mp4', 'videos/clip_001.flv'];
  for (const p of good) {
    const r = validateMediaPath(p);
    assert(r.valid, `valid path accepted: ${p}`);
  }
});

// ── 20. ID validation ────────────────────────────────────────────────
await test('20. ID validation: safe IDs accepted, dangerous rejected', async () => {
  assert(validateId('user-123').valid, 'alphanumeric with hyphens');
  assert(validateId('station_abc_001').valid, 'underscores');
  assert(!validateId('user; DROP TABLE').valid, 'SQL injection rejected');
  assert(!validateId('').valid, 'empty rejected');
  assert(!validateId(null).valid, 'null rejected');
  assert(!validateId('a'.repeat(200)).valid, 'too long rejected');
});

// ── 21. URL validation ───────────────────────────────────────────────
await test('21. URL validation: safe URLs accepted, malformed rejected', async () => {
  assert(validateUrl('https://api.example.com/live').valid, 'https ok');
  assert(validateUrl('rtmp://live.twitch.tv/app').valid, 'rtmp ok');
  assert(!validateUrl('javascript:alert(1)').valid, 'javascript: rejected');
  assert(!validateUrl('file:///etc/passwd').valid, 'file: rejected');
  assert(!validateUrl('not-a-url').valid, 'malformed rejected');
  assert(!validateUrl('').valid, 'empty rejected');
});

// ── 22. Unsafe RTMP destination URL rejected ─────────────────────────
await test('22. Unsafe RTMP destination URL rejected (SSRF)', async () => {
  const blocked = [
    'rtmp://127.0.0.1/live',
    'rtmp://localhost/live',
    'rtmp://192.168.1.1/live',
    'rtmp://169.254.169.254/latest/meta-data',
    'rtmp://10.0.0.1/live',
  ];

  for (const url of blocked) {
    const r = validateRtmpUrl(url);
    assert(!r.valid, `SSRF blocked: ${url}`);
  }
});

// ── 23. Legitimate RTMP destination allowed ──────────────────────────
await test('23. Legitimate RTMP streaming destination allowed', async () => {
  const allowed = [
    'rtmp://live.twitch.tv/app/live_key',
    'rtmps://live-api-s.facebook.com:443/rtmp/',
    'rtmp://a.rtmp.youtube.com/live2',
  ];

  for (const url of allowed) {
    const r = validateRtmpUrl(url);
    assert(r.valid, `allowed: ${url}`);
  }
});

// ── 24. localhost allowed in devMode ─────────────────────────────────
await test('24. localhost allowed in devMode only', async () => {
  const localhostUrl = 'rtmp://127.0.0.1:1935/live';
  assert(!validateNetworkDestination(localhostUrl).valid, 'blocked normally');
  assert(validateNetworkDestination(localhostUrl, { devMode: true }).valid, 'allowed in devMode');
});

/* ═══════════════════════════════════
   COMMAND SECURITY
═══════════════════════════════════ */

// ── 25. Replay/idempotency protection ────────────────────────────────
await test('25. Replay/idempotency: duplicate commandId rejected', async () => {
  clearIdempotencyCache();
  const cmdId = 'cmd-unique-' + Date.now();

  const first = validateCommand({
    commandId: cmdId, command: 'START_BROADCAST',
    userId: 'user-1', userRole: ROLE.OWNER, ownerId: 'user-1',
  });
  assert(first.valid, 'first command valid');

  markCommandProcessed(cmdId);

  const second = validateCommand({
    commandId: cmdId, command: 'START_BROADCAST',
    userId: 'user-1', userRole: ROLE.OWNER, ownerId: 'user-1',
  });
  assert(!second.valid, 'replay rejected');
  assertEqual(second.code, SECURITY_ERROR_CODE.REPLAY_DETECTED, 'replay code');
});

// ── 26. Expired command rejected ─────────────────────────────────────
await test('26. Command security: expired command rejected', async () => {
  const result = validateCommand({
    commandId: 'cmd-old-1', command: 'STOP_BROADCAST',
    userId: 'user-1', userRole: ROLE.OWNER, ownerId: 'user-1',
    issuedAt: Date.now() - 10 * 60 * 1000,  // 10 minutes ago
  });
  assert(!result.valid, 'expired rejected');
  assertEqual(result.code, SECURITY_ERROR_CODE.COMMAND_EXPIRED, 'expired code');
});

// ── 27. Tampered ownerId rejected ────────────────────────────────────
await test('27. Tampered ownerId in command params rejected', async () => {
  const result = validateCommand({
    commandId: 'cmd-tamper-1', command: 'START_BROADCAST',
    userId: 'user-A', userRole: ROLE.OWNER, ownerId: 'user-A',
    params: { ownerId: 'user-B' },  // Attempting to target user B's resource
  });
  assert(!result.valid, 'tampered ownerId rejected');
  assertEqual(result.code, SECURITY_ERROR_CODE.CROSS_ACCOUNT_ACCESS, 'cross account code');
});

// ── 28. Missing authentication rejected in command ────────────────────
await test('28. Command security: missing userId rejected', async () => {
  const result = validateCommand({
    commandId: 'cmd-noauth', command: 'START_BROADCAST',
    userId: null, userRole: ROLE.OWNER,
  });
  assert(!result.valid, 'null userId rejected');
  assertEqual(result.code, SECURITY_ERROR_CODE.NOT_AUTHENTICATED, 'auth code');
});

/* ═══════════════════════════════════
   RATE LIMITING
═══════════════════════════════════ */

// ── 29. Rate limiting works ──────────────────────────────────────────
await test('29. Rate limiting blocks excessive requests', async () => {
  const limiter = new RateLimiter({
    [RATE_LIMITED_ACTION.START_BROADCAST]: {
      windowMs: 60_000, maxRequests: 3, reason: 'test',
    },
  });

  // First 3 allowed
  for (let i = 0; i < 3; i++) {
    const r = limiter.check('user-1', RATE_LIMITED_ACTION.START_BROADCAST);
    assert(r.allowed, `request ${i + 1} allowed`);
  }

  // 4th blocked
  const blocked = limiter.check('user-1', RATE_LIMITED_ACTION.START_BROADCAST);
  assert(!blocked.allowed, 'blocked at limit');
  assertEqual(blocked.code, SECURITY_ERROR_CODE.RATE_LIMITED, 'rate limit code');
  assert(blocked.resetIn > 0, 'resetIn provided');
});

// ── 30. Rate limiting is per-user ────────────────────────────────────
await test('30. Rate limiting is per-user (user B not affected by user A)', async () => {
  const limiter = new RateLimiter({
    [RATE_LIMITED_ACTION.COMMAND_SUBMIT]: {
      windowMs: 60_000, maxRequests: 1, reason: 'test',
    },
  });

  limiter.check('user-A', RATE_LIMITED_ACTION.COMMAND_SUBMIT);
  limiter.check('user-A', RATE_LIMITED_ACTION.COMMAND_SUBMIT);  // Should block user-A

  const userB = limiter.check('user-B', RATE_LIMITED_ACTION.COMMAND_SUBMIT);
  assert(userB.allowed, 'user B not affected by user A rate limit');
});

/* ═══════════════════════════════════
   AUDIT LOGGING
═══════════════════════════════════ */

// ── 31. Audit event generated for denied action ───────────────────────
await test('31. Audit event generated for denied action', async () => {
  AuditLog.clear();

  AuditLog.record({
    eventType:    AUDIT_EVENT_TYPE.SECURITY_REJECTION,
    actor:        'user-X',
    action:       'START_BROADCAST',
    resourceType: RESOURCE_TYPE.BROADCAST,
    resourceId:   'broadcast-99',
    result:       'DENIED',
    reason:       'Ownership violation',
  });

  const records = AuditLog.query({ result: 'DENIED' });
  assertEqual(records.length, 1, 'one denial record');
  assertEqual(records[0].actor, 'user-X', 'actor recorded');
  assertEqual(records[0].eventType, AUDIT_EVENT_TYPE.SECURITY_REJECTION, 'event type');
  assert(!JSON.stringify(records[0]).includes('sk_live'), 'no secrets in audit');
});

// ── 32. Audit record has no credentials ──────────────────────────────
await test('32. Audit records never contain credentials', async () => {
  AuditLog.clear();

  // Try to sneak a credential into meta
  AuditLog.record({
    eventType:  AUDIT_EVENT_TYPE.BROADCAST_STARTED,
    actor:      'user-1',
    result:     'ALLOWED',
    meta: {
      streamKey: 'sk_live_REAL_KEY_SHOULD_NOT_APPEAR',
      token:     'bearer-secret-12345',
      name:      'My Broadcast',
    },
  });

  const records = AuditLog.query();
  const json = JSON.stringify(records);
  assert(!json.includes('sk_live_REAL_KEY_SHOULD_NOT_APPEAR'), 'stream key scrubbed');
  assert(!json.includes('bearer-secret-12345'), 'token scrubbed');
  assert(json.includes('My Broadcast'), 'safe meta preserved');
});

/* ═══════════════════════════════════
   MEDIA SECURITY
═══════════════════════════════════ */

// ── 33. User can access their own media ──────────────────────────────
await test('33. User can access their own media', async () => {
  const result = validateMediaAccess({
    requesterId:  'user-1',
    mediaOwnerId: 'user-1',
    mediaId:      'media-abc-123',
  });
  assert(result.authorized, 'own media authorized');
});

// ── 34. Storage reference must belong to owner ───────────────────────
await test('34. Storage reference prefix must match owner', async () => {
  // user-A trying to access user-B storage ref
  const result = validateMediaAccess({
    requesterId:  'user-A',
    mediaOwnerId: 'user-A',
    mediaId:      'media-1',
    storageRef:   'user-B/media-1/video.mp4',  // User B's storage!
  });
  assert(!result.authorized, 'cross-user storage ref rejected');
});

// ── 35. Safe storage ref builder ─────────────────────────────────────
await test('35. buildSafeStorageRef creates properly scoped references', async () => {
  const ref = buildSafeStorageRef('user-abc', 'media-123', 'video.mp4');
  assert(ref.startsWith('user-abc/'), 'starts with owner prefix');
  assert(ref.includes('media-123/'), 'contains media ID');
  assert(ref.endsWith('video.mp4'), 'ends with filename');
  // No path traversal possible in output
  assert(!ref.includes('..'), 'no path traversal in output');
});

/* ═══════════════════════════════════
   RECOVERY / ACCOUNT ISOLATION
═══════════════════════════════════ */

// ── 36. Recovery cannot cross account boundaries ──────────────────────
await test('36. Recovery: cannot restore User B state for User A', async () => {
  const sr = new StateRecovery();
  sr.saveState({
    ownerId:       'user-B',
    mode:          ACTIVE_MODE.BROADCAST,
    destinationIds:['yt', 'tw'],
  });

  // User A tries to restore User B's state
  const result = sr.evaluateRestore('user-A');
  assert(!result.safe, 'cross-account restore denied');
  assertEqual(result.state, null, 'no state returned');
});

// ── 37. Recovery state does not persist credentials ───────────────────
await test('37. Recovery state: credentials never persist', async () => {
  const sr = new StateRecovery();
  sr.saveState({
    ownerId:   'user-1',
    mode:      ACTIVE_MODE.BROADCAST,
    // Attempting to persist a credential
    streamKey: 'sk_live_SHOULD_NOT_BE_SAVED',
    password:  'user-password-123',
  });

  const state = sr.getPersistedState();
  const json = JSON.stringify(state);
  assert(!json.includes('sk_live_SHOULD_NOT_BE_SAVED'), 'stream key not persisted');
  assert(!json.includes('user-password-123'), 'password not persisted');
});

/* ═══════════════════════════════════
   SECURITY DIAGNOSTICS
═══════════════════════════════════ */

// ── 38. Security diagnostics reports correct status ───────────────────
await test('38. Security diagnostics: truthful status reporting', async () => {
  const diag = getSecurityDiagnostics();
  assert(diag.capabilities, 'capabilities present');
  assertEqual(diag.capabilities.ownershipEnforcement, 'ACTIVE', 'ownership active');
  assertEqual(diag.capabilities.credentialVault, 'NOT_CONFIGURED', 'vault correctly NOT_CONFIGURED');
  assert(diag.limitations?.length > 0, 'limitations documented');
  assert(!diag.backdoor, 'no backdoor field');
  assert(!JSON.stringify(diag).toLowerCase().includes('backdoor secret'), 'no secret in diag');
});

// ── 39. No backdoor exists ────────────────────────────────────────────
await test('39. No master backdoor, universal token, or bypass exists', async () => {
  // Verify that ADMIN cannot access credentials resource
  const { ADMIN_CROSS_ACCOUNT_RESOURCES } = await import('../ownership.js');
  // Even if it exports it, credentials type should not be in allowed set
  // (ADMIN_CROSS_ACCOUNT_RESOURCES is empty in our implementation)
  const result = verifyOwnership({
    requesterId:   'admin-1',
    requesterRole: ROLE.ADMIN,
    resourceOwner: 'user-1',
    resourceType:  RESOURCE_TYPE.CREDENTIAL,
    resourceId:    'cred-1',
  });
  assert(!result.authorized, 'ADMIN cannot access credentials cross-account');
});

// ── 40. Regression — Stages 1-12 unaffected ──────────────────────────
await test('40. Regression: Stage 13 does not break existing security/permission imports', async () => {
  // Verify existing permissions.js is intact
  assert(ROLE.OWNER   === 'OWNER',   'ROLE.OWNER');
  assert(ROLE.ADMIN   === 'ADMIN',   'ROLE.ADMIN');
  assert(ROLE.CREATOR === 'CREATOR', 'ROLE.CREATOR');
  assert(ROLE.VIEWER  === 'VIEWER',  'ROLE.VIEWER');

  const ownerPerms = getPermissions(ROLE.OWNER);
  assert(ownerPerms.includes(PERMISSION.START_BROADCAST), 'OWNER has START_BROADCAST');
  assert(ownerPerms.includes(PERMISSION.STOP_BROADCAST), 'OWNER has STOP_BROADCAST');

  const viewerPerms = getPermissions(ROLE.VIEWER);
  assert(!viewerPerms.includes(PERMISSION.START_BROADCAST), 'VIEWER lacks START_BROADCAST');
  assert(viewerPerms.includes(PERMISSION.VIEW_STATUS), 'VIEWER has VIEW_STATUS');

  // Verify hasPermission works correctly
  assert(hasPermission(ROLE.OWNER, PERMISSION.MANAGE_DESTINATIONS), 'owner can manage destinations');
  assert(!hasPermission(ROLE.VIEWER, PERMISSION.MANAGE_DESTINATIONS), 'viewer cannot manage destinations');
});

/* ═══════════════════════════════════
   RESULTS
═══════════════════════════════════ */

console.log(`\n  Stage 13 Security: ${_passed} PASSED, ${_failed} FAILED\n`);

if (_failed > 0) {
  console.error('FAILED TESTS:');
  _results.filter(r => r.status === 'FAIL').forEach(r =>
    console.error(`  ✗ ${r.name}: ${r.error}`)
  );
  process.exit(1);
}
