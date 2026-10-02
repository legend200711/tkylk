/**
 * 24-HOUR CLOUD ENGINE — Stage 3 Diagnostics Runner
 * cloud-engine/broadcast/tests/run-broadcast-diagnostics.js
 *
 * Runs the Stage 3 full diagnostics and prints a formatted report.
 * Stage 3 — Shadow Broadcast Engine
 */

import { runDiagnostics } from '../../diagnostics.js';

const report = await runDiagnostics();

console.log('\n══════════════════════════════════════════════════════');
console.log(`  ${report.version.name} v${report.version.version} — Stage ${report.version.stage}`);
console.log(`  Stage 3 Diagnostics`);
console.log('══════════════════════════════════════════════════════\n');

for (const r of report.results) {
  const icon = r.result === 'PASS'            ? '✓' :
               r.result === 'NOT_IMPLEMENTED' ? '○' :
               r.result === 'NOT_CONFIGURED'  ? '~' : '✗';
  console.log(`  ${icon}  [${r.result.padEnd(16)}] ${r.name}`);
  if (r.detail) console.log(`          ${r.detail}`);
  if (r.error)  console.log(`       ✗  ERROR: ${r.error}`);
}

console.log('\n──────────────────────────────────────────────────────');
console.log(`  PASS:            ${report.passed}`);
console.log(`  FAIL:            ${report.failed}`);
console.log(`  NOT_IMPLEMENTED: ${report.notImplemented}`);
console.log(`  NOT_CONFIGURED:  ${report.notConfigured}`);
console.log(`  TOTAL:           ${report.total}`);
console.log(`\n  Engine ready for Stage 4: ${report.ready ? 'YES' : 'NO'}`);
console.log('══════════════════════════════════════════════════════\n');

process.exit(report.failed > 0 ? 1 : 0);
