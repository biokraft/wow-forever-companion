// Human-readable "Name (Zone x, y)" for an NPC from the quest database.
export function npcPlace(db, npc) {
  const zones = Object.keys(npc.spawns ?? {});
  const zone = npc.zoneId || (zones.length ? Number(zones[0]) : 0);
  const [x, y] = npc.spawns?.[zone]?.[0] ?? npc.spawns?.[zones[0]]?.[0] ?? [];
  const who = npc.title ? `${npc.name} <${npc.title}>` : npc.name;
  if (!zone) return `${who} (location unknown)`;
  const zoneLabel = db.zoneName(zone) ?? `zone ${zone}`;
  return x == null ? `${who} (${zoneLabel})` : `${who} (${zoneLabel} ${Number(x).toFixed(1)}, ${Number(y).toFixed(1)})`;
}
