import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPageState, canSwitch, cardMode, foldsWith, introSeenWith, KICKOFF, START_LABEL, FOLD_IDS, NO_PLAN_CHAT_TEXT } from '../src/plan-page.js';

test('page state: no snapshot is empty, a first look without a plan is the intro, else the card', () => {
  assert.equal(planPageState({ hasSnapshot: false, hasPlan: false, introSeen: false }), 'empty');
  assert.equal(planPageState({ hasSnapshot: false, hasPlan: true, introSeen: true }), 'empty');
  assert.equal(planPageState({ hasSnapshot: true, hasPlan: false, introSeen: false }), 'intro');
  assert.equal(planPageState({ hasSnapshot: true, hasPlan: false, introSeen: true }), 'card');
  assert.equal(planPageState({ hasSnapshot: true, hasPlan: true, introSeen: false }), 'card');
  assert.equal(planPageState({ hasSnapshot: true, hasPlan: true, introSeen: true }), 'card');
});

test('the Plan button switches only while nothing is answering or switching', () => {
  assert.equal(canSwitch({ busy: false }), true);
  assert.equal(canSwitch({ busy: true }), false);
  assert.equal(canSwitch({ busy: false, switching: true }), false);
});

test('card mode: the start chip only on an empty plan chat without a plan', () => {
  assert.equal(cardMode({ hasSnapshot: false, hasPlan: false, chatEmpty: true }), 'empty');
  assert.equal(cardMode({ hasSnapshot: true, hasPlan: false, chatEmpty: true }), 'start');
  assert.equal(cardMode({ hasSnapshot: true, hasPlan: false, chatEmpty: false }), 'none');
  assert.equal(cardMode({ hasSnapshot: true, hasPlan: true, chatEmpty: true }), 'card');
  assert.equal(cardMode({ hasSnapshot: true, hasPlan: true, chatEmpty: false }), 'card');
});

test('the kickoff is the plain sentence the player sees; the chip has its plain label', () => {
  assert.equal(START_LABEL, 'Start my game plan');
  assert.equal(KICKOFF, 'Help me set up my game plan.');
});

test('folds: a folded id is saved as false, unfolding removes it, unknown ids change nothing', () => {
  assert.deepEqual(foldsWith(undefined, 'goal', false), { goal: false });
  assert.deepEqual(foldsWith({ goal: false }, 'card', false), { goal: false, card: false });
  assert.deepEqual(foldsWith({ goal: false, card: false }, 'goal', true), { card: false });
  assert.equal(foldsWith({}, '__proto__', false), null);
  assert.equal(foldsWith({}, 'nope', false), null);
  assert.equal(foldsWith({}, 'goal', 'no'), null, 'open must be a boolean');
  assert.deepEqual(FOLD_IDS, ['card', 'goal', 'role', 'playstyle', 'professions', 'milestones', 'avoid', 'notes']);
  // Junk in the saved config is dropped, not carried along.
  assert.deepEqual(foldsWith({ goal: 'x', bogus: false, avoid: false }, 'notes', false), { avoid: false, notes: false });
});

test('intro seen is kept per character', () => {
  assert.deepEqual(introSeenWith(undefined, 'realm-thrall'), { 'realm-thrall': true });
  assert.deepEqual(introSeenWith({ 'realm-jaina': true }, 'realm-thrall'), { 'realm-jaina': true, 'realm-thrall': true });
  assert.equal(introSeenWith({}, ''), null);
  assert.equal(introSeenWith({}, '__proto__'), null);
});

test('a character whose name gives no plan chat id never gets the intro and reads a truthful line', () => {
  assert.equal(planPageState({ hasSnapshot: true, hasPlan: false, introSeen: false, hasPlanChat: false }), 'card');
  assert.equal(planPageState({ hasSnapshot: true, hasPlan: false, introSeen: false, hasPlanChat: true }), 'intro');
  assert.equal(cardMode({ hasSnapshot: true, hasPlan: false, chatEmpty: true, hasPlanChat: false }), 'unsupported');
  assert.equal(cardMode({ hasSnapshot: true, hasPlan: true, chatEmpty: true, hasPlanChat: false }), 'unsupported');
  assert.equal(cardMode({ hasSnapshot: false, hasPlan: false, chatEmpty: true, hasPlanChat: false }), 'empty');
  assert.doesNotMatch(NO_PLAN_CHAT_TEXT, /No character data/);
});
