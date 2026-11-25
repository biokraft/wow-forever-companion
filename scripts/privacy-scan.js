#!/usr/bin/env node
// Fails when a public-bound file contains personal data. Run before every release:
//   node scripts/privacy-scan.js [--list]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Generic patterns ship publicly; personal ones live in a private file that never does.
const GENERIC = [/\/Users\/[A-Za-z][\w.-]*\//, /\/home\/[a-z][\w.-]*\//, /[A-Z]:\\Users\\[A-Za-z][\w.-]*/,
  /[\w.+-]+@(gmail|protonmail|proton|icloud|outlook|hotmail|yahoo|gmx|web)\.[a-z]+/i];
const PRIVATE_LIST = path.join(ROOT, 'docs', 'superpowers', 'privacy-patterns.txt');

function privatePatterns() {
  if (!fs.existsSync(PRIVATE_LIST)) return [];
  return fs.readFileSync(PRIVATE_LIST, 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')).map((l) => new RegExp(l, 'i'));
}

export const FORBIDDEN = [...GENERIC, ...privatePatterns()];

// Private planning docs stay in the development repo; everything else tracked by git is public.
const PRIVATE_PREFIXES = ['docs/superpowers/', 'scratch/', '.superpowers/'];

export function publicFiles() {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  return tracked.filter((f) => !PRIVATE_PREFIXES.some((p) => f.startsWith(p)));
}

export function scanFiles(files) {
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      hits.push({ file, line: 0, match: 'unreadable' }); // never pass a scan by skipping files
      continue;
    }
    text.split('\n').forEach((line, i) => {
      for (const re of FORBIDDEN) {
        const m = re.exec(line);
        if (m) hits.push({ file, line: i + 1, match: m[0] });
      }
    });
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = publicFiles();
  if (process.argv.includes('--list')) { process.stdout.write(files.join('\n') + '\n'); process.exit(0); }
  const hits = scanFiles(files.map((f) => path.join(ROOT, f)));
  for (const h of hits) process.stderr.write(`${path.relative(ROOT, h.file)}:${h.line}: personal data "${h.match}"\n`);
  if (hits.length) process.exit(1);
  process.stdout.write(`privacy scan: ${files.length} public files clean\n`);
}
