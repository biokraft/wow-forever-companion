// Turns a character's nudges into clickable hint chips. Pure: no I/O, no DOM.

export const STARTERS = [
  { label: 'What next?', prompt: 'What should I do next?' },
  { label: 'Plan my route', prompt: 'Plan my route for this zone' },
  { label: 'Professions', prompt: 'What is my next profession step?' },
];
export const MAX_ROWS = 4;
export const MAX_CHIPS = 3;

const PRIORITY = ['quests_ready', 'level_up', 'talent_points', 'trainer_due', 'bag_upgrade', 'bags_full', 'rested'];

const PROMPTS = {
  quests_ready: 'Which quests can I turn in now, where, and in what order?',
  talent_points: 'Where should I spend my unspent talent point(s)?',
  trainer_due: 'What should I train at my class trainer now, and where is the nearest one?',
  bags_full: 'My bags are nearly full. What can I sell or drop?',
  rested: 'I have rested XP. How do I use it best right now?',
};

function questsReady(n, merged) {
  const quests = merged.quests;
  if (!Array.isArray(quests)) return { label: n.short, key: 'quests_ready' };
  const done = quests.filter((q) => q.complete);
  const ids = done.map((q) => String(q.id)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return { label: `${done.length} turn-ins ready`, key: `quests_ready:${ids.join(',')}` };
}

function fromNudge(n, merged) {
  const base = { kind: n.kind, label: n.short, text: n.text, key: n.kind, prompt: PROMPTS[n.kind] };
  switch (n.kind) {
    case 'quests_ready':
      return { ...base, ...questsReady(n, merged) };
    case 'talent_points':
      return { ...base, key: `talent_points:${merged.talents?.unspent ?? 0}` };
    case 'trainer_due':
      return { ...base, key: `trainer_due:${merged.level}` };
    case 'bag_upgrade': {
      const name = String(n.text ?? '').split(' looks better than')[0];
      return { ...base, key: `bag_upgrade:${n.itemId}`, prompt: `Is ${name} in my bags an upgrade? Should I equip it?` };
    }
    default:
      return base;
  }
}

// The new-version notice. It has no question to ask (prompt null): clicking it sends nothing.
export function updateHint(update) {
  if (!update?.newer || typeof update.latest !== 'string') return [];
  return [{ key: 'update', kind: 'update', label: `${update.latest} is out`, text: 'run: node bin/wowf update', prompt: null }];
}

// While the character has no game plan (readCharacter sets gamePlan to null): a hint that opens
// the plan page. It sends nothing (prompt null; the page acts on `action`), is never dismissed
// and goes once a plan exists. Unknown (no gamePlan field at all): no hint.
export function planHint(merged) {
  if (!merged || merged.gamePlan !== null) return [];
  return [{ key: 'gameplan', kind: 'gameplan', label: 'Set up your game plan', text: 'Opens the Plan page', prompt: null, action: 'open-plan' }];
}

/**
 * Hints in the order shown: the update notice first, then the game plan hint, then the nudges
 * by priority.
 */
export function buildHints({ merged, synced, dismissed = new Set(), update } = {}) {
  return [...updateHint(update), ...planHint(merged), ...nudgeHints({ merged, synced, dismissed })];
}

function nudgeHints({ merged, synced, dismissed }) {
  if (!merged || !Array.isArray(merged.nudges)) return [];
  const levelUp = Number.isFinite(merged.level) && Number.isFinite(synced?.level) && merged.level > synced.level;

  const hints = merged.nudges
    .filter((n) => PRIORITY.includes(n.kind) && n.kind !== 'level_up')
    .filter((n) => !(levelUp && n.kind === 'talent_points'))
    .map((n) => fromNudge(n, merged));

  if (levelUp) {
    hints.push({
      key: `level_up:${merged.level}`,
      kind: 'level_up',
      label: `Level ${merged.level}!`,
      text: `You reached level ${merged.level}`,
      prompt: `I just reached level ${merged.level}. What should I do now: talents, trainer, new quests?`,
    });
  }

  // Array sort is stable, so several bag upgrades keep their nudge order.
  return hints
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
    .filter((h) => !dismissed.has(h.key));
}
