// Decides which hints the chat page draws: rows on the empty chat, chips above the input
// once a conversation is under way. Pure: no I/O, no DOM.
import { MAX_ROWS, MAX_CHIPS } from './hints.js';

// Notices (hints without a prompt, like the update notice) are always shown, first, and take
// none of the slots the chat hints are capped at.
// `choices` ({ multi, options } from choices.js) are the reply chips the last answer offered:
// while offered they take the place of the chat hint chips and of every notice but the update
// notice (one obvious action: answer the question); a multi choice ends with a "Send these"
// chip. The hotkey notice is a row on the empty chat only: as a chip it could not be closed.
export function visibleHints({ live = [], starters = [], dismissed = new Set(), empty = true, choices = null } = {}) {
  const open = live.filter((h) => !dismissed.has(h.key));
  const notices = open.filter((h) => h.prompt == null);
  const chat = open.filter((h) => h.prompt != null);
  if (empty) return { rows: [...notices, ...chat.slice(0, MAX_ROWS)], chips: [], starters };
  if (choices?.options?.length) return { rows: [], chips: [...notices.filter((h) => h.kind === 'update'), ...choiceChips(choices)], starters: [] };
  return { rows: [], chips: [...notices.filter((h) => h.kind !== 'hotkey'), ...chat.slice(0, MAX_CHIPS)], starters: [] };
}

function choiceChips({ multi, options }) {
  const chips = options.map((o, i) => ({ key: `choice-${i}`, kind: 'choice', index: i, label: o, text: o, prompt: o }));
  if (multi) chips.push({ key: 'choice-send', kind: 'choice-send', label: 'Send these', text: 'Send the ones you picked', prompt: null });
  return chips;
}
