import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isSessionId } from '../src/session-id.js';

test('only UUID-shaped strings are session ids', () => {
  assert.equal(isSessionId('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(isSessionId('ABCDEF12-3456-7890-ABCD-EF1234567890'), true);
  assert.equal(isSessionId(randomUUID()), true);
  for (const bad of [
    '', 'abc', 'sess-123', '--dangerously-skip-permissions', '--model', '-p',
    ' 11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111\n',
    '11111111-1111-4111-8111-111111111111 --foo', '--11111111-1111-4111-8111-111111111111',
    '1111111111114111811111111111111111', 'g1111111-1111-4111-8111-111111111111',
    null, undefined, 42, {}, ['11111111-1111-4111-8111-111111111111'],
  ]) assert.equal(isSessionId(bad), false, JSON.stringify(bad));
});
