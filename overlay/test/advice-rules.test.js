import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADVICE_RULES, AI_NOTICE } from '../src/advice-rules.js';

test('the advice rules refuse rotation and live combat calls', () => {
  assert.equal(ADVICE_RULES, 'Never give rotation advice or real-time combat calls (what to press, when to interrupt, where to stand during a fight). Help with leveling, quests, routes, gear, talents, professions and preparation only. If asked for live combat help, say this tool does not do that.');
});

test('the welcome screen tells the player the answers come from an AI', () => {
  assert.equal(AI_NOTICE, 'Answers come from an AI and can be wrong.');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const welcome = /<div id="welcome" hidden>([\s\S]*?)\n {6}<\/div>/.exec(html);
  assert.ok(welcome, 'welcome block present');
  assert.ok(welcome[1].includes(`<div class="muted">${AI_NOTICE}</div>`), 'one muted line inside the welcome block');
});

test('the reply chip rules give the exact syntax and when to use it', async () => {
  const { CHOICES_RULES } = await import('../src/advice-rules.js');
  assert.equal(typeof CHOICES_RULES, 'string');
  for (const part of ['<choices>', '<choices multi>', '</choices>', '2 to 6', '40 characters', 'at most one', 'open questions', 'type']) {
    assert.ok(CHOICES_RULES.includes(part), part);
  }
});
