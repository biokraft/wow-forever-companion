// Test-only CBOR encoder mirroring how QuestieDB bakes values:
// strings are written as byte strings (major type 2), like Lua's C_EncodingUtil.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  if (n < 0x100000000) { const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b; }
  const b = Buffer.alloc(9); b[0] = (major << 5) | 27; b.writeBigUInt64BE(BigInt(n), 1); return b;
}

export function encodeCbor(v) {
  if (v === null || v === undefined) return Buffer.from([0xf6]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === false) return Buffer.from([0xf4]);
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v);
    const b = Buffer.alloc(9); b[0] = 0xfb; b.writeDoubleBE(v, 1); return b;
  }
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(2, s.length), s]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(encodeCbor)]);
  const keys = Object.keys(v);
  return Buffer.concat([head(5, keys.length), ...keys.flatMap((k) => {
    const key = /^\d+$/.test(k) ? Number(k) : k;
    return [encodeCbor(key), encodeCbor(v[k])];
  })]);
}
