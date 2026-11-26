T.run("identity, xp, money and location collect from classic APIs", function()
  local ns = T.loadAddon({ GetXPExhaustion = function() return 1200 end })
  ns.refresh()
  local s = ForeverLogDB.snapshot
  T.eq(s.name, "Testa Grimtusk"); T.eq(s.realm, "Testrealm")
  T.eq(s.raceId, 8); T.eq(s.classFile, "WARRIOR"); T.eq(s.faction, "Horde")
  T.eq(s.level, 12); T.eq(s.xp, 3600); T.eq(s.xpMax, 9000); T.eq(s.rested, 1200)
  T.eq(s.money, 2534)
  T.eq(s.zone, "Durotar"); T.eq(s.subzone, "Razor Hill"); T.eq(s.mapId, 1411)
  T.eq(s.x, 0.5214)
  T.eq(s.time, 1795600000)
end)

T.run("missing quest APIs leave quests empty with a diagnostic", function()
  local ns = T.loadAddon({ GetNumQuestLogEntries = false, GetQuestLogTitle = false })
  _G.GetNumQuestLogEntries, _G.GetQuestLogTitle = nil, nil
  ns.refresh()
  T.eq(#ForeverLogDB.snapshot.quests, 0)
  T.ok(ForeverLogDB.diagnostics.quests, "quests diagnostic")
end)

T.run("classic quest log collects quests with parsed objectives", function()
  local ns = T.loadAddon({
    GetNumQuestLogEntries = function() return 2, 1 end,
    GetQuestLogTitle = function(i)
      if i == 1 then return "Durotar", nil, nil, true end
      return "Carry Your Weight", 8, nil, false, false, nil, nil, 791
    end,
    GetNumQuestLeaderBoards = function() return 1 end,
    GetQuestLogLeaderBoard = function() return "Canvas Scraps: 4/8", "item", false end,
  })
  ns.refresh()
  local q = ForeverLogDB.snapshot.quests[1]
  T.eq(#ForeverLogDB.snapshot.quests, 1)
  T.eq(q.id, 791); T.eq(q.title, "Carry Your Weight"); T.eq(q.level, 8); T.eq(q.complete, false)
  T.eq(q.objectives[1].have, 4); T.eq(q.objectives[1].need, 8); T.eq(q.objectives[1].done, false)
end)

T.run("modern C_QuestLog is preferred when present", function()
  local ns = T.loadAddon()
  _G.C_QuestLog = {
    GetNumQuestLogEntries = function() return 1 end,
    GetInfo = function() return { title = "Sarkoth", level = 5, questID = 790, isHeader = false } end,
    IsComplete = function() return true end,
    GetQuestObjectives = function() return { { text = "Sarkoth's Mangled Claw: 1/1", finished = true, numFulfilled = 1, numRequired = 1 } } end,
    GetAllCompletedQuestIDs = function() return { 4641, 788 } end,
  }
  ns.refresh()
  local q = ForeverLogDB.snapshot.quests[1]
  T.eq(q.id, 790); T.eq(q.complete, true); T.eq(q.objectives[1].done, true)
  T.eq(ForeverLogDB.snapshot.completedQuests[1], 788, "sorted ids")
end)

T.run("classic completed-quest map becomes a sorted id array", function()
  local ns = T.loadAddon({ GetQuestsCompleted = function() return { [790] = true, [4641] = true, [788] = true } end })
  ns.refresh()
  local c = ForeverLogDB.snapshot.completedQuests
  T.eq(#c, 3); T.eq(c[1], 788); T.eq(c[3], 4641)
end)

T.run("equipped items carry stats and item level", function()
  local ns = T.loadAddon({
    GetInventoryItemLink = function(_, slot) if slot == 16 then return "|cff1eff00|Hitem:3189::|h[Wood Chopper]|h|r" end end,
    GetItemInfo = function() return "Wood Chopper", "|cff1eff00|Hitem:3189::|h[Wood Chopper]|h|r", 2, 13, 8, "Weapon", "Two-Handed Axes", 1, "INVTYPE_2HWEAPON" end,
    GetItemStats = function() return { ITEM_MOD_STRENGTH_SHORT = 3 } end,
  })
  ns.refresh()
  local item = ForeverLogDB.snapshot.equipped[16]
  T.eq(item.id, 3189); T.eq(item.name, "Wood Chopper"); T.eq(item.quality, 2); T.eq(item.ilvl, 13)
  T.eq(item.equipLoc, "INVTYPE_2HWEAPON"); T.eq(item.stats.ITEM_MOD_STRENGTH_SHORT, 3)
  T.eq(item.subType, "Two-Handed Axes"); T.eq(item.minLevel, 8)
end)

T.run("classic bags collect items, free and total slots", function()
  local ns = T.loadAddon({
    GetContainerNumSlots = function(bag) return bag == 0 and 16 or 0 end,
    GetContainerNumFreeSlots = function(bag) return bag == 0 and 15 or 0 end,
    GetContainerItemInfo = function(bag, slot)
      if bag == 0 and slot == 1 then return nil, 5, nil, 1, nil, nil, "|cffffffff|Hitem:2770::|h[Copper Ore]|h|r", nil, nil, 2770 end
    end,
    GetItemInfo = function() return "Copper Ore", "|cffffffff|Hitem:2770::|h[Copper Ore]|h|r", 1, 10, 0, "Trade Goods", "Metal & Stone", 20, "" end,
  })
  ns.refresh()
  local s = ForeverLogDB.snapshot
  T.eq(#s.bags, 1); T.eq(s.bags[1].count, 5); T.eq(s.bags[1].item.id, 2770)
  T.eq(s.bagSlotsTotal, 16); T.eq(s.bagSlotsFree, 15)
end)

T.run("skills are classified by their header", function()
  local lines = {
    { "Professions", true }, { "Mining", false, 42, 75 },
    { "Secondary Skills", true }, { "Cooking", false, 1, 75 },
    { "Weapon Skills", true }, { "Axes", false, 55, 60 },
  }
  local ns = T.loadAddon({
    GetNumSkillLines = function() return #lines end,
    GetSkillLineInfo = function(i)
      local l = lines[i]
      return l[1], l[2], true, l[3] or 0, 0, 0, l[4] or 0
    end,
  })
  ns.refresh()
  local s = ForeverLogDB.snapshot.skills
  T.eq(#s, 3)
  T.eq(s[1].name, "Mining"); T.eq(s[1].kind, "profession"); T.eq(s[1].rank, 42); T.eq(s[1].max, 75)
  T.eq(s[2].kind, "secondary"); T.eq(s[3].kind, "weapon")
end)

T.run("talents collect unspent points, tabs and ranks", function()
  local ns = T.loadAddon({
    UnitCharacterPoints = function() return 1 end,
    GetNumTalentTabs = function() return 1 end,
    GetTalentTabInfo = function() return "Arms", nil, 4, "WarriorArms" end,
    GetNumTalents = function() return 1 end,
    GetTalentInfo = function() return "Improved Rend", nil, 1, 3, 3, 3 end,
  })
  ns.refresh()
  local t = ForeverLogDB.snapshot.talents
  T.eq(t.unspent, 1); T.eq(t.tabs[1].name, "Arms"); T.eq(t.tabs[1].points, 4)
  T.eq(t.tabs[1].talents[1].name, "Improved Rend"); T.eq(t.tabs[1].talents[1].rank, 3)
end)

T.run("reputations skip headers", function()
  local ns = T.loadAddon({
    GetNumFactions = function() return 2 end,
    GetFactionInfo = function(i)
      if i == 1 then return "Horde", nil, 0, 0, 0, 0, nil, nil, true end
      return "Orgrimmar", nil, 5, 3000, 9000, 4500, nil, nil, false
    end,
  })
  ns.refresh()
  local r = ForeverLogDB.snapshot.reputations
  T.eq(#r, 1); T.eq(r[1].name, "Orgrimmar"); T.eq(r[1].standing, 5); T.eq(r[1].value, 4500)
end)

T.run("realm falls back to GetNormalizedRealmName when GetRealmName is empty", function()
  local ns = T.loadAddon({ GetRealmName = function() return "" end, GetNormalizedRealmName = function() return "Ashmantle" end })
  ns.refresh()
  T.eq(ForeverLogDB.snapshot.realm, "Ashmantle")
end)

T.run("realm falls back to UnitFullName when other realm APIs are empty", function()
  local ns = T.loadAddon({ GetRealmName = function() return "" end, UnitFullName = function() return "Zug", "Ashmantle" end })
  ns.refresh()
  T.eq(ForeverLogDB.snapshot.realm, "Ashmantle")
end)

T.run("Forever C_SkillInfo skills are classified by header", function()
  local lines = {
    { name = "Professions", isHeader = true }, { name = "Mining", rank = 12, maxRank = 75, skillID = 186 },
    { name = "Weapon Skills", isHeader = true }, { name = "Axes", rank = 30, maxRank = 30, skillID = 44 },
  }
  local ns = T.loadAddon({ GetNumSkillLines = false })
  _G.GetNumSkillLines = nil
  _G.C_SkillInfo = { GetNumSkillLines = function() return #lines end, GetSkillLineInfo = function(i) return lines[i] end }
  ns.refresh()
  local s = ForeverLogDB.snapshot.skills
  T.eq(#s, 2)
  T.eq(s[1].name, "Mining"); T.eq(s[1].kind, "profession"); T.eq(s[1].rank, 12); T.eq(s[1].max, 75); T.eq(s[1].id, 186)
  T.eq(s[2].kind, "weapon")
  T.eq(ForeverLogDB.diagnostics.skills, nil)
end)

T.run("Forever C_Traits talents collect purchased nodes and unspent points", function()
  local ns = T.loadAddon({ GetNumTalentTabs = false })
  _G.GetNumTalentTabs = nil
  _G.C_ClassTalents = { GetActiveConfigID = function() return 77 end }
  _G.C_Traits = {
    GetConfigInfo = function() return { treeIDs = { 5 } } end,
    GetTreeNodes = function() return { 101, 102 } end,
    GetNodeInfo = function(_, nodeID)
      if nodeID == 101 then return { ID = 101, posX = 1200, posY = 600, ranksPurchased = 2, activeRank = 2, maxRanks = 3, activeEntry = { entryID = 9001 } } end
      return { ID = 102, posX = 9000, posY = 600, ranksPurchased = 0, activeRank = 0, maxRanks = 5, entryIDs = { 9002 } }
    end,
    GetEntryInfo = function(_, entryID) return { definitionID = entryID + 1 } end,
    GetDefinitionInfo = function(defID) return { spellID = defID == 9002 and 12287 or 12286 } end,
    GetTreeCurrencyInfo = function() return { { quantity = 1, maxQuantity = 3, spent = 2 } } end,
  }
  _G.GetSpellInfo = function(id) return id == 12287 and "Improved Rend" or "Deflection" end
  ns.refresh()
  local t = ForeverLogDB.snapshot.talents
  T.eq(t.unspent, 1)
  T.eq(t.source, "traits")
  T.eq(#t.tabs, 1); T.eq(t.tabs[1].points, 2)
  local first = t.tabs[1].talents[1]
  T.eq(first.name, "Improved Rend"); T.eq(first.rank, 2); T.eq(first.maxRank, 3); T.eq(first.posX, 1200)
  T.eq(t.tabs[1].talents[2].name, "Deflection"); T.eq(t.tabs[1].talents[2].rank, 0)
  T.eq(ForeverLogDB.diagnostics.talents, nil)
end)

T.run("no active talent config (below level 10) gives empty traits talents, no diagnostic", function()
  local ns = T.loadAddon({ GetNumTalentTabs = false })
  _G.GetNumTalentTabs = nil
  _G.C_ClassTalents = { GetActiveConfigID = function() return nil end }
  _G.C_Traits = { GetConfigInfo = function() return nil end }
  ns.refresh()
  local t = ForeverLogDB.snapshot.talents
  T.eq(t.source, "traits"); T.eq(t.unspent, 0); T.eq(#t.tabs, 0)
  T.eq(ForeverLogDB.diagnostics.talents, nil)
end)

T.run("duplicate skill lines are listed once", function()
  local lines = { { name = "Professions", isHeader = true }, { name = "Mining", rank = 4, maxRank = 75, skillID = 186 }, { name = "Mining", rank = 4, maxRank = 75, skillID = 186 } }
  local ns = T.loadAddon({ GetNumSkillLines = false })
  _G.GetNumSkillLines = nil
  _G.C_SkillInfo = { GetNumSkillLines = function() return #lines end, GetSkillLineInfo = function(i) return lines[i] end }
  ns.refresh()
  T.eq(#ForeverLogDB.snapshot.skills, 1)
end)

T.run("classic spellbook: known spells with rank, tab and passive; future spells are left out", function()
  local book = {
    { "SPELL", "Attack", "", 6603 }, { "SPELL", "Find Minerals", "", 2580 },
    { "SPELL", "Heroic Strike", "Rank 2", 284 }, { "FUTURESPELL", "Cleave", "", 845 }, { "SPELL", "Parry", "Passive", 3127, true },
  }
  local ns = T.loadAddon({
    GetNumSpellTabs = function() return 2 end,
    GetSpellTabInfo = function(tab) if tab == 1 then return "General", nil, 0, 2 end return "Arms", nil, 2, 3 end,
    GetSpellBookItemInfo = function(slot) return book[slot][1], book[slot][4] end,
    GetSpellBookItemName = function(slot) return book[slot][2], book[slot][3], book[slot][4] end,
    IsPassiveSpell = function(slot) return book[slot][5] or false end,
  })
  ns.refresh()
  local s = ForeverLogDB.snapshot.spells
  T.eq(#s, 4)
  T.eq(s[1].name, "Attack"); T.eq(s[1].rank, nil); T.eq(s[1].tab, "General"); T.eq(s[1].id, 6603); T.eq(s[1].passive, nil)
  T.eq(s[2].name, "Find Minerals")
  T.eq(s[3].name, "Heroic Strike"); T.eq(s[3].rank, "Rank 2"); T.eq(s[3].tab, "Arms")
  T.eq(s[4].name, "Parry"); T.eq(s[4].passive, true)
  T.eq(ForeverLogDB.diagnostics.spells, nil)
end)

T.run("modern C_SpellBook is preferred: off-spec and guild lines, future spells and flyouts are left out", function()
  local lines = {
    { name = "General", itemIndexOffset = 0, numSpellBookItems = 2 },
    { name = "Warrior", itemIndexOffset = 2, numSpellBookItems = 3 },
    { name = "Fury", itemIndexOffset = 5, numSpellBookItems = 1, offSpecID = 72 },
    { name = "Guild", itemIndexOffset = 6, numSpellBookItems = 1, isGuild = true },
  }
  local items = {
    { itemType = 1, name = "Find Minerals", spellID = 2580 }, { itemType = 4, name = "Mounts" },
    { itemType = 1, name = "Charge", subName = "Rank 1", spellID = 100 }, { itemType = 2, name = "Cleave", spellID = 845 },
    { itemType = 1, name = "Parry", spellID = 3127, isPassive = true },
    { itemType = 1, name = "Bloodthirst", spellID = 23881 }, { itemType = 1, name = "Mass Resurrection", spellID = 83968 },
  }
  local ns = T.loadAddon({ GetNumSpellTabs = false })
  _G.GetNumSpellTabs = nil
  _G.C_SpellBook = {
    GetNumSpellBookSkillLines = function() return #lines end,
    GetSpellBookSkillLineInfo = function(i) return lines[i] end,
    GetSpellBookItemInfo = function(slot) return items[slot] end,
  }
  ns.refresh()
  local s = ForeverLogDB.snapshot.spells
  T.eq(#s, 3)
  T.eq(s[1].name, "Find Minerals"); T.eq(s[1].tab, "General"); T.eq(s[1].id, 2580)
  T.eq(s[2].name, "Charge"); T.eq(s[2].rank, "Rank 1"); T.eq(s[2].tab, "Warrior")
  T.eq(s[3].name, "Parry"); T.eq(s[3].passive, true)
  T.eq(ForeverLogDB.diagnostics.spells, nil)
  _G.C_SpellBook = nil
end)

T.run("no spellbook API at all leaves spells empty with a diagnostic", function()
  local ns = T.loadAddon({ GetNumSpellTabs = false })
  _G.GetNumSpellTabs = nil
  ns.refresh()
  T.eq(#ForeverLogDB.snapshot.spells, 0)
  T.ok(ForeverLogDB.diagnostics.spells, "diagnostic recorded")
end)

T.run("profession abilities on their own page join the spellbook, each spell once", function()
  local book = {
    { "Attack", "" }, { "Charge", "Rank 1" },
    [11] = { "Find Minerals", "" }, [12] = { "Smelting", "Apprentice" }, [13] = { "Mining", "Apprentice" },
    [21] = { "First Aid", "Apprentice" },
    [31] = { "Attack", "" },
  }
  local profs = { [3] = { "Mining", 3, 10 }, [7] = { "First Aid", 1, 20 }, [9] = { "Odd one", 1, 30 } }
  local ns = T.loadAddon({
    GetNumSpellTabs = function() return 1 end,
    GetSpellTabInfo = function() return "General", nil, 0, 2 end,
    GetSpellBookItemName = function(slot) local b = book[slot]; if b then return b[1], b[2], 5000 + slot end end,
    GetProfessions = function() return 3, nil, nil, nil, nil, 7, 9 end,
    GetProfessionInfo = function(id) local p = profs[id]; return p[1], nil, 40, 75, p[2], p[3] end,
  })
  ns.refresh()
  local s = ForeverLogDB.snapshot.spells
  T.eq(#s, 6)
  T.eq(s[3].name, "Find Minerals"); T.eq(s[3].tab, "Mining"); T.eq(s[3].rank, nil)
  T.eq(s[4].name, "Smelting"); T.eq(s[4].rank, "Apprentice")
  T.eq(s[6].name, "First Aid"); T.eq(s[6].tab, "First Aid")
  T.eq(ForeverLogDB.diagnostics.spells, nil)
  _G.GetProfessions, _G.GetProfessionInfo = nil, nil
end)

