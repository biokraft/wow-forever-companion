// Which quests can this character pick up right now? Works on a QuestieDb (see db.js).
const hasBit = (mask, id) => !mask || Math.floor(mask / 2 ** (id - 1)) % 2 === 1;

// Questie's requiredSkill ids are classic skill lines; Forever snapshots carry their own ids,
// so match professions by name and fall back to the id.
export const SKILL_NAMES = { 129: 'First Aid', 164: 'Blacksmithing', 165: 'Leatherworking', 171: 'Alchemy',
  182: 'Herbalism', 185: 'Cooking', 186: 'Mining', 197: 'Tailoring', 202: 'Engineering', 333: 'Enchanting',
  356: 'Fishing', 393: 'Skinning', 633: 'Lockpicking', 762: 'Riding' };

function hasSkill(skills, [skillId, minRank = 1]) {
  const name = SKILL_NAMES[skillId];
  const s = skills.find((k) => (name && k.name === name) || k.id === skillId);
  return !!s && (s.rank ?? 0) >= minRank;
}

function startOf(db, quest) {
  const { npcs = [], objects = [], items = [] } = quest.startedBy ?? {};
  for (const id of npcs) {
    const npc = db.npc(id);
    if (!npc) continue;
    const zones = Object.keys(npc.spawns ?? {});
    const zoneId = npc.zoneId || Number(zones[0]) || 0;
    const [x, y] = npc.spawns?.[zoneId]?.[0] ?? npc.spawns?.[zones[0]]?.[0] ?? [];
    return { kind: 'npc', id, name: npc.name, zoneId, x: x ?? null, y: y ?? null };
  }
  for (const id of objects) {
    const obj = db.object(id);
    if (obj) return { kind: 'object', id, name: obj.name, zoneId: obj.zoneId, x: null, y: null };
  }
  if (items.length) return { kind: 'item', id: items[0], name: null, zoneId: 0, x: null, y: null };
  return null;
}

// unsettled: quests whose state is unknown (left the log since the last sync: turned in or
// abandoned). They and their next-in-chain quests are not offered; quests that need them
// completed stay out because they are not in completed, and child quests because they are
// not in inLog.
export function availableQuests(db, { level, raceId, classId, completed = new Set(), inLog = new Set(), unsettled = new Set(), skills, zoneIds, band } = {}) {
  const [lo, hi] = band ?? [level - 3, level + 3];
  const followUps = new Set([...unsettled].map((u) => db.quest(u)?.nextQuestInChain).filter(Boolean));
  const out = [];
  for (const id of db.questIds()) {
    if (completed.has(id) || inLog.has(id) || unsettled.has(id) || followUps.has(id)) continue;
    const q = db.quest(id);
    if (!q || !q.name) continue;
    if (q.requiredLevel > level) continue;
    if (q.requiredMaxLevel && q.requiredMaxLevel < level) continue;
    const ql = q.questLevel > 0 ? q.questLevel : q.requiredLevel;
    if (ql < lo || ql > hi) continue;
    if (!hasBit(q.requiredRaces, raceId) || !hasBit(q.requiredClasses, classId)) continue;
    if (!q.preQuestGroup.every((p) => completed.has(p))) continue;
    if (q.preQuestSingle.length && !q.preQuestSingle.some((p) => completed.has(p))) continue;
    if (q.exclusiveTo.some((p) => completed.has(p))) continue;
    if (q.parentQuest && !inLog.has(q.parentQuest)) continue;
    if (skills && q.requiredSkill && !hasSkill(skills, q.requiredSkill)) continue;
    const start = startOf(db, q);
    const zoneId = start?.zoneId || (q.zoneOrSort > 0 ? q.zoneOrSort : 0);
    if (zoneIds && !zoneIds.includes(zoneId)) continue;
    out.push({ id, name: q.name, questLevel: ql, requiredLevel: q.requiredLevel, zoneId, start });
  }
  return out.sort((a, b) => a.questLevel - b.questLevel || a.name.localeCompare(b.name));
}
