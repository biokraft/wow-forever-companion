import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChoices, visibleText, answerFromChoices } from '../src/choices.js';

const block = (open, options) => [open, ...options, '</choices>'].join('\n');

test('a valid trailing block becomes chips and leaves the text without it', () => {
  const raw = `Which do you want next?\n${block('<choices>', ['Fast questing', 'Dungeons', 'A mix'])}`;
  assert.deepEqual(parseChoices(raw), {
    text: 'Which do you want next?',
    choices: { multi: false, options: ['Fast questing', 'Dungeons', 'A mix'] },
  });
});

test('<choices multi> lets the player pick several', () => {
  const raw = `Which professions?\n${block('<choices multi>', ['Mining', 'Engineering', 'Fishing'])}`;
  const res = parseChoices(raw);
  assert.equal(res.choices.multi, true);
  assert.deepEqual(res.choices.options, ['Mining', 'Engineering', 'Fishing']);
  assert.equal(res.text, 'Which professions?');
});

test('trailing whitespace after </choices> is allowed, options are trimmed', () => {
  const raw = `Pick one\n<choices>\n  Yes \nNo\n</choices>\n\n  \n`;
  assert.deepEqual(parseChoices(raw), { text: 'Pick one', choices: { multi: false, options: ['Yes', 'No'] } });
});

test('six options of 40 characters are still a block', () => {
  const opts = ['a', 'b', 'c', 'd', 'e', 'x'.repeat(40)];
  assert.deepEqual(parseChoices(`Q\n${block('<choices>', opts)}`).choices.options, opts);
});

for (const [name, raw] of [
  ['one option', `Q\n${block('<choices>', ['Only'])}`],
  ['seven options', `Q\n${block('<choices>', ['1', '2', '3', '4', '5', '6', '7'])}`],
  ['a 41-character option', `Q\n${block('<choices>', ['Short', 'y'.repeat(41)])}`],
  ['an empty option line', `Q\n${block('<choices>', ['Yes', '', 'No'])}`],
  ['a missing </choices>', 'Q\n<choices>\nYes\nNo'],
  ['a block followed by more text', `Q\n${block('<choices>', ['Yes', 'No'])}\nAnd then more.`],
  ['an unknown opening tag', `Q\n${block('<choices many>', ['Yes', 'No'])}`],
  ['an opening tag not on its own line', `Q <choices>\nYes\nNo\n</choices>`],
  ['no block at all', 'Just an answer, a < b and b > c.'],
]) {
  test(`${name} is not a chip block: text unchanged`, () => {
    assert.deepEqual(parseChoices(raw), { text: raw, choices: null });
  });
}

test('only the last block counts; an earlier one stays as written', () => {
  const first = block('<choices>', ['A', 'B']);
  const raw = `One\n${first}\nTwo\n${block('<choices>', ['C', 'D'])}`;
  const res = parseChoices(raw);
  assert.deepEqual(res.choices.options, ['C', 'D']);
  assert.equal(res.text, `One\n${first}\nTwo`);
});

test('visibleText hides a trailing tag, complete or partial', () => {
  assert.equal(visibleText('Pick one\n<cho'), 'Pick one\n');
  assert.equal(visibleText('Pick one\n<'), 'Pick one\n');
  assert.equal(visibleText('Pick one\n<choices'), 'Pick one\n');
  assert.equal(visibleText('Pick one\n<choices mu'), 'Pick one\n');
  assert.equal(visibleText('Pick one\n<choices>\nYes\nN'), 'Pick one\n');
  assert.equal(visibleText('Pick one\n<choices>\nYes\nNo\n</choices>'), 'Pick one\n');
  assert.equal(visibleText('Pick one\n<choices>\nYes\nNo\n</choices>\n'), 'Pick one\n');
});

test('visibleText leaves ordinary text alone', () => {
  assert.equal(visibleText('a < b'), 'a < b');
  assert.equal(visibleText('a <'), 'a <');
  assert.equal(visibleText(''), '');
  assert.equal(visibleText('Plain answer.\n'), 'Plain answer.\n');
  // A block followed by more text is not a chip block: it shows as written.
  const later = 'Q\n<choices>\nYes\nNo\n</choices>\nMore text';
  assert.equal(visibleText(later), later);
});

test('answerFromChoices joins the picks in plain words', () => {
  assert.equal(answerFromChoices(['Mining']), 'Mining');
  assert.equal(answerFromChoices(['Mining', 'Fishing']), 'Mining and Fishing');
  assert.equal(answerFromChoices(['Mining', 'Engineering', 'Fishing']), 'Mining, Engineering and Fishing');
  assert.equal(answerFromChoices([]), '');
});
