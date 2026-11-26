T.run("level up adds a journal entry", function()
  local ns, stub = T.loadAddon()
  stub.fire("PLAYER_LEVEL_UP", 13)
  local e = ForeverLogDB.journal[#ForeverLogDB.journal]
  T.eq(e.kind, "level"); T.eq(e.data.level, 13)
end)

T.run("quest turn-in records id and title from the snapshot", function()
  local ns, stub = T.loadAddon()
  ForeverLogDB.snapshot.quests = { { id = 790, title = "Sarkoth" } }
  stub.fire("QUEST_TURNED_IN", 790, 450, 75)
  local e = ForeverLogDB.journal[#ForeverLogDB.journal]
  T.eq(e.kind, "quest_turnin"); T.eq(e.data.id, 790); T.eq(e.data.title, "Sarkoth"); T.eq(e.data.xp, 450)
end)

T.run("classic QUEST_ACCEPTED (index, id) records the quest id", function()
  local ns, stub = T.loadAddon()
  stub.fire("QUEST_ACCEPTED", 3, 791)
  local e = ForeverLogDB.journal[#ForeverLogDB.journal]
  T.eq(e.kind, "quest_accept"); T.eq(e.data.id, 791)
end)

T.run("own loot of uncommon quality is journaled, common is not", function()
  local quality = { ["Wood Chopper"] = 2, ["Copper Ore"] = 1 }
  local ns, stub = T.loadAddon({
    GetItemInfo = function(link)
      local name = link:match("%[(.-)%]")
      return name, link, quality[name], 10
    end,
  })
  local before = #ForeverLogDB.journal
  stub.fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:3189::|h[Wood Chopper]|h|r.")
  stub.fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:2770::|h[Copper Ore]|h|rx2.")
  stub.fire("CHAT_MSG_LOOT", "Grubb receives loot: |cff1eff00|Hitem:3190::|h[Other Thing]|h|r.")
  T.eq(#ForeverLogDB.journal, before + 1)
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].data.name, "Wood Chopper")
end)

T.run("skill rank ups are journaled after SKILL_LINES_CHANGED", function()
  local rank = 42
  local ns, stub = T.loadAddon({
    GetNumSkillLines = function() return 2 end,
    GetSkillLineInfo = function(i)
      if i == 1 then return "Professions", true end
      return "Mining", false, true, rank, 0, 0, 75
    end,
  })
  ns.refresh()
  rank = 43
  stub.fire("SKILL_LINES_CHANGED")
  local e = ForeverLogDB.journal[#ForeverLogDB.journal]
  T.eq(e.kind, "skill"); T.eq(e.data.name, "Mining"); T.eq(e.data.rank, 43)
end)

T.run("bag updates are debounced into one refresh", function()
  local calls = 0
  local ns, stub = T.loadAddon({ GetContainerNumSlots = function() calls = calls + 1; return 0 end })
  calls = 0
  stub.fire("BAG_UPDATE", 0); stub.fire("BAG_UPDATE", 1); stub.fire("BAG_UPDATE", 0)
  T.eq(calls, 0, "no scan before timer")
  stub.flushTimers()
  T.eq(calls, 5, "one scan of bags 0..4")
end)

T.run("logout refreshes the snapshot and records session money", function()
  local money = 2534
  local ns, stub = T.loadAddon({ GetMoney = function() return money end })
  stub.fire("PLAYER_ENTERING_WORLD")
  money = 3000
  stub.fire("PLAYER_LOGOUT")
  local e = ForeverLogDB.journal[#ForeverLogDB.journal]
  T.eq(e.kind, "session_money"); T.eq(e.data.delta, 466)
  T.eq(ForeverLogDB.snapshot.money, 3000)
end)

T.run("trainer visit and death and zone change are journaled", function()
  local ns, stub = T.loadAddon({ UnitName = function(u) return u == "npc" and "Tarshaw Jaggedscar" or "Testa Grimtusk" end })
  stub.fire("TRAINER_SHOW")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].kind, "trainer")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].data.level, 12)
  stub.fire("PLAYER_DEAD")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].kind, "death")
  stub.fire("ZONE_CHANGED_NEW_AREA")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].kind, "zone")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].data.zone, "Durotar")
end)

T.run("logout refresh keeps earlier sections and logs no diagnostics when APIs are gone", function()
  local ns, stub = T.loadAddon({
    GetNumSkillLines = function() return 2 end,
    GetSkillLineInfo = function(i) if i == 1 then return "Professions", true end return "Mining", false, true, 4, 0, 0, 75 end,
  })
  ns.refresh()
  _G.GetNumSkillLines, _G.GetSkillLineInfo = nil, nil -- client tears these down during logout
  stub.fire("PLAYER_LOGOUT")
  T.eq(ForeverLogDB.snapshot.skills[1].name, "Mining")
  T.eq(ForeverLogDB.diagnostics.skills, nil)
end)

T.run("review: spending a talent point refreshes talents (debounced)", function()
  local unspent = 1
  local ns, stub = T.loadAddon({ UnitCharacterPoints = function() return unspent end, GetNumTalentTabs = function() return 0 end })
  ns.refresh()
  unspent = 0
  stub.fire("TRAIT_NODE_CHANGED"); stub.fire("TRAIT_TREE_CURRENCY_INFO_UPDATED"); stub.fire("CHARACTER_POINTS_CHANGED")
  stub.flushTimers()
  T.eq(ForeverLogDB.snapshot.talents.unspent, 0)
end)

T.run("review: journal epoch is set once and survives reloads", function()
  local ns = T.loadAddon()
  local epoch = ForeverLogDB.epoch
  T.ok(epoch, "epoch set")
  local saved = ForeverLogDB
  local _, stub = T.loadAddon()
  _G.ForeverLogDB = saved
  stub.fire("ADDON_LOADED", "ForeverLog")
  T.eq(ForeverLogDB.epoch, epoch)
end)

T.run("review: profession trainers are journaled as kind profession", function()
  local ns, stub = T.loadAddon({ IsTradeskillTrainer = function() return true end })
  stub.fire("TRAINER_SHOW")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].data.kind, "profession")
  _G.IsTradeskillTrainer = function() return false end
  stub.fire("TRAINER_SHOW")
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].data.kind, "class")
end)

T.run("review: logout only refreshes xp, money and location", function()
  local entries = 1
  local ns, stub = T.loadAddon({
    GetNumQuestLogEntries = function() return entries, entries end,
    GetQuestLogTitle = function() return "Sarkoth", 5, nil, false, false, nil, nil, 790 end,
  })
  ns.refresh()
  entries = 0 -- classic fallback still present but empty at logout
  stub.fire("PLAYER_LOGOUT")
  T.eq(#ForeverLogDB.snapshot.quests, 1)
end)

T.run("review: reputation changes refresh reputations", function()
  local n = 0
  local ns, stub = T.loadAddon({
    GetNumFactions = function() return n end,
    GetFactionInfo = function() return "Orgrimmar", nil, 5, 3000, 9000, 4500, nil, nil, false end,
  })
  ns.refresh()
  n = 1
  stub.fire("UPDATE_FACTION")
  stub.flushTimers()
  T.eq(#ForeverLogDB.snapshot.reputations, 1)
end)

T.run("review: an event the client does not know does not break the addon", function()
  local realCreate
  local ns, stub = T.loadAddon({})
  -- reload addon files with a frame that rejects one event name
  local stubMod = dofile("addon/test/wowstub.lua")
  stubMod.install({})
  realCreate = _G.CreateFrame
  _G.CreateFrame = function(...)
    local f = realCreate(...)
    local reg = f.RegisterEvent
    f.RegisterEvent = function(self, e) if e == "TRAIT_NODE_CHANGED" then error("unknown event", 0) end reg(self, e) end
    return f
  end
  local ns2 = {}
  for _, file in ipairs({ "Core.lua", "Snapshot.lua", "Events.lua" }) do assert(loadfile("addon/ForeverLog/" .. file))("ForeverLog", ns2) end
  stubMod.fire("ADDON_LOADED", "ForeverLog")
  stubMod.fire("PLAYER_LEVEL_UP", 7)
  T.eq(ForeverLogDB.journal[#ForeverLogDB.journal].kind, "level")
end)

T.run("spells learned after login are journaled; the spellbook loading at login is not", function()
  local book = { { "Attack", "" }, { "Heroic Strike", "Rank 1" } }
  local ns, stub = T.loadAddon({
    GetNumSpellTabs = function() return 1 end,
    GetSpellTabInfo = function() return "General", nil, 0, #book end,
    GetSpellBookItemName = function(slot) return book[slot][1], book[slot][2], 1000 + slot end,
  })
  local function spellEntries()
    local n = 0
    for _, e in ipairs(ForeverLogDB.journal) do if e.kind == "spell" then n = n + 1 end end
    return n
  end
  stub.fire("SPELLS_CHANGED"); stub.fire("SPELLS_CHANGED")
  stub.flushTimers()
  T.eq(#ForeverLogDB.snapshot.spells, 2)
  T.eq(spellEntries(), 0, "the book filling at login is not news")
  book[#book + 1] = { "Heroic Strike", "Rank 2" }
  book[#book + 1] = { "Find Minerals", "" }
  stub.fire("SPELLS_CHANGED")
  T.eq(#ForeverLogDB.snapshot.spells, 2, "debounced: nothing before the timer")
  stub.flushTimers()
  T.eq(#ForeverLogDB.snapshot.spells, 4)
  T.eq(spellEntries(), 2)
  local e = ForeverLogDB.journal[#ForeverLogDB.journal]
  T.eq(e.kind, "spell"); T.eq(e.data.name, "Find Minerals"); T.eq(e.data.rank, nil)
  stub.fire("SPELLS_CHANGED"); stub.flushTimers()
  T.eq(spellEntries(), 2, "an unchanged book adds nothing")
end)

