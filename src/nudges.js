// Cheap, deterministic hints computed from a snapshot (no Claude needed).

const SLOTS = {
  INVTYPE_HEAD: [1], INVTYPE_NECK: [2], INVTYPE_SHOULDER: [3], INVTYPE_CHEST: [5], INVTYPE_ROBE: [5],
  INVTYPE_WAIST: [6], INVTYPE_LEGS: [7], INVTYPE_FEET: [8], INVTYPE_WRIST: [9], INVTYPE_HAND: [10],
  INVTYPE_FINGER: [11, 12], INVTYPE_TRINKET: [13, 14], INVTYPE_CLOAK: [15],
  INVTYPE_WEAPON: [16, 17], INVTYPE_2HWEAPON: [16], INVTYPE_WEAPONMAINHAND: [16],
  INVTYPE_WEAPONOFFHAND: [17], INVTYPE_SHIELD: [17], INVTYPE_HOLDABLE: [17],
  INVTYPE_RANGED: [18], INVTYPE_RANGEDRIGHT: [18], INVTYPE_THROWN: [18],
};
const ALWAYS_WEARABLE = new Set(['INVTYPE_NECK', 'INVTYPE_FINGER', 'INVTYPE_TRINKET', 'INVTYPE_CLOAK']);
const OFF_HAND = new Set(['INVTYPE_WEAPONOFFHAND', 'INVTYPE_SHIELD', 'INVTYPE_HOLDABLE']);

// Item subType -> the weapon skill line that governs it (Classic skill names).
const WEAPON_SKILL = {
  'One-Handed Axes': 'Axes', 'Two-Handed Axes': 'Two-Handed Axes',
  'One-Handed Maces': 'Maces', 'Two-Handed Maces': 'Two-Handed Maces',
  'One-Handed Swords': 'Swords', 'Two-Handed Swords': 'Two-Handed Swords',
  Polearms: 'Polearms', Staves: 'Staves', Daggers: 'Daggers', 'Fist Weapons': 'Fist Weapons',
  Bows: 'Bows', Crossbows: 'Crossbows', Guns: 'Guns', Thrown: 'Thrown', Wands: 'Wands',
};

export function itemScore(item, weights) {
  if (!item) return 0;
  let score = 0;
  for (const [stat, value] of Object.entries(item.stats ?? {})) score += (weights[stat] ?? 0) * value;
  score += (weights.armor ?? 0) * (item.armor ?? 0);
  return score;
}

function canUse(item, s, k) {
  if (!SLOTS[item.equipLoc]) return false;
  if ((item.minLevel ?? 0) > s.level) return false;
  if (ALWAYS_WEARABLE.has(item.equipLoc)) return true;
  const allowed = [...(k.armor ?? []), ...(k.weapons ?? []), ...(s.level >= 40 ? k.armorFrom40 ?? [] : [])];
  if (!allowed.includes(item.subType)) return false;
  const skill = WEAPON_SKILL[item.subType];
  const known = (s.skills ?? []).filter((x) => x.kind === 'weapon').map((x) => x.name);
  // Unknown skill list (older snapshot): do not filter on it.
  if (skill && known.length && !known.includes(skill)) return false;
  return true;
}

const equippedAt = (s, slot) => s.equipped?.[slot] ?? s.equipped?.[String(slot)];

function bagUpgrades(s, k) {
  const out = [];
  const weights = k.statWeights ?? {};
  const score = (it) => itemScore(it, weights);
  const mainHand = equippedAt(s, 16);
  const twoHanderEquipped = mainHand?.equipLoc === 'INVTYPE_2HWEAPON';
  const canDualWield = k.dualWieldLevel != null && s.level >= k.dualWieldLevel;

  for (const entry of s.bags ?? []) {
    const item = entry.item;
    if (!item || !canUse(item, s, k)) continue;
    let slots = SLOTS[item.equipLoc];
    if (item.equipLoc === 'INVTYPE_WEAPON' && !canDualWield) slots = [16];

    let currentName, currentScore, slot;
    const handWeapon = item.equipLoc === 'INVTYPE_2HWEAPON' || slots.includes(16) || OFF_HAND.has(item.equipLoc);
    if (handWeapon && twoHanderEquipped && item.equipLoc !== 'INVTYPE_2HWEAPON') {
      // A one-hander or off-hand replaces the two-hander, so it has to beat it.
      currentName = mainHand.name;
      currentScore = score(mainHand);
      slot = 16;
    } else {
      // Compare against the weakest item in the slots it could go to.
      const weakest = slots.map((sl) => ({ slot: sl, item: equippedAt(s, sl) })).sort((a, b) => score(a.item) - score(b.item))[0];
      currentName = weakest.item?.name;
      currentScore = score(weakest.item);
      slot = weakest.slot;
      if (item.equipLoc === 'INVTYPE_2HWEAPON') currentScore += score(equippedAt(s, 17));
    }
    const gain = score(item) - currentScore;
    if (gain > 0.5) {
      out.push({
        kind: 'bag_upgrade',
        short: 'upgrade in bags',
        text: `${item.name} looks better than ${currentName ?? 'an empty slot'} (score +${gain.toFixed(1)})`,
        itemId: item.id,
        slot,
      });
    }
  }
  return out;
}

// `classData` is the player's researched data for the character's class (classdata.js), or
// null while there is none: then no bag-upgrade reminders.
export function computeNudges(s, { classData, journal = [] } = {}) {
  const nudges = [];
  const unspent = s.talents?.unspent ?? 0;
  if (unspent > 0) {
    nudges.push({ kind: 'talent_points', short: 'talent point', text: `${unspent} unspent talent point${unspent > 1 ? 's' : ''}` });
  }

  // Class trainers have new ranks at every even level. Profession trainer visits do not count.
  const lastClassTrainer = journal
    .filter((e) => e.kind === 'trainer' && (e.data?.kind ?? 'class') === 'class')
    .reduce((m, e) => Math.max(m, e.data?.level ?? 0), 0);
  if (s.level % 2 === 0 && lastClassTrainer < s.level) {
    nudges.push({ kind: 'trainer_due', short: 'trainer due', text: `Level ${s.level}: new ranks to train at your class trainer` });
  }

  if (classData) nudges.push(...bagUpgrades(s, classData));

  if ((s.bagSlotsTotal ?? 0) > 0 && (s.bagSlotsFree ?? 99) <= 2) {
    nudges.push({ kind: 'bags_full', short: 'bags full', text: `Only ${s.bagSlotsFree} bag slot(s) free` });
  }

  const ready = (s.quests ?? []).filter((q) => q.complete && !q.leftLog); // leftLog: live, gone from the log
  if (ready.length) {
    nudges.push({ kind: 'quests_ready', short: 'turn-ins ready', text: `Ready to turn in: ${ready.map((q) => q.title).join(', ')}` });
  }

  if ((s.rested ?? 0) > 0) {
    nudges.push({ kind: 'rested', short: 'rested', text: `${s.rested} rested XP banked (double XP from kills)` });
  }
  return nudges;
}
