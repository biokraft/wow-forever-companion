// Pixel bridge frame codec. The addon draws frames of 2-bit symbols (four grey levels)
// along the top screen edge; the overlay captures and decodes them. The Lua encoder in the
// addon must reproduce this format exactly, so every step is plain integer arithmetic:
// bits are MSB-first per field, and a symbol is b0 * 2 + b1 for consecutive bit pairs.
//
// Frame layout, in symbols:
//   marker (6) | header (18 = 36 bits) | payload (bits padded to even) | checksum (8 = 16 bits)
// Header bits: version 4, seq 8, page 4, pages 4, tag 16. The checksum is Fletcher-16 over the
// header and payload symbols (the marker is excluded).

export const GREYS = [0, 24, 48, 72];
export const MARKER = [3, 0, 3, 0, 3, 3];
export const FORMAT_VERSION = 1;
export const BLOCK_W = 3;
export const BLOCK_H = 2;

const HEADER_SYMBOLS = 18;
const CHECKSUM_SYMBOLS = 8;
const CORE_WIDTHS = [
  ['level', 7], ['xp', 24], ['xpMax', 24], ['rested', 24], ['money', 32],
  ['uiMapId', 16], ['x', 10], ['y', 10], ['questDigest', 16], ['questCount', 5],
];
const QUEST_COUNT_BITS = 5;
const QUEST_ID_BITS = 17;
const QUEST_OBJ_COUNT_BITS = 3;
const QUEST_OBJ_BITS = 8;

export function fletcher16(values) {
  let s1 = 0;
  let s2 = 0;
  for (const v of values) {
    s1 = (s1 + v) % 255;
    s2 = (s2 + s1) % 255;
  }
  return s2 * 256 + s1;
}

export function characterTag(name, classFile) {
  return fletcher16([...Buffer.from(`${name}-${classFile}`, 'utf8')]);
}

function pushBits(out, value, width) {
  const max = 2 ** width - 1;
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`value ${value} does not fit ${width} bits`);
  for (let i = width - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** i) % 2);
}

function readBits(bits, pos, width) {
  if (pos + width > bits.length) throw new RangeError('bits exhausted');
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 2 + bits[pos + i];
  return v;
}

export function packCore(core) {
  const bits = [];
  for (const [key, width] of CORE_WIDTHS) pushBits(bits, core[key], width);
  return bits;
}

export function unpackCore(bits) {
  const core = {};
  let pos = 0;
  for (const [key, width] of CORE_WIDTHS) {
    core[key] = readBits(bits, pos, width);
    pos += width;
  }
  return core;
}

function packQuest(q) {
  if (q.objectives.length >= 2 ** QUEST_OBJ_COUNT_BITS) throw new RangeError('too many objectives');
  const bits = [];
  pushBits(bits, q.id, QUEST_ID_BITS);
  pushBits(bits, q.complete ? 1 : 0, 1);
  pushBits(bits, q.failed ? 1 : 0, 1);
  pushBits(bits, q.objectives.length, QUEST_OBJ_COUNT_BITS);
  for (const have of q.objectives) pushBits(bits, Math.min(255, Math.max(0, Math.floor(have))), QUEST_OBJ_BITS);
  return bits;
}

// Splits quests into pages of at most capacityBits bits each: a 5-bit quest count, then the
// quests. A quest is never split; one that does not fit starts the next page.
export function packQuests(quests, capacityBits) {
  const pages = [];
  let cur = null;
  let count = 0;
  const flush = () => {
    if (!cur) return;
    const head = [];
    pushBits(head, count, QUEST_COUNT_BITS);
    pages.push(head.concat(cur));
    cur = null;
    count = 0;
  };
  for (const q of quests) {
    const qb = packQuest(q);
    if (QUEST_COUNT_BITS + qb.length > capacityBits) throw new RangeError('quest does not fit a page');
    if (cur && (QUEST_COUNT_BITS + cur.length + qb.length > capacityBits || count >= 2 ** QUEST_COUNT_BITS - 1)) flush();
    if (!cur) cur = [];
    cur.push(...qb);
    count++;
  }
  flush();
  return pages;
}

export function unpackQuests(bits) {
  let pos = 0;
  const n = readBits(bits, pos, QUEST_COUNT_BITS);
  pos += QUEST_COUNT_BITS;
  const quests = [];
  for (let i = 0; i < n; i++) {
    const id = readBits(bits, pos, QUEST_ID_BITS); pos += QUEST_ID_BITS;
    const complete = readBits(bits, pos, 1) === 1; pos += 1;
    const failed = readBits(bits, pos, 1) === 1; pos += 1;
    const on = readBits(bits, pos, QUEST_OBJ_COUNT_BITS); pos += QUEST_OBJ_COUNT_BITS;
    const objectives = [];
    for (let j = 0; j < on; j++) { objectives.push(readBits(bits, pos, QUEST_OBJ_BITS)); pos += QUEST_OBJ_BITS; }
    quests.push({ id, complete, failed, objectives });
  }
  return quests;
}

// Fletcher-16 over each quest's own bits (id, flags, objective count, objectives) in log order.
// No page count prefixes and no padding, so it is the same at every screen width and a reader
// can recompute it from the unpacked quests.
export function questDigest(quests) {
  return fletcher16(quests.flatMap(packQuest));
}

function bitsToSymbols(bits) {
  const out = [];
  for (let i = 0; i < bits.length; i += 2) out.push(bits[i] * 2 + (bits[i + 1] ?? 0));
  return out;
}

export function encodeFrame({ seq, page, pages, tag, version = FORMAT_VERSION }, bits) {
  const head = [];
  pushBits(head, version, 4);
  pushBits(head, seq, 8);
  pushBits(head, page, 4);
  pushBits(head, pages, 4);
  pushBits(head, tag, 16);
  const body = bitsToSymbols(head).concat(bitsToSymbols(bits));
  const sum = [];
  pushBits(sum, fletcher16(body), 16);
  return [...MARKER, ...body, ...bitsToSymbols(sum)];
}

const symbolsToBits = (syms) => syms.flatMap((s) => [Math.floor(s / 2), s % 2]);
const CORE_BITS = CORE_WIDTHS.reduce((n, [, w]) => n + w, 0);

// The header carries no length and the pixels after the checksum are game pixels, so the
// reader derives a frame's length from its payload: page 0 is the fixed-size core, a quest
// page is walked through its quest count and each quest's objective count. Returns the frame's
// symbol count, or null when the symbols hold no marker, an unknown version, or less than the
// whole frame.
export function frameSymbolCount(symbols) {
  const start = MARKER.length + HEADER_SYMBOLS;
  if (!Array.isArray(symbols) || symbols.length < start || MARKER.some((m, i) => symbols[i] !== m)) return null;
  const hb = symbolsToBits(symbols.slice(MARKER.length, start));
  if (readBits(hb, 0, 4) !== FORMAT_VERSION) return null;
  let payloadBits;
  if (readBits(hb, 12, 4) === 0) {
    payloadBits = CORE_BITS;
  } else {
    const bits = symbolsToBits(symbols.slice(start));
    try {
      let pos = 0;
      const n = readBits(bits, pos, QUEST_COUNT_BITS);
      pos += QUEST_COUNT_BITS;
      for (let i = 0; i < n; i++) {
        pos += QUEST_ID_BITS + 2;
        const on = readBits(bits, pos, QUEST_OBJ_COUNT_BITS);
        pos += QUEST_OBJ_COUNT_BITS + on * QUEST_OBJ_BITS;
      }
      payloadBits = pos;
    } catch {
      return null; // bits exhausted: the strip ends inside the payload
    }
  }
  const total = start + Math.ceil(payloadBits / 2) + CHECKSUM_SYMBOLS;
  return total <= symbols.length ? total : null;
}

export function decodeFrame(symbols) {
  if (symbols.length < MARKER.length || MARKER.some((m, i) => symbols[i] !== m)) return { ok: false, reason: 'no marker' };
  if (symbols.length < MARKER.length + HEADER_SYMBOLS + CHECKSUM_SYMBOLS) return { ok: false, reason: 'short' };
  const body = symbols.slice(MARKER.length, symbols.length - CHECKSUM_SYMBOLS);
  const got = symbols.slice(symbols.length - CHECKSUM_SYMBOLS).reduce((a, s) => a * 4 + s, 0);
  if (got !== fletcher16(body)) return { ok: false, reason: 'checksum' };
  const hb = symbolsToBits(body.slice(0, HEADER_SYMBOLS));
  const version = readBits(hb, 0, 4);
  if (version !== FORMAT_VERSION) return { ok: false, reason: 'version' };
  return {
    ok: true,
    version,
    seq: readBits(hb, 4, 8),
    page: readBits(hb, 12, 4),
    pages: readBits(hb, 16, 4),
    tag: readBits(hb, 20, 16),
    bits: symbolsToBits(body.slice(HEADER_SYMBOLS)),
  };
}

export function pageCapacityBits(widthPx) {
  return (Math.floor(widthPx / BLOCK_W) - MARKER.length - HEADER_SYMBOLS - CHECKSUM_SYMBOLS) * 2;
}
