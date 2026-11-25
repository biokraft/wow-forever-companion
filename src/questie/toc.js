// Reads the metadata store of a baked QuestieDB `.toc` file.
//
// Findings from the 2026-11-25 spike against QuestieDB v1.1.6 (X-Flavor: Forever):
// - Every value is a `## X-<key>: <value>` line. A value of exactly `~N~` is a chunk header;
//   the real value is the concatenation of `<key>-1` .. `<key>-N`.
// - `X-<Entity>-IDS` (Entity: Quest, Npc, Object, Item): base64 -> zlib -> CBOR array of ids.
// - `X-<Entity>-<id>-S`: base64 -> CBOR map, the "scalar row": {fieldIndex: value, p: mask}.
//   Bit 2^(fieldIndex-1) of `p` says a table-typed field is present.
// - `X-<Entity>-<id>-<fieldIndex>`: base64 -> CBOR, one table-typed field (uncompressed).
// - Strings (values and the `p` key) are CBOR byte strings holding UTF-8.
// - Field indices live in QuestieDB/src/meta/<entity>Meta.lua.
// - In-game "corrections" (src/corrections) are applied by the addon at runtime and are NOT
//   in the baked rows; offline reads see uncorrected data.
import fs from 'node:fs';

const LINE = /^## (X-[^:]+):\s?(.*)$/;
const CHUNK = /^~(\d+)~$/;

export function readTocMetadata(tocPath) {
  const raw = new Map();
  for (const line of fs.readFileSync(tocPath, 'utf8').split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) raw.set(m[1], m[2].trim());
  }
  const out = new Map();
  for (const [key, value] of raw) {
    const chunk = CHUNK.exec(value);
    if (!chunk) { out.set(key, value); continue; }
    const parts = [];
    for (let i = 1; i <= Number(chunk[1]); i++) {
      const part = raw.get(`${key}-${i}`);
      if (part === undefined) throw new Error(`QuestieDB metadata ${key} declares ${chunk[1]} parts but part ${i} is missing`);
      parts.push(part);
    }
    out.set(key, parts.join(''));
  }
  return out;
}
