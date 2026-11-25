import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCbor } from '../src/questie/cbor.js';

const hex = (h) => Uint8Array.from(Buffer.from(h.replace(/\s+/g, ''), 'hex'));

test('decodes unsigned integers of every width', () => {
  assert.equal(decodeCbor(hex('00')), 0);
  assert.equal(decodeCbor(hex('17')), 23);
  assert.equal(decodeCbor(hex('1818')), 24);
  assert.equal(decodeCbor(hex('190100')), 256);
  assert.equal(decodeCbor(hex('1a000f4240')), 1000000);
  assert.equal(decodeCbor(hex('1b000000e8d4a51000')), 1000000000000);
});

test('decodes negative integers', () => {
  assert.equal(decodeCbor(hex('20')), -1);
  assert.equal(decodeCbor(hex('3863')), -100);
});

test('decodes text and byte strings', () => {
  assert.equal(decodeCbor(hex('6449455446')), 'IETF');
  assert.equal(decodeCbor(hex('62c3bc')), 'ü');
  assert.deepEqual(decodeCbor(hex('4401020304')), Uint8Array.from([1, 2, 3, 4]));
});

test('decodes arrays and nested arrays', () => {
  assert.deepEqual(decodeCbor(hex('83010203')), [1, 2, 3]);
  assert.deepEqual(decodeCbor(hex('8301820203820405')), [1, [2, 3], [4, 5]]);
});

test('decodes maps with integer keys into string-keyed objects', () => {
  assert.deepEqual(decodeCbor(hex('a1016161')), { 1: 'a' });
  assert.deepEqual(decodeCbor(hex('a26161016162820203')), { a: 1, b: [2, 3] });
});

test('decodes floats and simple values', () => {
  assert.equal(decodeCbor(hex('f93c00')), 1.0);
  assert.equal(decodeCbor(hex('fa47c35000')), 100000.0);
  assert.equal(decodeCbor(hex('fb3ff199999999999a')), 1.1);
  assert.equal(decodeCbor(hex('f4')), false);
  assert.equal(decodeCbor(hex('f5')), true);
  assert.equal(decodeCbor(hex('f6')), null);
});

test('decodes indefinite-length arrays and maps', () => {
  assert.deepEqual(decodeCbor(hex('9f018202039f0405ffff')), [1, [2, 3], [4, 5]]);
  assert.deepEqual(decodeCbor(hex('bf61610161629f0203ffff')), { a: 1, b: [2, 3] });
});

test('throws on truncated input', () => {
  assert.throws(() => decodeCbor(hex('83 01 02')));
});

test('bytesAsString option decodes byte strings and byte-string keys as UTF-8 text', () => {
  // {"p": h"4b6179"} with key as byte string, value as byte string
  assert.deepEqual(decodeCbor(hex('a1 41 70 43 5a7567'), { bytesAsString: true }), { p: 'Zug' });
});
