#!/usr/bin/env node
// Runs the overlay's tests one file per `node --test` process, in the overlay folder, and
// fails at the end if any file failed (every file still runs). The combined run
// (`node --test "overlay/test/*.test.js"`) hangs on the owner's machine.
//   node scripts/test-overlay.js [overlay folder]   (default: this repo's overlay/)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const overlayDir = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../overlay/', import.meta.url)));
const files = fs.readdirSync(path.join(overlayDir, 'test'))
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => `test/${f}`);
const failed = [];
for (const file of files) {
  process.stdout.write(`$ node --test ${file}\n`);
  const r = spawnSync(process.execPath, ['--test', file], { cwd: overlayDir, stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
}
if (failed.length) {
  process.stdout.write(`\noverlay tests failed: ${failed.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`\noverlay tests: ${files.length} files passed\n`);
