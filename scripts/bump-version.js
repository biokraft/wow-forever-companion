#!/usr/bin/env node
// Sets one version everywhere it is written, and prints a version's changelog section:
//   node scripts/bump-version.js <version>          -> updates the seven version files
//   node scripts/bump-version.js --notes <version>  -> prints the CHANGELOG.md section for <version>
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Each JSON file names the version fields it holds, in the order they appear in the file.
const JSON_VERSIONS = {
  'package.json': [['version']],
  'overlay/package.json': [['version']],
  'overlay/package-lock.json': [['version'], ['packages', '', 'version']],
  '.claude-plugin/plugin.json': [['version']],
  '.claude-plugin/marketplace.json': [['plugins', 0, 'version']],
};
const TOC = 'addon/ForeverLog/ForeverLog.toc';
// The addon's own constant, shown by /fc status and the in-game guide and saved in every snapshot.
const CORE = 'addon/ForeverLog/Core.lua';

export const VERSION_FILES = [...Object.keys(JSON_VERSIONS), TOC, CORE];

function checkVersion(version) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`version must be MAJOR.MINOR.PATCH (like 0.4.0), got ${JSON.stringify(version)}`);
  }
}

// Rewrites only the version values in the text, so indentation and line endings stay as they are,
// then checks through a parse that exactly the named fields changed.
function bumpJson(file, text, keys, version) {
  let left = keys.length;
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/g, (m, a, b) => (left-- > 0 ? `${a}${version}${b}` : m));
  const expected = JSON.parse(text);
  for (const k of keys) {
    let o = expected;
    for (const p of k.slice(0, -1)) o = o?.[p];
    if (!o || typeof o[k.at(-1)] !== 'string') throw new Error(`${file}: no version at ${k.join('.')}`);
    o[k.at(-1)] = version;
  }
  if (!isDeepStrictEqual(JSON.parse(next), expected)) {
    throw new Error(`${file}: the version fields are not where expected; edit it by hand`);
  }
  return next;
}

function bumpToc(file, text, version) {
  const re = /^(## Version:[ \t]*)\S+([ \t]*\r?)$/m;
  if (!re.test(text)) throw new Error(`${file}: no "## Version:" line`);
  return text.replace(re, (m, a, b) => a + version + b);
}

function bumpCore(file, text, version) {
  const re = /^(ns\.VERSION[ \t]*=[ \t]*")[^"\r\n]*("[ \t]*\r?)$/m;
  if (!re.test(text)) throw new Error(`${file}: no ns.VERSION = "..." line`);
  return text.replace(re, (m, a, b) => a + version + b);
}

// Reads all seven files first and writes only when every one of them can be updated.
export function bumpVersion(rootDir, version) {
  checkVersion(version);
  const updates = VERSION_FILES.map((file) => {
    const full = path.join(rootDir, file);
    if (!fs.existsSync(full)) throw new Error(`${file}: missing`);
    const text = fs.readFileSync(full, 'utf8');
    const next = file === TOC ? bumpToc(file, text, version)
      : file === CORE ? bumpCore(file, text, version)
        : bumpJson(file, text, JSON_VERSIONS[file], version);
    return { file, full, text, next };
  });
  const changed = [];
  for (const u of updates) {
    if (u.next === u.text) continue;
    fs.writeFileSync(u.full, u.next);
    changed.push(u.file);
  }
  return changed;
}

// The body under "## <version>" or "## <version> (YYYY-MM-DD)", up to the next "## " heading.
export function changelogSection(markdown, version) {
  checkVersion(version);
  const lines = markdown.split(/\r?\n/);
  const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(?: \\(\\d{4}-\\d{2}-\\d{2}\\))?\\s*$`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md: the "## ${version}" section is empty`);
  return body;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--notes' && args.length === 2) {
      process.stdout.write(changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), args[1]) + '\n');
    } else if (args.length === 1 && !args[0].startsWith('-')) {
      const changed = bumpVersion(ROOT, args[0]);
      process.stdout.write(changed.length ? `set ${args[0]} in:\n${changed.map((f) => `  ${f}\n`).join('')}` : `already ${args[0]}\n`);
    } else {
      process.stderr.write('usage: node scripts/bump-version.js <version> | --notes <version>\n');
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
