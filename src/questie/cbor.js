// Minimal CBOR (RFC 8949) decoder for QuestieDB's baked data.
// Maps decode to plain objects; integer keys become their string form.
// bytesAsString: decode byte strings as UTF-8 text (QuestieDB bakes Lua strings that way).

const BREAK = Symbol('break');

export function decodeCbor(bytes, { bytesAsString = false } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;

  const need = (n) => {
    if (pos + n > buf.length) throw new RangeError(`CBOR: truncated at byte ${pos}`);
  };

  const readLength = (info) => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[pos++]; }
    if (info === 25) { need(2); const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { need(8); const v = view.getBigUint64(pos); pos += 8; return Number(v); }
    if (info === 31) return -1; // indefinite
    throw new Error(`CBOR: unsupported additional info ${info}`);
  };

  const halfToFloat = (h) => {
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;
    const sign = h & 0x8000 ? -1 : 1;
    if (exp === 0) return sign * 2 ** -14 * (mant / 1024);
    if (exp === 31) return mant ? NaN : sign * Infinity;
    return sign * 2 ** (exp - 15) * (1 + mant / 1024);
  };

  const readItem = () => {
    need(1);
    const initial = buf[pos++];
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0: return readLength(info);
      case 1: return -1 - readLength(info);
      case 2:
      case 3: {
        const len = readLength(info);
        let bytes;
        if (len === -1) {
          const parts = [];
          for (;;) {
            const part = readItem();
            if (part === BREAK) break;
            parts.push(typeof part === 'string' ? Buffer.from(part) : part);
          }
          bytes = Buffer.concat(parts);
        } else {
          need(len);
          bytes = buf.subarray(pos, pos + len);
          pos += len;
        }
        if (major === 2 && !bytesAsString) return Uint8Array.from(bytes);
        return Buffer.from(bytes).toString('utf8');
      }
      case 4: {
        const len = readLength(info);
        const out = [];
        if (len === -1) {
          for (;;) { const v = readItem(); if (v === BREAK) break; out.push(v); }
        } else {
          for (let i = 0; i < len; i++) out.push(readItem());
        }
        return out;
      }
      case 5: {
        const len = readLength(info);
        const out = {};
        if (len === -1) {
          for (;;) {
            const k = readItem();
            if (k === BREAK) break;
            out[String(k)] = readItem();
          }
        } else {
          for (let i = 0; i < len; i++) { const k = readItem(); out[String(k)] = readItem(); }
        }
        return out;
      }
      case 6: readLength(info); return readItem(); // tags are ignored
      case 7: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        if (info === 25) { need(2); const v = halfToFloat(view.getUint16(pos)); pos += 2; return v; }
        if (info === 26) { need(4); const v = view.getFloat32(pos); pos += 4; return v; }
        if (info === 27) { need(8); const v = view.getFloat64(pos); pos += 8; return v; }
        if (info === 31) return BREAK;
        if (info < 24) return info;
        throw new Error(`CBOR: unsupported simple value ${info}`);
      }
      default: throw new Error(`CBOR: bad major type ${major}`);
    }
  };

  const value = readItem();
  if (value === BREAK) throw new Error('CBOR: unexpected break');
  return value;
}
