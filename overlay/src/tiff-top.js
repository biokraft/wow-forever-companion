// Reads only the top rows of an uncompressed RGB(A) TIFF, the format `screencapture -t tiff`
// writes, and returns them as BGRA (the byte order readStrip expects). It reads the header, the
// IFD and the strips holding those rows with positional reads, not the whole 15 MB file, and
// decodes nothing: the pixel bytes are only reordered. Plain Node, testable without Electron.
import fs from 'node:fs';
import { stripRowCount } from './bridge-reader.js';

const TYPE_SIZE = { 3: 2, 4: 4 }; // SHORT, LONG
const TAG = {
  width: 256, height: 257, bitsPerSample: 258, compression: 259, photometric: 262,
  stripOffsets: 273, samplesPerPixel: 277, rowsPerStrip: 278, stripByteCounts: 279, planar: 284,
};

const USED = new Set(Object.values(TAG));
// Bigger than any window WoW can have; keeps every size computed from the header small.
export const MAX_SIDE = 16384;

const fail = (why) => { throw new Error(`unsupported TIFF: ${why}`); };
const isCount = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;

// read(position, length) -> Promise<Buffer>. rows defaults to the depth readStrip searches.
// size (the file's length, when known) refuses any read past the end before it is made. Every
// value from the header is checked before it sizes a read, an allocation or a loop.
export async function readTiffTop(read, { rows, size } = {}) {
  const exact = async (position, length) => {
    if (!Number.isInteger(position) || !Number.isInteger(length) || position < 0 || length < 0) fail('bad offset');
    if (size != null && position + length > size) fail('file ends early');
    const b = await read(position, length);
    if (b.length < length) fail('file ends early');
    return b;
  };
  const head = await exact(0, 8);
  const order = head.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') fail('no byte order mark');
  const le = order === 'II';
  const u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  if (u16(head, 2) !== 42) fail('not a classic TIFF');

  const ifd = u32(head, 4);
  const count = u16(await exact(ifd, 2), 0);
  const entries = await exact(ifd + 2, count * 12);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const e = i * 12;
    const tag = u16(entries, e);
    const type = u16(entries, e + 2);
    const n = u32(entries, e + 4);
    const sz = TYPE_SIZE[type];
    // Only the tags read below are expanded; others (EXIF, ICC profile) are skipped unread.
    if (!USED.has(tag) || !sz) continue;
    // At most one value per strip of a maximal image: anything longer is not a real header.
    if (!isCount(n, MAX_SIDE)) fail(`tag ${tag} has ${n} values`);
    const src = n * sz <= 4 ? entries.subarray(e + 8, e + 12) : await exact(u32(entries, e + 8), n * sz);
    tags.set(tag, Array.from({ length: n }, (_, j) => (sz === 2 ? u16(src, j * 2) : u32(src, j * 4))));
  }
  const one = (tag, dflt) => tags.get(tag)?.[0] ?? dflt;

  const width = one(TAG.width);
  const height = one(TAG.height);
  const samples = one(TAG.samplesPerPixel, 1);
  if (!isCount(width, MAX_SIDE) || !isCount(height, MAX_SIDE)) fail(`size ${width}x${height}`);
  if (one(TAG.compression, 1) !== 1) fail('compressed');
  if (one(TAG.planar, 1) !== 1) fail('planar');
  if (one(TAG.photometric) !== 2) fail('not RGB');
  if (samples !== 3 && samples !== 4) fail(`${samples} samples per pixel`);
  const bits = tags.get(TAG.bitsPerSample);
  if (!bits || !bits.every((b) => b === 8)) fail('not 8 bits per sample');
  const perStrip = Math.min(one(TAG.rowsPerStrip, height), height);
  if (!isCount(perStrip, MAX_SIDE)) fail(`${perStrip} rows per strip`);
  const offsets = tags.get(TAG.stripOffsets);
  const strips = Math.ceil(height / perStrip);
  if (!offsets || offsets.length < strips) fail('missing strips');
  const byteCounts = tags.get(TAG.stripByteCounts);

  const want = Math.min(height, isCount(rows, MAX_SIDE) ? rows : stripRowCount(height));
  const rowBytes = width * samples;
  const bitmap = Buffer.alloc(width * want * 4);
  for (let y = 0; y < want; y += perStrip) {
    const strip = y / perStrip;
    const n = Math.min(perStrip, want - y);
    if (byteCounts && !(byteCounts[strip] >= n * rowBytes)) fail('strip shorter than its rows');
    const src = await exact(offsets[strip], n * rowBytes);
    // RGB(A) -> BGRA; any alpha is dropped (the window is opaque).
    for (let i = 0, o = y * width * 4; i < n * width; i++, o += 4) {
      const p = i * samples;
      bitmap[o] = src[p + 2];
      bitmap[o + 1] = src[p + 1];
      bitmap[o + 2] = src[p];
      bitmap[o + 3] = 255;
    }
  }
  return { bitmap, width, height: want, windowHeight: height };
}

export async function readTiffTopFile(file, opts) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    return await readTiffTop(async (position, length) => {
      // readTiffTop has checked position + length against size, so this allocation is bounded.
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, position);
      return buf.subarray(0, bytesRead);
    }, { ...opts, size });
  } finally {
    await fh.close();
  }
}
