-- ForeverLog plan evaluation: which plan steps are done, and the view the panel renders.
local ADDON_NAME, ns = ...

local function contains(list, value)
  for _, v in ipairs(list or {}) do
    if v == value then return true end
  end
  return false
end

local CHECKS = {
  quest_turnin = function(d, s) return contains(s.completedQuests, d.id) end,
  quest_accept = function(d, s)
    for _, q in ipairs(s.quests or {}) do
      if q.id == d.id then return true end
    end
    return contains(s.completedQuests, d.id)
  end,
  level = function(d, s) return (s.level or 0) >= (d.level or math.huge) end,
  equip = function(d, s)
    for _, item in pairs(s.equipped or {}) do
      if item.id == d.itemId then return true end
    end
    return false
  end,
  skill = function(d, s)
    for _, sk in ipairs(s.skills or {}) do
      if sk.name == d.name and (sk.rank or 0) >= (d.rank or math.huge) then return true end
    end
    return false
  end,
}

function ns.stepDone(step, snapshot)
  local done = step and step.done
  local check = done and CHECKS[done.type]
  if not check or not snapshot then return false end
  return check(done, snapshot) and true or false
end

local function firstName(name)
  return name and tostring(name):match("^(%S+)") or nil
end

local function ageText(seconds)
  if seconds < 60 then return "just now" end
  if seconds < 3600 then return math.floor(seconds / 60) .. "m ago" end
  if seconds < 86400 then return math.floor(seconds / 3600) .. "h ago" end
  return math.floor(seconds / 86400) .. "d ago"
end

local function manualKey(plan, index)
  return tostring(plan.generatedAt or 0) .. ":" .. index
end

function ns.toggleManual(plan, index)
  local db = ForeverLogDB or ns.initDB()
  local key = manualKey(plan, index)
  db.panel.manual[key] = (not db.panel.manual[key]) or nil
end

-- Nudges the addon can keep current itself; the plan file carries the rest.
local function liveNudges(snapshot)
  local out, ready = {}, {}
  for _, q in ipairs(snapshot.quests or {}) do
    if q.complete then ready[#ready + 1] = tostring(q.title or q.id) end
  end
  if #ready > 0 then out[#out + 1] = "Ready to turn in: " .. table.concat(ready, ", ") end
  local unspent = snapshot.talents and tonumber(snapshot.talents.unspent) or 0
  if unspent > 0 then
    out[#out + 1] = unspent .. " unspent talent point" .. (unspent > 1 and "s" or "")
  end
  return out
end

function ns.planView(plan, snapshot, now, manual)
  if type(plan) ~= "table" or plan.version ~= 1 or type(plan.steps) ~= "table" or #plan.steps == 0 then
    return { state = "none", steps = {}, nudges = {} }
  end
  snapshot = snapshot or {}
  local owner = plan.characterName
  local mine = not owner or firstName(owner) == firstName(snapshot.name)
  local view = {
    state = mine and "ok" or "other",
    owner = owner,
    title = plan.title or "Next steps",
    ageText = ageText(math.max(0, (now or 0) - (plan.generatedAt or now or 0))),
    steps = {},
    nudges = {},
  }
  if mine then
    for _, n in ipairs(liveNudges(snapshot)) do view.nudges[#view.nudges + 1] = n end
    for _, n in ipairs(type(plan.nudges) == "table" and plan.nudges or {}) do
      if type(n) == "string" then view.nudges[#view.nudges + 1] = n end
    end
  end
  for i, step in ipairs(plan.steps) do
    local auto = mine and ns.stepDone(step, snapshot) or false
    local hand = mine and manual and manual[manualKey(plan, i)] and true or false
    view.steps[i] = { index = i, text = tostring(step.text or ""), done = auto or hand, auto = auto,
      waypoint = type(step.waypoint) == "table" and step.waypoint or nil }
  end
  return view
end
