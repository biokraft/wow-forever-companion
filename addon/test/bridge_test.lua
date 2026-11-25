-- Pixel bridge: the Lua encoder must reproduce the JS codec's golden vectors exactly, and the
-- strip must draw, diff, rotate pages and switch off without ever raising.
local V = dofile("test/fixtures/bridge-vectors.lua")

local MARKER = { 3, 0, 3, 0, 3, 3 }
local GREYS = { 0, 24, 48, 72 }

local function sameList(actual, expected, msg)
  T.eq(#actual, #expected, (msg or "list") .. " length")
  for i = 1, #expected do T.eq(actual[i], expected[i], (msg or "list") .. " at " .. i) end
end

local function vector(label)
  for _, v in ipairs(V.vectors) do
    if v.label == label then return v end
  end
  error("no vector " .. label)
end

-- A player who turned the strip on earlier, entering the world.
local function setup(overrides)
  local ns, stub = T.loadAddon(overrides)
  ForeverLogDB.bridge.enabled = true
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  return ns, stub
end

-- The grey level (0..3) each shown texture of the strip currently draws.
local function strip(ns)
  local out = {}
  for i, t in ipairs(ns.bridge.textures) do
    if not t:IsShown() then break end
    local g = math.floor(t.color[1] * 255 + 0.5)
    for level, grey in ipairs(GREYS) do
      if grey == g then out[i] = level - 1 end
    end
  end
  return out
end

-- Header fields read back from drawn symbols (6 marker symbols, then 18 header symbols).
local function header(symbols)
  local function num(from, to)
    local v = 0
    for i = from, to do v = v * 4 + symbols[i] end
    return v
  end
  return { seq = num(9, 12), page = num(13, 14), pages = num(15, 16), tag = num(17, 24) }
end

local function questLog(quests)
  return {
    GetNumQuestLogEntries = function() return #quests end,
    GetInfo = function(i) local q = quests[i]; return q and { questID = q.id, title = "Q" .. q.id, level = 10 } end,
    IsComplete = function(id)
      for _, q in ipairs(quests) do if q.id == id then return q.complete end end
      return false
    end,
    GetQuestObjectives = function(id)
      for _, q in ipairs(quests) do if q.id == id then return q.objectives end end
      return {}
    end,
  }
end

T.run("bridge: fletcher16 and the character tag match the JS codec", function()
  local ns = T.loadAddon()
  local v = vector("tag-testchar")
  T.eq(ns.bridge.characterTag(v.charName, v.classFile), v.tag)
  T.eq(ns.bridge.fletcher16({}), 0)
  T.eq(ns.bridge.fletcher16({ 1, 2 }), 4 * 256 + 3)
end)

T.run("bridge: core frames reproduce the golden vectors", function()
  local ns = T.loadAddon()
  for _, label in ipairs({ "core-level1-empty", "core-level60-max" }) do
    local v = vector(label)
    local symbols = ns.bridge.encodeFrame({ seq = v.seq, page = v.page, pages = v.pages, tag = v.tag }, ns.bridge.packCore(v.core))
    sameList(symbols, v.symbols, label)
  end
end)

T.run("bridge: quest pages and the digest reproduce the golden vectors", function()
  local ns = T.loadAddon()
  local v = vector("quests-25")
  T.eq(ns.bridge.questDigest(v.quests), v.core.questDigest, "digest")
  local pages = ns.bridge.packQuests(v.quests, v.capacity)
  T.eq(#pages + 1, v.pages, "page count")
  for _, f in ipairs(v.frames) do
    local bits = f.page == 0 and ns.bridge.packCore(v.core) or pages[f.page]
    local symbols = ns.bridge.encodeFrame({ seq = v.seq, page = f.page, pages = v.pages, tag = v.tag }, bits)
    sameList(symbols, f.symbols, "page " .. f.page)
  end
end)

T.run("bridge: page capacity follows the physical width", function()
  local ns = T.loadAddon()
  T.eq(ns.bridge.pageCapacityBits(1280), 788)
  T.eq(ns.bridge.pageCapacityBits(2560), (853 - 32) * 2)
end)

T.run("bridge: live state maps to the codec shape, clamped so packing never throws", function()
  local objectives = {}
  for i = 1, 9 do objectives[i] = { text = "x", finished = false, numFulfilled = (i == 1) and 300 or nil, numRequired = 5 } end
  local ns = T.loadAddon()
  _G.C_QuestLog = questLog({ { id = 790, complete = true, objectives = objectives } })
  local core, quests = ns.bridge.collect()
  T.eq(core.level, 12); T.eq(core.xp, 3600); T.eq(core.xpMax, 9000); T.eq(core.rested, 0)
  T.eq(core.money, 2534); T.eq(core.uiMapId, 1411); T.eq(core.x, 521); T.eq(core.y, 437)
  T.eq(core.questCount, 1)
  T.eq(#quests, 1)
  T.eq(quests[1].id, 790); T.eq(quests[1].complete, true); T.eq(quests[1].failed, false)
  T.eq(#quests[1].objectives, 7, "extra objectives dropped")
  T.eq(quests[1].objectives[1], 255, "clamped")
  T.eq(quests[1].objectives[2], 0, "unknown have")
  T.eq(core.questDigest, ns.bridge.questDigest(quests))
end)

T.run("bridge: an unread quest log can never decode as a complete empty log", function()
  local ns = T.loadAddon()
  _G.C_QuestLog = { GetInfo = function() end, GetNumQuestLogEntries = function() error("quest log unavailable") end }
  local core, quests = ns.bridge.collect()
  T.eq(#quests, 0, "no quest pages")
  -- The reader calls a log complete only when its pages hold questCount quests; with no quest
  -- pages a non-zero count can never match, so snapshot quests are not marked as left.
  T.ok(core.questCount > 0, "count cannot match an empty page set, got " .. core.questCount)
  local pages = ns.bridge.packQuests(quests, ns.bridge.pageCapacityBits(1280))
  T.eq(#pages, 0, "no quest pages drawn")
end)

T.run("bridge: an actually empty quest log is complete and empty", function()
  local ns = T.loadAddon()
  _G.C_QuestLog = questLog({})
  local core, quests = ns.bridge.collect()
  T.eq(#quests, 0)
  T.eq(core.questCount, 0)
  T.eq(core.questDigest, ns.bridge.questDigest({}))
end)

T.run("bridge: without a position x and y are 0", function()
  local ns = T.loadAddon()
  _G.C_Map.GetPlayerMapPosition = function() return nil end
  local core = ns.bridge.collect()
  T.eq(core.x, 0); T.eq(core.y, 0)
end)

T.run("bridge: entering the world and a tick draw the marker in physical pixels on WorldFrame", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  stub.tick()
  local f = ns.bridge.frame
  T.ok(f, "strip frame")
  T.eq(f.parent, WorldFrame, "parented to WorldFrame")
  T.eq(f.calls.SetIgnoreParentScale[1], true)
  T.eq(f.calls.SetFrameStrata[1], "TOOLTIP")
  local symbols = strip(ns)
  for i = 1, 6 do T.eq(symbols[i], MARKER[i], "marker " .. i) end
  local px = 768 / 720
  T.eq(ns.bridge.textures[1].calls.SetSize[1], 3 * px, "block width")
  T.eq(ns.bridge.textures[1].calls.SetSize[2], 2 * px, "block height")
  T.eq(ns.bridge.textures[2].calls.SetPoint[4], 3 * px, "second block offset")
end)

T.run("bridge: the drawn frame decodes to the live core", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  local symbols = strip(ns)
  local h = header(symbols)
  T.eq(h.page, 0); T.eq(h.pages, 1)
  T.eq(h.tag, ns.bridge.characterTag("Testa Grimtusk", "WARRIOR"))
  local core = ns.bridge.collect()
  local expected = ns.bridge.encodeFrame({ seq = h.seq, page = 0, pages = 1, tag = h.tag }, ns.bridge.packCore(core))
  sameList(symbols, expected, "strip")
end)

T.run("bridge: a display size change re-sizes the blocks", function()
  local w, h = 1280, 720
  local ns, stub = setup({ GetPhysicalScreenSize = function() return w, h end })
  w, h = 2560, 1440
  stub.fire("DISPLAY_SIZE_CHANGED")
  local px = 768 / 1440
  T.eq(ns.bridge.textures[1].calls.SetSize[1], 3 * px, "block width")
  T.eq(ns.bridge.textures[2].calls.SetPoint[4], 3 * px, "second block offset")
  T.eq(ns.bridge.frame.calls.SetSize[1], 853 * 3 * px, "strip width")
end)

T.run("bridge: an identical tick re-sets no texture", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  stub.tick()
  local before = stub.colorSets
  stub.tick()
  T.eq(stub.colorSets, before, "no SetColorTexture calls")
end)

T.run("bridge: a change re-sets only the textures whose grey changed", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  local before = stub.colorSets
  _G.GetMoney = function() return 2535 end
  stub.fire("PLAYER_MONEY")
  local changed = stub.colorSets - before
  T.ok(changed > 0 and changed < 20, "a few textures re-set, got " .. changed)
end)

T.run("bridge: page 0 every other redraw, quest pages rotate in between", function()
  local quests = {}
  for i = 1, 25 do
    quests[i] = { id = 1000 + i, complete = false, objectives = {
      { text = "a", numFulfilled = 1, numRequired = 9 }, { text = "b", numFulfilled = 2, numRequired = 9 },
      { text = "c", numFulfilled = 3, numRequired = 9 }, { text = "d", numFulfilled = 4, numRequired = 9 },
      { text = "e", numFulfilled = 5, numRequired = 9 } } }
  end
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end, C_QuestLog = questLog(quests) })
  local seen = { header(strip(ns)) }
  for _ = 1, 6 do stub.tick(); seen[#seen + 1] = header(strip(ns)) end
  T.eq(seen[1].pages, 4)
  local order = {}
  for i, h in ipairs(seen) do order[i] = h.page end
  T.eq(table.concat(order, ","), "0,1,0,2,0,3,0")
  for i = 2, #seen do T.eq(seen[i].seq, (seen[i - 1].seq + 1) % 256, "seq increments") end
end)

T.run("bridge: unused textures past a shorter frame are hidden", function()
  local quests = {}
  for i = 1, 3 do quests[i] = { id = 2000 + i, complete = false, objectives = {} } end
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end, C_QuestLog = questLog(quests) })
  T.eq(#strip(ns), 6 + 18 + 84 + 8, "page 0: 168 core bits")
  stub.tick() -- quest page: 5 + 3 * 22 = 71 bits, padded to 36 symbols
  T.eq(#strip(ns), 6 + 18 + 36 + 8, "quest page, rest hidden")
  stub.tick()
  T.eq(#strip(ns), 6 + 18 + 84 + 8, "page 0 shown again")
end)

T.run("bridge: the strip is off by default and draws nothing until turned on", function()
  local ns, stub = T.loadAddon()
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  stub.tick()
  T.eq(ForeverLogDB.bridge.enabled, false, "default off")
  T.eq(stub.colorSets, 0, "nothing drawn")
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "no strip shown")
  T.eq(stub.activeTickers(), 0, "no ticker")
  SlashCmdList.FOREVERLOG("bridge on")
  T.eq(ForeverLogDB.bridge.enabled, true)
  T.eq(ns.bridge.frame:IsShown(), true)
  T.eq(stub.activeTickers(), 1)
end)

T.run("bridge: /fc bridge off hides the strip and stops redraws, on restores it", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  T.eq(ForeverLogDB.bridge.enabled, true, "turned on")
  SlashCmdList.FOREVERLOG("bridge off")
  T.eq(ForeverLogDB.bridge.enabled, false)
  T.eq(ns.bridge.frame:IsShown(), false)
  local before = stub.colorSets
  _G.GetMoney = function() return 99999 end
  stub.tick(); stub.fire("PLAYER_MONEY")
  T.eq(stub.colorSets, before, "no redraw while off")
  SlashCmdList.FOREVERLOG("bridge on")
  T.eq(ForeverLogDB.bridge.enabled, true)
  T.eq(ns.bridge.frame:IsShown(), true)
  T.ok(stub.colorSets > before, "redraws again")
end)

T.run("bridge: a disabled bridge stays off after a reload", function()
  local ns, stub = T.loadAddon()
  ForeverLogDB.bridge.enabled = false
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  stub.tick()
  T.eq(stub.colorSets, 0)
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "no strip shown")
end)

local DISCLOSURE = "Live strip on. It draws a thin coded line at the top of the game window that the Forever Companion overlay on your computer reads. It never controls the game. Blizzard has not approved or ruled on this technique; use it at your own risk. /fc bridge off turns it off."

-- Lines printed to chat since the given count.
local function printedSince(stub, n)
  local out = {}
  for i = n + 1, #stub.printed do out[#out + 1] = stub.printed[i] end
  return out
end

T.run("bridge: the first /fc bridge on per account prints the risk disclosure, later ones the short line", function()
  local ns, stub = T.loadAddon()
  T.eq(ns.bridge.DISCLOSURE, DISCLOSURE, "disclosure text")
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  local n = #stub.printed
  SlashCmdList.FOREVERLOG("bridge on")
  local lines = printedSince(stub, n)
  T.eq(#lines, 1, "one line")
  T.eq(lines[1], ns.BRAND .. ": " .. DISCLOSURE)
  T.eq(ForeverCompanionAccountDB.bridgeDisclosed, true)
  SlashCmdList.FOREVERLOG("bridge off")
  n = #stub.printed
  SlashCmdList.FOREVERLOG("bridge on")
  lines = printedSince(stub, n)
  T.eq(#lines, 1, "one line")
  T.ok(lines[1]:find("Live strip on:", 1, true), "short line: " .. lines[1])
  T.ok(not lines[1]:find("Blizzard", 1, true), "no disclosure the second time")
end)

T.run("bridge: an account that has seen the disclosure does not see it again on another character", function()
  local ns, stub = T.loadAddon({ ForeverCompanionAccountDB = { bridgeDisclosed = true } })
  local n = #stub.printed
  SlashCmdList.FOREVERLOG("bridge on")
  local lines = printedSince(stub, n)
  T.eq(#lines, 1)
  T.ok(lines[1]:find("Live strip on:", 1, true), "short line: " .. lines[1])
end)

T.run("bridge: /fc bridge off never prints the disclosure or marks it seen", function()
  local ns, stub = T.loadAddon()
  local n = #stub.printed
  SlashCmdList.FOREVERLOG("bridge off")
  local lines = printedSince(stub, n)
  T.eq(#lines, 1)
  T.ok(lines[1]:find("Live strip off", 1, true), "off line: " .. lines[1])
  T.ok(not (ForeverCompanionAccountDB and ForeverCompanionAccountDB.bridgeDisclosed), "not marked seen")
end)

T.run("bridge: combat hides the strip and stops the ticker, the end of combat brings it back", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  T.eq(ns.bridge.frame:IsShown(), true)
  T.eq(stub.activeTickers(), 1)
  local n = #stub.printed
  stub.fire("PLAYER_REGEN_DISABLED")
  T.eq(ns.bridge.frame:IsShown(), false, "hidden in combat")
  T.eq(stub.activeTickers(), 0, "ticker stopped")
  T.eq(ForeverLogDB.bridge.enabled, true, "setting unchanged in combat")
  local before = stub.colorSets
  _G.GetMoney = function() return 99999 end
  stub.tick(); stub.fire("PLAYER_MONEY"); stub.fire("DISPLAY_SIZE_CHANGED")
  T.eq(stub.colorSets, before, "no redraw in combat")
  T.eq(ns.bridge.frame:IsShown(), false, "still hidden after a display change")
  stub.fire("PLAYER_REGEN_ENABLED")
  T.eq(ns.bridge.frame:IsShown(), true, "shown after combat")
  T.eq(stub.activeTickers(), 1, "ticker running again")
  T.eq(ForeverLogDB.bridge.enabled, true, "setting unchanged after combat")
  T.ok(stub.colorSets > before, "redraws the changed state")
  T.eq(#stub.printed, n, "combat prints nothing")
end)

T.run("bridge: combat does not show a strip that is off", function()
  local ns, stub = T.loadAddon()
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  stub.fire("PLAYER_REGEN_DISABLED")
  stub.fire("PLAYER_REGEN_ENABLED")
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "no strip shown")
  T.eq(stub.activeTickers(), 0)
  T.eq(ForeverLogDB.bridge.enabled, false)
end)

T.run("bridge: turning the strip off in combat keeps it off after combat", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  stub.fire("PLAYER_REGEN_DISABLED")
  SlashCmdList.FOREVERLOG("bridge off")
  stub.fire("PLAYER_REGEN_ENABLED")
  T.eq(ns.bridge.frame:IsShown(), false)
  T.eq(stub.activeTickers(), 0)
end)

T.run("bridge: turning the strip on in combat waits for combat to end", function()
  local inCombat = false
  local ns, stub = T.loadAddon({ InCombatLockdown = function() return inCombat end })
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  inCombat = true
  ns.bridge.setEnabled(true)
  T.eq(ForeverLogDB.bridge.enabled, true, "saved as on")
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "not shown in combat")
  T.eq(stub.activeTickers(), 0, "no ticker in combat")
  inCombat = false
  stub.fire("PLAYER_REGEN_ENABLED")
  T.eq(ns.bridge.frame:IsShown(), true, "shown after combat")
  T.eq(stub.activeTickers(), 1)
end)

T.run("bridge: entering the world in combat keeps the strip hidden until combat ends", function()
  local inCombat = true
  local ns, stub = T.loadAddon({ InCombatLockdown = function() return inCombat end })
  ForeverLogDB.bridge.enabled = true
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  stub.tick()
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "not shown in combat")
  T.eq(stub.colorSets, 0, "nothing drawn")
  inCombat = false
  stub.fire("PLAYER_REGEN_ENABLED")
  T.eq(ns.bridge.frame:IsShown(), true, "shown after combat")
  T.ok(stub.colorSets > 0, "drawn")
end)

T.run("bridge: an API error does not raise out of the ticker", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end,
    UnitXP = function() error("boom") end })
  local ok = pcall(stub.tick)
  T.ok(ok, "tick did not raise")
  T.eq(strip(ns)[1], 3, "still drawn")
end)

T.run("bridge: a failing redraw does not raise out of the ticker or events", function()
  local ns, stub = setup({ GetPhysicalScreenSize = function() return 1280, 720 end })
  ns.bridge.collect = function() error("bad") end
  T.ok(pcall(stub.tick), "tick did not raise")
  T.ok(pcall(stub.fire, "PLAYER_MONEY"), "event did not raise")
end)

-- The overlay that reads the strip runs only on macOS: elsewhere the strip stays off.
local NOT_MAC = { IsMacClient = function() return false end }

T.run("bridge: on a non-Mac client /fc bridge on prints one macOS-only line and draws nothing", function()
  local ns, stub = T.loadAddon(NOT_MAC)
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  local n = #stub.printed
  SlashCmdList.FOREVERLOG("bridge on")
  local lines = printedSince(stub, n)
  T.eq(#lines, 1, "one line")
  T.ok(lines[1]:find("macOS", 1, true), "names macOS: " .. lines[1])
  T.ok(not lines[1]:find("Blizzard", 1, true), "no disclosure")
  T.eq(ForeverLogDB.bridge.enabled, false, "stays off")
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "no strip shown")
  T.eq(stub.activeTickers(), 0, "no ticker")
  T.ok(not (ForeverCompanionAccountDB and ForeverCompanionAccountDB.bridgeDisclosed), "disclosure not marked seen")
end)

T.run("bridge: a saved 'on' never draws on a non-Mac client", function()
  local ns, stub = setup(NOT_MAC)
  T.ok(not ns.bridge.frame or not ns.bridge.frame:IsShown(), "no strip shown")
  T.eq(stub.activeTickers(), 0, "no ticker")
end)

T.run("bridge: a Mac client turns the strip on as before", function()
  local ns, stub = T.loadAddon({ IsMacClient = function() return true end })
  ns.bridge.start()
  stub.fire("PLAYER_ENTERING_WORLD")
  SlashCmdList.FOREVERLOG("bridge on")
  T.eq(ForeverLogDB.bridge.enabled, true)
  T.eq(ns.bridge.frame:IsShown(), true)
  T.eq(ForeverCompanionAccountDB.bridgeDisclosed, true)
end)
