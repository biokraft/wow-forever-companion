// Read-only view over the user's installed QuestieDB (baked mode). See toc.js for the format.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeCbor } from './cbor.js';
import { readTocMetadata } from './toc.js';

const TOC_NAMES = ['QuestieDB_Forever.toc', 'QuestieDB.toc'];

// Field indices from QuestieDB/src/meta/questMeta.lua and npcMeta.lua.
const Q = { name: 1, startedBy: 2, finishedBy: 3, requiredLevel: 4, questLevel: 5, requiredRaces: 6,
  requiredClasses: 7, preQuestGroup: 12, preQuestSingle: 13, exclusiveTo: 16, zoneOrSort: 17, requiredSkill: 18,
  nextQuestInChain: 22, parentQuest: 25, breadcrumbForQuestId: 27, requiredMaxLevel: 32 };
const N = { name: 1, minLevel: 4, maxLevel: 5, spawns: 7, zoneId: 9, subName: 14 };
const O = { name: 1, zoneId: 5 };

const decode = (b64) => decodeCbor(Buffer.from(b64, 'base64'), { bytesAsString: true });
const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const hasBit = (mask, field) => Math.floor((mask || 0) / 2 ** (field - 1)) % 2 === 1;

/** The installed QuestieDB .toc (Forever's first), or undefined when Questie is missing. */
export function questieTocPath(addonsDir) {
  return TOC_NAMES.map((n) => path.join(addonsDir, 'QuestieDB', n)).find((p) => fs.existsSync(p));
}

export function openQuestieDb(addonsDir) {
  const tocPath = questieTocPath(addonsDir);
  if (!tocPath) return null;
  // The baked .toc is large (~19 MB); read it on the first row lookup, not for zone names.
  let metaCache;
  const meta = { get: (key) => (metaCache ??= readTocMetadata(tocPath)).get(key) };

  const idCache = new Map();
  const ids = (entity) => {
    if (!idCache.has(entity)) {
      const v = meta.get(`X-${entity}-IDS`);
      idCache.set(entity, v ? decodeCbor(zlib.inflateSync(Buffer.from(v, 'base64'))) : []);
    }
    return idCache.get(entity);
  };
  const scalar = (entity, id) => {
    const v = meta.get(`X-${entity}-${id}-S`);
    return v === undefined ? null : decode(v);
  };
  const table = (entity, id, row, field) => {
    if (!hasBit(row.p, field)) return undefined;
    const v = meta.get(`X-${entity}-${id}-${field}`);
    return v === undefined ? undefined : decode(v);
  };

  let zones;
  const zoneName = (id) => {
    if (!zones) {
      zones = new Map();
      const enumFile = path.join(addonsDir, 'QuestieDB', 'src', 'corrections', 'enum', 'zones.lua');
      const text = fs.existsSync(enumFile) ? fs.readFileSync(enumFile, 'utf8') : '';
      const small = new Set(['of', 'the', 'and']);
      for (const [, key, num] of text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm)) {
        if (zones.has(Number(num))) continue;
        const words = key.toLowerCase().split('_');
        zones.set(Number(num), words.map((w, i) => (i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' '));
      }
    }
    return zones.get(Number(id)) ?? null;
  };

  let uiMaps;
  const uiMapId = (areaId) => {
    if (!uiMaps) {
      uiMaps = new Map();
      const file = path.join(addonsDir, 'QuestieDB', 'support', 'Forever', 'Zones', 'areaIdToUiMapId.lua');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      for (const [, area, map] of text.matchAll(/^\s*\[(\d+)\]\s*=\s*(\d+)\s*,/gm)) {
        if (!uiMaps.has(Number(area))) uiMaps.set(Number(area), Number(map));
      }
    }
    const v = uiMaps.get(Number(areaId));
    return v ? v : null;
  };
  // uiMapId -> zone name: the first area (in file order) mapped to it that has a zone name.
  let uiMapZones;
  const uiMapZoneName = (mapId) => {
    if (!uiMapZones) {
      uiMapId(0); // make sure the area table is loaded
      uiMapZones = new Map();
      for (const [area, map] of uiMaps) {
        const name = map && !uiMapZones.has(map) ? zoneName(area) : null;
        if (name) uiMapZones.set(map, name);
      }
    }
    return uiMapZones.get(Number(mapId)) ?? null;
  };
  const zoneIdByName = (name) => {
    zoneName(0); // make sure the zone table is loaded
    const wanted = String(name).trim().toLowerCase();
    for (const [id, n] of zones) if (n.toLowerCase() === wanted) return id;
    return null;
  };

  const rowCache = new Map();
  const cached = (key, build) => {
    if (!rowCache.has(key)) rowCache.set(key, build());
    return rowCache.get(key);
  };

  // Linear scan over all NPC rows (~15k on Forever, ~0.1 s); rows are cached afterwards.
  const findNpcs = (query, limit = 10) => {
    const q = String(query).trim().toLowerCase();
    if (!q) return [];
    const exact = [];
    const partial = [];
    for (const id of ids('Npc')) {
      const row = scalar('Npc', id);
      const name = row?.[N.name];
      if (typeof name !== 'string') continue;
      const lower = name.toLowerCase();
      if (lower === q) exact.push(id);
      else if (lower.includes(q)) partial.push(id);
      if (exact.length >= limit) break;
    }
    return [...exact, ...partial].slice(0, limit).map((id) => api.npc(id));
  };

  const api = {
    zoneName,
    findNpcs,
    uiMapId,
    uiMapZoneName,
    zoneIdByName,
    questIds: () => ids('Quest'),
    quest: (id) => cached(`q${id}`, () => {
      const row = scalar('Quest', id);
      if (!row) return null;
      const t = (f) => table('Quest', id, row, f);
      const started = list(t(Q.startedBy));
      const finished = list(t(Q.finishedBy));
      return {
        id,
        name: row[Q.name] ?? null,
        requiredLevel: row[Q.requiredLevel] ?? 0,
        questLevel: row[Q.questLevel] ?? 0,
        requiredRaces: row[Q.requiredRaces] ?? 0,
        requiredClasses: row[Q.requiredClasses] ?? 0,
        startedBy: { npcs: list(started[0]), objects: list(started[1]), items: list(started[2]) },
        finishedBy: { npcs: list(finished[0]), objects: list(finished[1]) },
        preQuestGroup: list(t(Q.preQuestGroup)),
        preQuestSingle: list(t(Q.preQuestSingle)),
        exclusiveTo: list(t(Q.exclusiveTo)),
        zoneOrSort: row[Q.zoneOrSort] ?? 0,
        nextQuestInChain: row[Q.nextQuestInChain] ?? 0,
        parentQuest: row[Q.parentQuest] ?? 0,
        requiredSkill: list(t(Q.requiredSkill)).length ? list(t(Q.requiredSkill)) : null,
        breadcrumbForQuestId: row[Q.breadcrumbForQuestId] ?? 0,
        requiredMaxLevel: row[Q.requiredMaxLevel] ?? 0,
      };
    }),
    npc: (id) => cached(`n${id}`, () => {
      const row = scalar('Npc', id);
      if (!row) return null;
      return {
        id,
        name: row[N.name] ?? null,
        title: typeof row[N.subName] === 'string' ? row[N.subName] : null,
        minLevel: row[N.minLevel] ?? 0,
        maxLevel: row[N.maxLevel] ?? 0,
        zoneId: row[N.zoneId] ?? 0,
        spawns: table('Npc', id, row, N.spawns) ?? {},
      };
    }),
    object: (id) => cached(`o${id}`, () => {
      const row = scalar('Object', id);
      if (!row) return null;
      return { id, name: row[O.name] ?? null, zoneId: row[O.zoneId] ?? 0 };
    }),
  };
  return api;
}
