-- ForeverLog snapshot collectors. Each section prefers the modern C_* API and falls back to
-- the classic global; a missing API raises inside ns.guard and leaves the section empty.
local ADDON_NAME, ns = ...

ns.collect = {}
local C = ns.collect

local function need(fn, what)
  if not fn then error("no API for " .. what, 0) end
  return fn
end

local function itemIdFromLink(link)
  return link and tonumber(link:match("item:(%d+)")) or nil
end

function ns.itemInfo(link)
  if not link then return nil end
  local getInfo = (C_Item and C_Item.GetItemInfo) or GetItemInfo
  local name, fullLink, quality, ilvl, minLevel, itemType, subType, _, equipLoc = getInfo(link)
  local item = {
    id = itemIdFromLink(link),
    name = name or link:match("%[(.-)%]"),
    link = fullLink or link,
    quality = quality,
    ilvl = ilvl,
    minLevel = minLevel,
    type = itemType,
    subType = subType,
    equipLoc = equipLoc,
  }
  local getStats = (C_Item and C_Item.GetItemStats) or GetItemStats
  local stats = getStats and getStats(link)
  if type(stats) == "table" then
    item.stats = {}
    for k, v in pairs(stats) do item.stats[k] = v end
    item.armor = stats.RESISTANCE0_NAME
  end
  return item
end

function C.identity(s)
  s.name = UnitName("player")
  local realm = GetRealmName and GetRealmName() or ""
  if realm == "" and GetNormalizedRealmName then realm = GetNormalizedRealmName() or "" end
  if realm == "" and UnitFullName then realm = select(2, UnitFullName("player")) or "" end
  s.realm = realm
  local _, raceFile, raceId = UnitRace("player")
  s.raceFile, s.raceId = raceFile, raceId
  local _, classFile, classId = UnitClass("player")
  s.classFile, s.classId = classFile, classId
  s.faction = UnitFactionGroup("player")
end

function C.xp(s)
  s.level = UnitLevel("player")
  s.xp = UnitXP("player")
  s.xpMax = UnitXPMax("player")
  s.rested = GetXPExhaustion() or 0
end

function C.money(s)
  s.money = GetMoney()
end

function C.location(s)
  s.zone = GetZoneText()
  s.subzone = GetSubZoneText()
  local mapId = C_Map and C_Map.GetBestMapForUnit("player")
  s.mapId = mapId
  if mapId then
    local pos = C_Map.GetPlayerMapPosition(mapId, "player")
    if pos then s.x, s.y = pos:GetXY() end
  end
end

function C.equipped(s)
  local equipped = {}
  for slot = 1, 19 do
    local link = GetInventoryItemLink("player", slot)
    if link then equipped[slot] = ns.itemInfo(link) end
  end
  s.equipped = equipped
end

function C.bags(s)
  local Cc = C_Container
  local numSlots = need((Cc and Cc.GetContainerNumSlots) or GetContainerNumSlots, "bag slots")
  local numFree = (Cc and Cc.GetContainerNumFreeSlots) or GetContainerNumFreeSlots
  local bags, free, total = {}, 0, 0
  for bag = 0, 4 do
    local n = numSlots(bag) or 0
    total = total + n
    if numFree then free = free + (numFree(bag) or 0) end
    for slot = 1, n do
      local link, count
      if Cc and Cc.GetContainerItemInfo then
        local info = Cc.GetContainerItemInfo(bag, slot)
        if info then link, count = info.hyperlink, info.stackCount end
      else
        local _, c, _, _, _, _, l = need(GetContainerItemInfo, "bag items")(bag, slot)
        link, count = l, c
      end
      if link then
        bags[#bags + 1] = { bag = bag, slot = slot, count = count or 1, item = ns.itemInfo(link) }
      end
    end
  end
  s.bags, s.bagSlotsFree, s.bagSlotsTotal = bags, free, total
end

local function spellName(spellID)
  if not spellID then return nil end
  if C_Spell and C_Spell.GetSpellName then return C_Spell.GetSpellName(spellID) end
  if GetSpellInfo then return (GetSpellInfo(spellID)) end
end

-- Forever uses modern talent trees (C_ClassTalents + C_Traits).
local function traitTalents(s)
  local configID = C_ClassTalents.GetActiveConfigID()
  if not configID then
    -- No talent config exists before the first talent point (level 10).
    s.talents = { unspent = 0, tabs = {}, source = "traits" }
    return
  end
  local config = C_Traits.GetConfigInfo(configID)
  local unspent, tabs = 0, {}
  for _, treeID in ipairs(config and config.treeIDs or {}) do
    local tab = { name = "tree " .. tostring(treeID), treeID = treeID, points = 0, talents = {} }
    for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
      local node = C_Traits.GetNodeInfo(configID, nodeID)
      if node and node.posX then
        local entryID = (node.activeEntry and node.activeEntry.entryID) or (node.entryIDs and node.entryIDs[1])
        local entry = entryID and C_Traits.GetEntryInfo(configID, entryID)
        local def = entry and entry.definitionID and C_Traits.GetDefinitionInfo(entry.definitionID)
        local rank = node.ranksPurchased or node.activeRank or 0
        tab.points = tab.points + rank
        tab.talents[#tab.talents + 1] = { name = spellName(def and def.spellID), spellID = def and def.spellID,
          rank = rank, maxRank = node.maxRanks, posX = node.posX, posY = node.posY, nodeID = nodeID }
      end
    end
    if C_Traits.GetTreeCurrencyInfo then
      for _, currency in ipairs(C_Traits.GetTreeCurrencyInfo(configID, treeID, false) or {}) do
        unspent = unspent + (currency.quantity or 0)
      end
    end
    tabs[#tabs + 1] = tab
  end
  s.talents = { unspent = unspent, tabs = tabs, source = "traits" }
end

function C.talents(s)
  if C_ClassTalents and C_ClassTalents.GetActiveConfigID and C_Traits and C_Traits.GetConfigInfo then
    return traitTalents(s)
  end
  local numTabs = need(GetNumTalentTabs, "talent tabs")
  local unspent = UnitCharacterPoints and UnitCharacterPoints("player") or 0
  local tabs = {}
  for tab = 1, numTabs() do
    local name, _, points = GetTalentTabInfo(tab)
    local entry = { name = name, points = points or 0, talents = {} }
    for i = 1, (GetNumTalents(tab) or 0) do
      local tname, _, tier, column, rank, maxRank = GetTalentInfo(tab, i)
      entry.talents[#entry.talents + 1] = { name = tname, rank = rank, maxRank = maxRank, tier = tier, column = column }
    end
    tabs[#tabs + 1] = entry
  end
  s.talents = { unspent = unspent, tabs = tabs, source = "classic" }
end

local SKILL_KINDS = {
  ["Professions"] = "profession",
  ["Secondary Skills"] = "secondary",
  ["Weapon Skills"] = "weapon",
}

function C.skills(s)
  local skills, kind, seen = {}, "other", {}
  local function add(name, isHeader, rank, maxRank, id)
    if isHeader then
      kind = SKILL_KINDS[name] or "other"
    elseif name and not seen[name] then
      seen[name] = true
      skills[#skills + 1] = { name = name, rank = rank, max = maxRank, kind = kind, id = id }
    end
  end
  -- Forever replaced the global skill line API with C_SkillInfo; Classic keeps the globals.
  if C_SkillInfo and C_SkillInfo.GetNumSkillLines then
    for i = 1, C_SkillInfo.GetNumSkillLines() do
      local l = C_SkillInfo.GetSkillLineInfo(i)
      if l then add(l.name, l.isHeader, l.rank or l.skillRank, l.maxRank or l.skillMaxRank or l.max, l.skillID) end
    end
  else
    for i = 1, need(GetNumSkillLines, "skill lines")() do
      local name, isHeader, _, rank, _, _, maxRank = GetSkillLineInfo(i)
      add(name, isHeader, rank, maxRank)
    end
  end
  s.skills = skills
end

-- The spellbook: every spell and ability the character knows (class, general and profession
-- pages), so the companion can tell whether a spell is there before it names it in a macro.
-- Spells not learned yet, pet actions and flyouts are left out.
function C.spells(s)
  local spells, seen = {}, {}
  local function add(name, rank, id, tab, passive)
    -- The client pads some ranks ("Apprentice ").
    rank = rank and rank:match("^%s*(.-)%s*$")
    rank = (rank and rank ~= "") and rank or nil
    local key = name and (name .. "|" .. (rank or ""))
    if not name or seen[key] then return end
    seen[key] = true
    spells[#spells + 1] = { name = name, rank = rank, id = id, tab = tab, passive = passive and true or nil }
  end

  -- One spellbook slot: name, rank, id and passive of a known spell; nothing for anything else.
  local readSlot
  local B = C_SpellBook
  local modern = B and B.GetNumSpellBookSkillLines and B.GetSpellBookSkillLineInfo and B.GetSpellBookItemInfo
  if modern then
    local bank = (Enum and Enum.SpellBookSpellBank and Enum.SpellBookSpellBank.Player) or 0
    local SPELL = (Enum and Enum.SpellBookItemType and Enum.SpellBookItemType.Spell) or 1
    readSlot = function(slot)
      local item = B.GetSpellBookItemInfo(slot, bank)
      if item and item.itemType == SPELL and not item.isOffSpec then
        return item.name, item.subName, item.spellID or item.actionID, item.isPassive
      end
    end
  else
    local itemName = need(GetSpellBookItemName, "spell names")
    readSlot = function(slot)
      local kind, id = "SPELL", nil
      if GetSpellBookItemInfo then kind, id = GetSpellBookItemInfo(slot, "spell") end
      if kind ~= "SPELL" then return end
      local name, rank, spellID = itemName(slot, "spell")
      return name, rank, spellID or id, IsPassiveSpell and IsPassiveSpell(slot, "spell")
    end
  end
  local function addRange(offset, count, tab)
    for slot = (offset or 0) + 1, (offset or 0) + (count or 0) do
      local name, rank, id, passive = readSlot(slot)
      add(name, rank, id, tab, passive)
    end
  end

  if modern then
    for i = 1, B.GetNumSpellBookSkillLines() do
      local line = B.GetSpellBookSkillLineInfo(i)
      -- Abilities of a spec the character is not in, and guild perks, are not usable spells.
      if line and not line.isGuild and not line.offSpecID then
        addRange(line.itemIndexOffset, line.numSpellBookItems, line.name)
      end
    end
  else
    for tab = 1, need(GetNumSpellTabs, "spell tabs")() do
      local tabName, _, offset, count = GetSpellTabInfo(tab)
      addRange(offset, count, tabName)
    end
  end

  -- Clients with a separate Professions page keep those abilities (Find Minerals, Smelting,
  -- First Aid) outside the spell tabs; each profession names its own run of spellbook slots.
  if GetProfessions and GetProfessionInfo then
    local ids = { GetProfessions() }
    for i = 1, table.maxn(ids) do
      if ids[i] then
        local name, _, _, _, count, offset = GetProfessionInfo(ids[i])
        addRange(offset, count, name)
      end
    end
  end
  s.spells = spells
end

local function objective(text, done, have, need)
  if (not have or not need) and text then
    local h, n = text:match("(%d+)/(%d+)")
    have, need = tonumber(h), tonumber(n)
  end
  return { text = text, done = done and true or false, have = have, need = need }
end

function C.quests(s)
  local quests = {}
  local Q = C_QuestLog
  if Q and Q.GetInfo and Q.GetNumQuestLogEntries then
    for i = 1, Q.GetNumQuestLogEntries() do
      local info = Q.GetInfo(i)
      if info and not info.isHeader then
        local q = { id = info.questID, title = info.title, level = info.level,
          complete = Q.IsComplete and Q.IsComplete(info.questID) or false, objectives = {} }
        for _, o in ipairs(Q.GetQuestObjectives and Q.GetQuestObjectives(info.questID) or {}) do
          q.objectives[#q.objectives + 1] = objective(o.text, o.finished, o.numFulfilled, o.numRequired)
        end
        quests[#quests + 1] = q
      end
    end
  else
    local num = need(GetNumQuestLogEntries, "quest log")
    local title = need(GetQuestLogTitle, "quest titles")
    for i = 1, (num()) do
      local t, level, _, isHeader, _, isComplete, _, questID = title(i)
      if t and not isHeader then
        local q = { id = questID, title = t, level = level, complete = (isComplete == 1 or isComplete == true), objectives = {} }
        for j = 1, (GetNumQuestLeaderBoards and GetNumQuestLeaderBoards(i) or 0) do
          local text, _, finished = GetQuestLogLeaderBoard(j, i)
          q.objectives[#q.objectives + 1] = objective(text, finished)
        end
        quests[#quests + 1] = q
      end
    end
  end
  s.quests = quests
end

function C.completedQuests(s)
  local ids = {}
  if C_QuestLog and C_QuestLog.GetAllCompletedQuestIDs then
    for _, id in ipairs(C_QuestLog.GetAllCompletedQuestIDs() or {}) do ids[#ids + 1] = id end
  else
    for id, done in pairs(need(GetQuestsCompleted, "completed quests")() or {}) do
      if done then ids[#ids + 1] = id end
    end
  end
  table.sort(ids)
  s.completedQuests = ids
end

function C.reputations(s)
  local reps = {}
  if C_Reputation and C_Reputation.GetFactionDataByIndex and C_Reputation.GetNumFactions then
    for i = 1, C_Reputation.GetNumFactions() do
      local f = C_Reputation.GetFactionDataByIndex(i)
      if f and not f.isHeader then
        reps[#reps + 1] = { name = f.name, standing = f.reaction, value = f.currentStanding,
          min = f.currentReactionThreshold, max = f.nextReactionThreshold }
      end
    end
  else
    for i = 1, need(GetNumFactions, "factions")() do
      local name, _, standing, barMin, barMax, value, _, _, isHeader = GetFactionInfo(i)
      if name and not isHeader then
        reps[#reps + 1] = { name = name, standing = standing, value = value, min = barMin, max = barMax }
      end
    end
  end
  s.reputations = reps
end

ns.SECTIONS = { "identity", "xp", "money", "location", "equipped", "bags", "talents", "skills",
  "spells", "quests", "completedQuests", "reputations" }

-- Defaults so a failed section still has the contract's shape.
local EMPTY = {
  equipped = function(s) s.equipped = s.equipped or {} end,
  bags = function(s) s.bags = s.bags or {}; s.bagSlotsFree = s.bagSlotsFree or 0; s.bagSlotsTotal = s.bagSlotsTotal or 0 end,
  talents = function(s) s.talents = s.talents or { unspent = 0, tabs = {} } end,
  skills = function(s) s.skills = s.skills or {} end,
  spells = function(s) s.spells = s.spells or {} end,
  quests = function(s) s.quests = s.quests or {} end,
  completedQuests = function(s) s.completedQuests = s.completedQuests or {} end,
  reputations = function(s) s.reputations = s.reputations or {} end,
}

-- Refreshes the given sections (all when nil) into ForeverLogDB.snapshot.
-- opts.quiet: errors are ignored (not recorded) and failed sections keep their last value;
-- used at logout, when the client has already torn down some APIs.
function ns.refresh(sections, opts)
  local db = ForeverLogDB or ns.initDB()
  local s = db.snapshot
  local quiet = opts and opts.quiet
  -- A full refresh re-probes every API, so drop messages from earlier sessions.
  if not sections and not quiet then db.diagnostics = {} end
  for _, name in ipairs(sections or ns.SECTIONS) do
    if quiet then pcall(C[name], s) else ns.guard(name, C[name], s) end
    if EMPTY[name] then EMPTY[name](s) end
  end
  s.time = time()
  if ns.onRefresh then ns.guard("onRefresh", ns.onRefresh, sections) end
end
