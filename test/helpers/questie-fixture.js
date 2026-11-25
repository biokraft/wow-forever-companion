// Builds a tiny baked QuestieDB install the way the real one is laid out.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { encodeCbor } from './cbor-encode.js';

const b64 = (buf) => buf.toString('base64');

// Builds a tiny baked QuestieDB_Forever.toc the way the real one is laid out.
export function bakeToc() {
  const lines = ['## Interface: 16001', '## X-Mode: baked'];
  const put = (k, v) => lines.push(`## ${k}: ${v}`);
  const ids = (list) => b64(zlib.deflateSync(encodeCbor(list)));
  // chunk the quest ID header to exercise reassembly
  const questIds = ids([100, 101, 102]);
  const half = Math.ceil(questIds.length / 2);
  put('X-Quest-IDS', '~2~');
  put('X-Quest-IDS-1', questIds.slice(0, half));
  put('X-Quest-IDS-2', questIds.slice(half));
  // presence bit for table field n is 2^(n-1): 2 startedBy, 3 finishedBy, 13 preQuestSingle
  const p = 2 ** 1 + 2 ** 2;
  put('X-Quest-100-S', b64(encodeCbor({ 1: 'Test Quest', 4: 1, 5: 2, 6: 178, 17: 14, p })));
  put('X-Quest-100-2', b64(encodeCbor([[500]])));
  put('X-Quest-100-3', b64(encodeCbor([[500]])));
  put('X-Quest-101-S', b64(encodeCbor({ 1: 'Follow Up', 4: 2, 5: 3, 7: 1, 17: 14, p: p + 2 ** 12 })));
  put('X-Quest-101-2', b64(encodeCbor([[500]])));
  put('X-Quest-101-3', b64(encodeCbor([[500]])));
  put('X-Quest-101-13', b64(encodeCbor([100])));
  // 102: Blacksmithing quest (table field 18 requiredSkill) that is a child of 101 (scalar field 25)
  put('X-Quest-102-S', b64(encodeCbor({ 1: 'Smithing Task', 4: 2, 5: 3, 17: 14, 25: 101, p: p + 2 ** 17 })));
  put('X-Quest-102-2', b64(encodeCbor([[500]])));
  put('X-Quest-102-3', b64(encodeCbor([[500]])));
  put('X-Quest-102-18', b64(encodeCbor([164, 1])));
  put('X-Npc-IDS', ids([500]));
  put('X-Npc-500-S', b64(encodeCbor({ 1: 'Test Giver', 4: 5, 5: 5, 9: 14, 14: 'Weapon Master', p: 2 ** 6 })));
  put('X-Npc-500-7', b64(encodeCbor({ 14: [[50.1, 60.2]] })));
  put('X-Object-IDS', ids([700]));
  put('X-Object-700-S', b64(encodeCbor({ 1: 'Test Chest', 5: 14 })));
  return lines.join('\n') + '\n';
}


export function writeFakeQuestie(addonsDir) {
  fs.mkdirSync(path.join(addonsDir, 'QuestieDB', 'src', 'corrections', 'enum'), { recursive: true });
  fs.writeFileSync(path.join(addonsDir, 'QuestieDB', 'QuestieDB_Forever.toc'), bakeToc());
  fs.writeFileSync(path.join(addonsDir, 'QuestieDB', 'src', 'corrections', 'enum', 'zones.lua'),
    'local zoneIDs = {\n  DUROTAR = 14,\n  THE_BARRENS = 17,\n  STORMWIND_CITY = 1519,\n}\n');
  fs.mkdirSync(path.join(addonsDir, 'QuestieDB', 'support', 'Forever', 'Zones'), { recursive: true });
  fs.writeFileSync(path.join(addonsDir, 'QuestieDB', 'support', 'Forever', 'Zones', 'areaIdToUiMapId.lua'),
    'ZoneDB.private.areaIdToUiMapIdOverride = [[return {\n    [0] = 0, -- Existing fail-safe\n    [14] = 1411, -- Durotar\n    [17] = 1413, -- The Barrens\n}]]\n');
}
