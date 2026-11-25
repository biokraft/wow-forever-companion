// Builds uncompressed RGB(A) TIFF files the way `screencapture -t tiff` writes them: 8 bytes of
// header, the pixel strips, then the IFD at the end of the file. Pixels come in as BGRA.
const TYPE_SIZE = { 3: 2, 4: 4 };

export function encodeTiff({ bitmap, width, height }, { order = 'MM', samples = 4, rowsPerStrip = 12, tags: extra = {} } = {}) {
  const le = order === 'II';
  const rowBytes = width * samples;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let i = 0; i < width * height; i++) {
    pixels[i * samples] = bitmap[i * 4 + 2];
    pixels[i * samples + 1] = bitmap[i * 4 + 1];
    pixels[i * samples + 2] = bitmap[i * 4];
    if (samples === 4) pixels[i * samples + 3] = bitmap[i * 4 + 3];
  }
  const strips = Math.ceil(height / rowsPerStrip);
  const offsets = [];
  const counts = [];
  for (let s = 0; s < strips; s++) {
    offsets.push(8 + s * rowsPerStrip * rowBytes);
    counts.push(Math.min(rowsPerStrip, height - s * rowsPerStrip) * rowBytes);
  }
  const tags = {
    256: [4, [width]],
    257: [4, [height]],
    258: [3, Array(samples).fill(8)],
    259: [3, [1]],
    262: [3, [2]],
    273: [4, offsets],
    277: [3, [samples]],
    278: [3, [rowsPerStrip]],
    279: [4, counts],
    284: [3, [1]],
    ...(samples === 4 ? { 338: [3, [1]] } : {}),
    ...extra,
  };
  const ids = Object.keys(tags).map(Number).sort((a, b) => a - b);
  const ifd = 8 + pixels.length;
  const ifdBytes = 2 + ids.length * 12 + 4;
  // Values that do not fit in 4 bytes go after the IFD.
  let extraAt = ifd + ifdBytes;
  const placed = ids.map((id) => {
    const [type, values] = tags[id];
    const size = TYPE_SIZE[type] * values.length;
    const at = size > 4 ? extraAt : null;
    if (at != null) extraAt += size;
    return { id, type, values, at };
  });
  const buf = Buffer.alloc(extraAt);
  const u16 = (v, o) => (le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o));
  const u32 = (v, o) => (le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o));
  const put = (type, v, o) => (type === 3 ? u16(v, o) : u32(v, o));
  buf.write(order, 0, 'latin1');
  u16(42, 2);
  u32(ifd, 4);
  pixels.copy(buf, 8);
  u16(ids.length, ifd);
  placed.forEach(({ id, type, values, at }, i) => {
    const e = ifd + 2 + i * 12;
    u16(id, e);
    u16(type, e + 2);
    u32(values.length, e + 4);
    if (at == null) values.forEach((v, j) => put(type, v, e + 8 + j * TYPE_SIZE[type]));
    else {
      u32(at, e + 8);
      values.forEach((v, j) => put(type, v, at + j * TYPE_SIZE[type]));
    }
  });
  u32(0, ifd + 2 + ids.length * 12);
  return buf;
}

// A positional reader over a buffer that records how many bytes were asked for.
export function bufferReader(buf) {
  const r = async (position, length) => {
    r.bytes += length;
    r.calls++;
    return buf.subarray(position, Math.min(buf.length, position + length));
  };
  r.bytes = 0;
  r.calls = 0;
  return r;
}

// Rewrites one IFD entry of a file made by encodeTiff in place (to build malformed headers that
// encodeTiff cannot express, like a count of 2^30). Only the given fields change.
export function patchEntry(buf, tag, { type, count, value } = {}) {
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const w16 = (v, o) => (le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o));
  const w32 = (v, o) => (le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o));
  const ifd = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + i * 12;
    if (u16(e) !== tag) continue;
    if (type != null) w16(type, e + 2);
    if (count != null) w32(count, e + 4);
    if (value != null) w32(value, e + 8);
    return buf;
  }
  throw new Error(`no tag ${tag}`);
}
