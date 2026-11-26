-- ForeverLog core: saved-variable setup, guarded API calls, journal, slash command.
local ADDON_NAME, ns = ...

ns.VERSION = "0.5.1"
ns.SCHEMA = 1
ns.JOURNAL_CAP = 3000
ns.BRAND = "|cffc8a24aForever Companion|r"

-- Every chat line from the addon starts with the brand, like Questie's prefix.
function ns.print(msg)
  print(ns.BRAND .. ": " .. tostring(msg))
end

function ns.initDB()
  local db = ForeverLogDB
  if type(db) ~= "table" then db = {} end
  db.schema = ns.SCHEMA
  db.addonVersion = ns.VERSION
  db.snapshot = type(db.snapshot) == "table" and db.snapshot or {}
  if type(db.journal) ~= "table" then
    db.journal = {}
    db.epoch = time() -- identifies this journal; a new epoch tells sync the history restarted
  end
  db.epoch = db.epoch or time()
  db.journalSeq = tonumber(db.journalSeq) or 0
  db.diagnostics = type(db.diagnostics) == "table" and db.diagnostics or {}
  db.panel = type(db.panel) == "table" and db.panel or {}
  db.panel.manual = type(db.panel.manual) == "table" and db.panel.manual or {}
  db.bridge = type(db.bridge) == "table" and db.bridge or {}
  -- The live strip is off unless the player turns it on. Versions up to 0.3.0 saved it as on
  -- without asking, so a setting without v = 2 is reset to off once.
  if db.bridge.v ~= 2 then
    db.bridge.enabled = false
    db.bridge.v = 2
  end
  db.bridge.enabled = db.bridge.enabled == true
  ForeverLogDB = db
  return db
end

-- Calls fn(...) under pcall. On error returns nil and records the first message per name.
function ns.guard(name, fn, ...)
  local results = { pcall(fn, ...) }
  if results[1] then
    return unpack(results, 2, table.maxn(results))
  end
  local db = ForeverLogDB or ns.initDB()
  if db.diagnostics[name] == nil then
    db.diagnostics[name] = tostring(results[2])
  end
  return nil
end

function ns.journalAdd(kind, data)
  local db = ForeverLogDB or ns.initDB()
  db.journalSeq = db.journalSeq + 1
  local journal = db.journal
  journal[#journal + 1] = { seq = db.journalSeq, time = time(), kind = kind, data = data or {} }
  while #journal > ns.JOURNAL_CAP do
    table.remove(journal, 1)
  end
end

local function statusLine()
  local s = ForeverLogDB and ForeverLogDB.snapshot or {}
  local pct = (s.xpMax and s.xpMax > 0) and math.floor((s.xp or 0) / s.xpMax * 100) or 0
  local diag = 0
  for _ in pairs(ForeverLogDB and ForeverLogDB.diagnostics or {}) do diag = diag + 1 end
  return string.format("v%s, L%s %d%% XP, %s, journal %d, %d API issue(s). /fc sync saves for your companion, /fc toggles the panel, /fc help opens the guide.",
    ns.VERSION, tostring(s.level or "?"), pct, tostring(s.zone or "?"),
    ForeverLogDB and #ForeverLogDB.journal or 0, diag)
end

SLASH_FOREVERLOG1 = "/fc"
SLASH_FOREVERLOG2 = "/cf" -- old name, kept working, never shown
SLASH_FOREVERLOG3 = "/fl" -- older name, kept working
SlashCmdList = SlashCmdList or {}
SlashCmdList.FOREVERLOG = function(msg)
  msg = (msg or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
  if msg == "sync" then
    ns.refresh()
    ReloadUI()
  elseif (msg == "bridge on" or msg == "bridge off") and ns.bridge then
    local on = msg == "bridge on"
    -- The first time per account, setEnabled prints the disclosure, which replaces the short line.
    local disclosed = ns.guard("bridge:toggle", ns.bridge.setEnabled, on)
    if not disclosed then
      ns.print(on and "Live strip on: the companion sees level, XP, money, map and quests without /fc sync."
        or "Live strip off: the companion sees new data after /fc sync.")
    end
  elseif (msg == "help" or msg == "guide") and ns.help then
    ns.guard("help:open", ns.help.open)
  elseif msg == "" and ns.panel then
    ns.panel.toggle()
  else
    ns.print(statusLine())
  end
end
