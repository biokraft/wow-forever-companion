import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTiffTop, readTiffTopFile } from '../src/tiff-top.js';
import { readStrip, decodeStrip, stripRowCount } from '../src/bridge-reader.js';
import { decodeFrame } from '../../src/bridge/codec.js';
import { parseSavedVariables } from '../../src/lua/parse.js';
import { gameBitmap, drawStrip } from './fixtures/strip-bitmap.js';
import { encodeTiff, bufferReader, patchEntry } from './fixtures/tiff.js';

const vectorText = fs.readFileSync(new URL('../../test/fixtures/bridge-vectors.lua', import.meta.url), 'utf8');

const topRows = (img, rows) => img.bitmap.subarray(0, img.width * rows * 4);

test('the top rows of a big-endian RGBA TIFF come back as BGRA', async () => {
  const img = gameBitmap(64, 40, 3);
  const r = await readTiffTop(bufferReader(encodeTiff(img)), { rows: 7 });
  assert.equal(r.width, 64);
  assert.equal(r.height, 7);
  assert.equal(r.windowHeight, 40);
  assert.deepEqual(r.bitmap, topRows(img, 7));
});

test('little-endian files, RGB without alpha, and rows across strips read the same', async () => {
  const img = gameBitmap(50, 30, 4);
  for (const opts of [{ order: 'II' }, { samples: 3 }, { rowsPerStrip: 5 }, { rowsPerStrip: 1, order: 'II', samples: 3 }, { rowsPerStrip: 1000 }]) {
    const r = await readTiffTop(bufferReader(encodeTiff(img, opts)), { rows: 13 });
    const want = Buffer.from(topRows(img, 13));
    if (opts.samples === 3) for (let i = 3; i < want.length; i += 4) want[i] = 255;
    assert.deepEqual(r.bitmap, want, JSON.stringify(opts));
  }
});

test('rows defaults to the strip search depth and never exceeds the image', async () => {
  const img = gameBitmap(30, 25, 5);
  const r = await readTiffTop(bufferReader(encodeTiff(img)));
  assert.equal(r.height, stripRowCount(25));
  const tall = await readTiffTop(bufferReader(encodeTiff(img)), { rows: 99 });
  assert.equal(tall.height, 25);
});

test('only the header, the IFD and the top rows are read, not the whole file', async () => {
  const img = gameBitmap(2560, 1440, 6);
  const file = encodeTiff(img);
  const read = bufferReader(file);
  const r = await readTiffTop(read);
  assert.equal(r.height, 121);
  const rowBytes = 2560 * 4;
  assert.ok(read.bytes < rowBytes * 132 + 4096, `read ${read.bytes} of ${file.length}`);
  assert.deepEqual(r.bitmap, topRows(img, 121));
});

test('compressed, planar, 16-bit, non-RGB and non-TIFF files are refused', async () => {
  const img = gameBitmap(16, 16, 7);
  const bad = [
    encodeTiff(img, { tags: { 259: [3, [5]] } }),
    encodeTiff(img, { tags: { 284: [3, [2]] } }),
    encodeTiff(img, { tags: { 258: [3, [16, 16, 16, 16]] } }),
    encodeTiff(img, { tags: { 262: [3, [1]] } }),
    encodeTiff(img, { samples: 4, tags: { 277: [3, [2]] } }),
    Buffer.from('\x89PNG\r\n\x1a\n0000000000000000', 'latin1'),
  ];
  for (const [i, buf] of bad.entries()) await assert.rejects(readTiffTop(bufferReader(buf)), /TIFF/, `case ${i}`);
});

test('a strip that ends early is refused', async () => {
  const buf = encodeTiff(gameBitmap(16, 16, 8));
  await assert.rejects(readTiffTop(bufferReader(buf.subarray(0, 100))), /TIFF/);
});

test('readTiffTopFile reads a file on disk and closes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-tiff-'));
  const file = path.join(dir, 'w.tiff');
  const img = gameBitmap(40, 20, 9);
  fs.writeFileSync(file, encodeTiff(img));
  const r = await readTiffTopFile(file, { rows: 3 });
  assert.deepEqual(r.bitmap, topRows(img, 3));
  fs.rmSync(dir, { recursive: true });
  await assert.rejects(readTiffTopFile(file), /ENOENT/);
});

test('a strip in a full-window TIFF decodes from the top rows alone', async () => {
  const { vectors } = parseSavedVariables(vectorText.replace(/^return\s/m, 'BridgeVectors = ')).BridgeVectors;
  const V = vectors.find((v) => v.label === 'quests-25');
  for (const [page, y0] of [[0, 0], [2, 120]]) {
    const img = drawStrip(gameBitmap(2560, 1440, 10), V.frames[page].symbols, { y0 });
    const top = await readTiffTop(bufferReader(encodeTiff(img)));
    assert.deepEqual(decodeStrip(readStrip(top)), decodeFrame(V.frames[page].symbols), `page ${page} at row ${y0}`);
  }
});

// Malformed headers (fix round 1): every one must end in a refusal, never a hang or a huge read.
// Each case runs through readTiffTop with a size-checking reader and through readTiffTopFile.
function guardedReader(buf) {
  const r = bufferReader(buf);
  const g = async (position, length) => {
    g.maxAsked = Math.max(g.maxAsked, length);
    assert.ok(Number.isInteger(position) && Number.isInteger(length) && position >= 0 && length >= 0, `read(${position}, ${length})`);
    return r(position, length);
  };
  g.maxAsked = 0;
  return g;
}
async function refused(buf, label) {
  const read = guardedReader(buf);
  await assert.rejects(readTiffTop(read), /unsupported TIFF/, label);
  assert.ok(read.maxAsked <= buf.length, `${label}: asked for ${read.maxAsked} bytes of ${buf.length}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-tiff-bad-'));
  const file = path.join(dir, 'bad.tiff');
  fs.writeFileSync(file, buf);
  try {
    await assert.rejects(readTiffTopFile(file), /unsupported TIFF/, `${label} (file)`);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}
const small = () => encodeTiff(gameBitmap(16, 16, 11), { rowsPerStrip: 4 });

test('rows per strip of 0 is refused instead of looping forever', async () => {
  await refused(patchEntry(small(), 278, { value: 0 }), 'MM 0');
  await refused(patchEntry(encodeTiff(gameBitmap(16, 16, 11), { order: 'II' }), 278, { value: 0 }), 'II 0');
});

test('a huge or zero width or height is refused before anything big is read or allocated', async () => {
  for (const [tag, v] of [[256, 0x7fffffff], [257, 0x7fffffff], [256, 16385], [256, 0], [257, 0]]) {
    await refused(patchEntry(small(), tag, { value: v }), `tag ${tag} = ${v}`);
  }
});

test('a huge tag count is refused, or ignored for tags the reader does not use', async () => {
  await refused(patchEntry(small(), 273, { count: 2 ** 30 }), 'strip offsets count 2^30');
  await refused(patchEntry(small(), 258, { count: 2 ** 30 }), 'bits per sample count 2^30');
  const odd = encodeTiff(gameBitmap(16, 16, 11), { tags: { 339: [3, [1, 1, 1, 1]] } });
  patchEntry(odd, 339, { count: 2 ** 30 });
  const read = guardedReader(odd);
  const r = await readTiffTop(read, { rows: 2 });
  assert.equal(r.height, 2);
  assert.ok(read.maxAsked < 4096, `asked for ${read.maxAsked}`);
});

test('strips and the IFD outside the file, or too short for their rows, are refused', async () => {
  await refused(patchEntry(small(), 273, { value: 0x7ffffff0 }), 'strip offsets array past the end');
  const one = encodeTiff(gameBitmap(16, 16, 11), { rowsPerStrip: 16 });
  await refused(patchEntry(Buffer.from(one), 273, { value: 0x7ffffff0 }), 'single strip past the end');
  await refused(patchEntry(Buffer.from(one), 279, { value: 16 }), 'strip byte count shorter than its rows');
  const ifdFar = small();
  ifdFar.writeUInt32BE(0x7ffffff0, 4);
  await refused(ifdFar, 'IFD past the end');
});

test('a rows option that is not a positive integer falls back to the strip search depth', async () => {
  const img = gameBitmap(30, 25, 12);
  for (const rows of [0, -3, 2.5, NaN, 'x']) {
    const r = await readTiffTop(bufferReader(encodeTiff(img)), { rows });
    assert.equal(r.height, stripRowCount(25), String(rows));
  }
});
