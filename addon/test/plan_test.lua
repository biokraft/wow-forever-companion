local function plan(steps, extra)
  local p = { version = 1, generatedAt = 1795600000, characterName = "Testa Grimtusk", title = "Loop", steps = steps, nudges = { "n1" } }
  for k, v in pairs(extra or {}) do p[k] = v end
  return p
end
local function snap(extra)
  local s = { name = "Testa Grimtusk", level = 12, completedQuests = { 788, 790 }, quests = { { id = 791 } },
    equipped = { [16] = { id = 3189 } }, skills = { { name = "Mining", rank = 42 } } }
  for k, v in pairs(extra or {}) do s[k] = v end
  return s
end

T.run("plan: stepDone handles every condition type", function()
  local ns = T.loadAddon()
  local s = snap()
  T.eq(ns.stepDone({ done = { type = "quest_turnin", id = 790 } }, s), true)
  T.eq(ns.stepDone({ done = { type = "quest_turnin", id = 791 } }, s), false)
  T.eq(ns.stepDone({ done = { type = "quest_accept", id = 791 } }, s), true)
  T.eq(ns.stepDone({ done = { type = "quest_accept", id = 788 } }, s), true)
  T.eq(ns.stepDone({ done = { type = "quest_accept", id = 999 } }, s), false)
  T.eq(ns.stepDone({ done = { type = "level", level = 12 } }, s), true)
  T.eq(ns.stepDone({ done = { type = "level", level = 13 } }, s), false)
  T.eq(ns.stepDone({ done = { type = "equip", itemId = 3189 } }, s), true)
  T.eq(ns.stepDone({ done = { type = "equip", itemId = 1 } }, s), false)
  T.eq(ns.stepDone({ done = { type = "skill", name = "Mining", rank = 40 } }, s), true)
  T.eq(ns.stepDone({ done = { type = "skill", name = "Mining", rank = 50 } }, s), false)
  T.eq(ns.stepDone({ text = "no condition" }, s), false)
end)

T.run("plan: no plan gives state none", function()
  local ns = T.loadAddon()
  T.eq(ns.planView(nil, snap(), 1795600000, {}).state, "none")
  T.eq(ns.planView(plan({}), snap(), 1795600000, {}).state, "none")
end)

T.run("plan: a plan for another character shows its owner and no ticks", function()
  local ns = T.loadAddon()
  local v = ns.planView(plan({ { text = "a", done = { type = "level", level = 1 } } }, { characterName = "Zug" }), snap(), 1795600000, {})
  T.eq(v.state, "other"); T.eq(v.owner, "Zug"); T.eq(v.steps[1].done, false)
end)

T.run("plan: owner matches by first name too", function()
  local ns = T.loadAddon()
  local v = ns.planView(plan({ { text = "a" } }, { characterName = "Testa" }), snap(), 1795600000, {})
  T.eq(v.state, "ok")
end)

T.run("plan: auto and manual ticks, manual survives re-evaluation", function()
  local ns = T.loadAddon()
  local p = plan({ { text = "level", done = { type = "level", level = 12 } }, { text = "manual" } })
  ForeverLogPlan = p
  local v = ns.planView(p, snap(), 1795600000, ForeverLogDB.panel.manual)
  T.eq(v.state, "ok"); T.eq(v.steps[1].done, true); T.eq(v.steps[1].auto, true); T.eq(v.steps[2].done, false)
  ns.toggleManual(p, 2)
  v = ns.planView(p, snap(), 1795600000, ForeverLogDB.panel.manual)
  T.eq(v.steps[2].done, true); T.eq(v.steps[2].auto, false)
  ns.toggleManual(p, 2)
  T.eq(ns.planView(p, snap(), 1795600000, ForeverLogDB.panel.manual).steps[2].done, false)
end)

T.run("plan: age text", function()
  local ns = T.loadAddon()
  local p = plan({ { text = "a" } })
  T.eq(ns.planView(p, snap(), 1795600000 + 30, {}).ageText, "just now")
  T.eq(ns.planView(p, snap(), 1795600000 + 90, {}).ageText, "1m ago")
  T.eq(ns.planView(p, snap(), 1795600000 + 3 * 3600, {}).ageText, "3h ago")
  T.eq(ns.planView(p, snap(), 1795600000 + 2 * 86400, {}).ageText, "2d ago")
end)

T.run("plan: refresh calls the onRefresh hook with its sections", function()
  local ns = T.loadAddon()
  local got
  ns.onRefresh = function(sections) got = sections end
  ns.refresh({ "xp" })
  T.eq(got[1], "xp")
end)
