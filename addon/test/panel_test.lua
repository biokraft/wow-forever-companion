local function samplePlan(extra)
  local p = { version = 1, generatedAt = 1795600000, characterName = "Testa", title = "Razor Hill loop",
    steps = {
      { text = "Reach level 13", done = { type = "level", level = 13 } },
      { text = "Turn in Sarkoth", done = { type = "quest_turnin", id = 790 },
        waypoint = { mapId = 1411, x = 0.421, y = 0.683, label = "Durotar 42.1, 68.3" } },
    },
    nudges = { "Ready to turn in: Sarkoth" } }
  for k, v in pairs(extra or {}) do p[k] = v end
  return p
end

local function rowTexts(ns)
  local out = {}
  for i, row in ipairs(ns.panel.rows) do
    if row:IsShown() then out[i] = row.label.text end
  end
  return out
end

local function setup(overrides)
  local ns, stub = T.loadAddon(overrides)
  ForeverLogPlan = samplePlan()
  stub.fire("PLAYER_ENTERING_WORLD")
  return ns, stub
end

T.run("panel: /fc toggles the panel and remembers it", function()
  local ns = setup()
  T.eq(ns.panel.frame:IsShown(), true)
  SlashCmdList.FOREVERLOG("")
  T.eq(ns.panel.frame:IsShown(), false); T.eq(ForeverLogDB.panel.shown, false)
  SlashCmdList.FOREVERLOG("")
  T.eq(ns.panel.frame:IsShown(), true); T.eq(ForeverLogDB.panel.shown, true)
end)

T.run("panel: /fc and /fl are both registered; /fc status prints the status line", function()
  local ns, stub = setup()
  T.eq(SLASH_FOREVERLOG1, "/fc"); T.eq(SLASH_FOREVERLOG3, "/fl")
  SlashCmdList.FOREVERLOG("status")
  T.ok(stub.printed[#stub.printed]:find("L12"), "status line printed")
end)

T.run("panel: renders title, steps with done marks, waypoint labels and nudges", function()
  local ns = setup({ GetQuestsCompleted = function() return { [790] = true } end })
  ns.refresh()
  local rows = rowTexts(ns)
  T.ok(ns.panel.header.text:find("Razor Hill loop"), "title")
  T.ok(rows[1]:find("Reach level 13") and rows[1]:find("%[ %]"), "step 1 pending")
  T.ok(rows[2]:find("Turn in Sarkoth") and rows[2]:find("%[x%]"), "step 2 done")
  T.ok(rows[2]:find("42.1, 68.3"), "waypoint label")
  T.ok(ns.panel.nudges.text:find("Sarkoth"), "nudges")
end)

T.run("panel: without a plan it says to ask the companion", function()
  local ns, stub = T.loadAddon()
  stub.fire("PLAYER_ENTERING_WORLD")
  T.ok(ns.panel.empty:IsShown(), "empty text shown")
  T.ok(ns.panel.empty.text:find("No plan yet"), "empty text")
end)

T.run("panel: left-click on a waypoint step sets a map pin", function()
  local ns, stub = setup()
  local pinned, tracked
  _G.UiMapPoint = { CreateFromCoordinates = function(mapId, x, y) return { mapId = mapId, x = x, y = y } end }
  _G.C_Map.SetUserWaypoint = function(p) pinned = p end
  _G.C_SuperTrack = { SetSuperTrackedUserWaypoint = function(v) tracked = v end }
  ns.panel.clickStep(2, "LeftButton")
  T.eq(pinned.mapId, 1411); T.eq(pinned.x, 0.421); T.eq(tracked, true)
end)

T.run("panel: without the waypoint API the click prints the location", function()
  local ns, stub = setup()
  _G.C_Map.SetUserWaypoint = nil
  ns.panel.clickStep(2, "LeftButton")
  T.ok(stub.printed[#stub.printed]:find("Durotar 42.1, 68.3"), "printed label")
end)

T.run("panel: right-click ticks a step by hand", function()
  local ns = setup()
  ns.panel.clickStep(1, "RightButton")
  T.ok(rowTexts(ns)[1]:find("%[x%]"), "manually done")
end)

T.run("panel: a level-up ticks the level step without a reload", function()
  local level = 12
  local ns, stub = setup({ UnitLevel = function() return level end })
  T.ok(rowTexts(ns)[1]:find("%[ %]"), "pending first")
  level = 13
  stub.fire("PLAYER_LEVEL_UP", 13)
  T.ok(rowTexts(ns)[1]:find("%[x%]"), "done after level up")
end)

T.run("panel: collapsing hides the steps and is remembered", function()
  local ns = setup()
  ns.panel.setCollapsed(true)
  T.eq(ns.panel.rows[1]:IsShown(), false); T.eq(ForeverLogDB.panel.collapsed, true)
  ns.panel.setCollapsed(false)
  T.eq(ns.panel.rows[1]:IsShown(), true)
end)

T.run("panel: a plan for another character says whose it is", function()
  local ns, stub = T.loadAddon()
  ForeverLogPlan = samplePlan({ characterName = "Zug" })
  stub.fire("PLAYER_ENTERING_WORLD")
  T.ok(ns.panel.header.text:find("Zug"), "owner in header")
end)

T.run("brand: panel shows the Forever Companion label and a tooltip on the header", function()
  local ns = setup()
  T.ok(ns.panel.brand.text:find("Forever Companion"), "brand label")
  T.ok(ns.panel.brand.text:find("|cffc8a24a", 1, true), "brand color")
  T.ok(ns.panel.frame:GetScript("OnEnter"), "tooltip handler")
end)

T.run("brand: chat messages carry the colored Forever Companion prefix", function()
  local ns, stub = setup()
  SlashCmdList.FOREVERLOG("status")
  T.ok(stub.printed[#stub.printed]:find("|cffc8a24aForever Companion|r", 1, true), "status prefix")
  _G.C_Map.SetUserWaypoint = nil
  ns.panel.clickStep(2, "LeftButton")
  T.ok(stub.printed[#stub.printed]:find("|cffc8a24aForever Companion|r", 1, true), "waypoint prefix")
end)

T.run("review: a wrapped header grows the panel instead of overflowing it", function()
  local ns = setup()
  ns.panel.refresh()
  local oneLine = ns.panel.frame.calls.SetHeight[1]
  ns.panel.header.stringHeight = 28
  ns.panel.refresh()
  T.eq(ns.panel.frame.calls.SetHeight[1], oneLine + 14)
end)

T.run("review: an unexpected plan shape never throws from /fc or clicks", function()
  local ns, stub = T.loadAddon()
  ForeverLogPlan = { version = 1, generatedAt = 1, characterName = "Testa", steps = { { done = { type = "level", level = 1 } } }, nudges = { 42, { "x" } } }
  stub.fire("PLAYER_ENTERING_WORLD")
  SlashCmdList.FOREVERLOG("")
  SlashCmdList.FOREVERLOG("")
  ns.panel.clickStep(1, "RightButton")
  T.ok(true)
end)

T.run("review: a plan from a newer format is treated as no plan", function()
  local ns = T.loadAddon()
  T.eq(ns.planView({ version = 2, steps = { { text = "a" } } }, { name = "Testa" }, 1, {}).state, "none")
end)

T.run("review: nudges are hidden on another character's plan", function()
  local ns = T.loadAddon()
  local v = ns.planView({ version = 1, characterName = "Zug", steps = { { text = "a" } }, nudges = { "Bags full" } }, { name = "Testa" }, 1, {})
  T.eq(#v.nudges, 0)
end)

T.run("review: turn-in and talent nudges are computed live from the snapshot", function()
  local ns = T.loadAddon()
  local p = { version = 1, characterName = "Testa", steps = { { text = "a" } }, nudges = { "Bags nearly full" } }
  local s = { name = "Testa", quests = { { id = 790, title = "Sarkoth", complete = true }, { id = 791, title = "Carry", complete = false } }, talents = { unspent = 1 } }
  local v = ns.planView(p, s, 1, {})
  local joined = table.concat(v.nudges, "|")
  T.ok(joined:find("Ready to turn in: Sarkoth", 1, true), "live turn-in")
  T.ok(not joined:find("Carry", 1, true), "incomplete quest not listed")
  T.ok(joined:find("1 unspent talent point", 1, true), "live talent point")
  T.ok(joined:find("Bags nearly full", 1, true), "baked nudge kept")
  s.quests = {}; s.talents.unspent = 0
  T.eq(table.concat(ns.planView(p, s, 1, {}).nudges, "|"), "Bags nearly full")
end)

T.run("review: the panel leaves 10px below the last line", function()
  local ns = setup()
  ns.panel.refresh()
  local h = ns.panel.frame.calls.SetHeight[1]
  -- brand 14 + header 14 + 2 rows (16+4 each) + nudges (14+8) + top 10 + gap 3 + bottom 10
  T.eq(h, 10 + 14 + 3 + 14 + 20 + 20 + 22 + 10)
end)

T.run("panel: clicking a step without a location says so", function()
  local ns, stub = setup()
  ns.panel.clickStep(1, "LeftButton")
  T.ok(stub.printed[#stub.printed]:find("no map location", 1, true), "hint printed")
end)
