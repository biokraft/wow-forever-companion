-- ForeverLog events: journal entries and targeted snapshot refreshes.
local ADDON_NAME, ns = ...

local frame = CreateFrame("Frame")
local handlers = {}
local sessionMoneyStart
local pending = {}

-- Runs ns.refresh(sections) once, a second after the last of a burst of events.
local function debounced(key, sections)
  if pending[key] then return end
  pending[key] = true
  C_Timer.After(1, function()
    pending[key] = nil
    ns.refresh(sections)
  end)
end

local function journalLast()
  return ForeverLogDB.journal[#ForeverLogDB.journal]
end

local function questTitle(id)
  for _, q in ipairs(ForeverLogDB.snapshot.quests or {}) do
    if q.id == id then return q.title end
  end
end

-- Converts a GlobalStrings format ("You receive loot: %s.") into a Lua pattern.
local function formatToPattern(fmt)
  if not fmt then return nil end
  local p = fmt:gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")
  p = p:gsub("%%%%s", "(.+)"):gsub("%%%%d", "%%d+")
  return "^" .. p .. "$"
end

local lootPatterns
local function selfLootLink(msg)
  if not lootPatterns then
    lootPatterns = {}
    for _, key in ipairs({ "LOOT_ITEM_SELF_MULTIPLE", "LOOT_ITEM_SELF", "LOOT_ITEM_PUSHED_SELF" }) do
      local p = formatToPattern(_G[key])
      if p then lootPatterns[#lootPatterns + 1] = p end
    end
  end
  for _, p in ipairs(lootPatterns) do
    local link = msg:match(p)
    if link then return link:match("(|c.-|r)") or link end
  end
end

local function skillRanks()
  local ranks = {}
  for _, sk in ipairs(ForeverLogDB.snapshot.skills or {}) do ranks[sk.name] = sk.rank end
  return ranks
end

function handlers.ADDON_LOADED(name)
  if name ~= ADDON_NAME then return end
  ns.initDB()
end

function handlers.PLAYER_ENTERING_WORLD()
  ns.refresh()
  sessionMoneyStart = sessionMoneyStart or ForeverLogDB.snapshot.money
end

function handlers.PLAYER_LEVEL_UP(level)
  ns.journalAdd("level", { level = level })
  ns.refresh({ "xp", "talents" })
end

function handlers.PLAYER_XP_UPDATE() ns.refresh({ "xp" }) end
function handlers.PLAYER_MONEY() ns.refresh({ "money" }) end

function handlers.QUEST_ACCEPTED(...)
  local questID = select("#", ...) >= 2 and select(2, ...) or ...
  ns.journalAdd("quest_accept", { id = questID })
  handlers.QUEST_LOG_UPDATE()
end

function handlers.QUEST_TURNED_IN(questID, xp, money)
  ns.journalAdd("quest_turnin", { id = questID, title = questTitle(questID), xp = xp, money = money })
  debounced("completed", { "quests", "completedQuests" })
end

function handlers.QUEST_LOG_UPDATE()
  debounced("quests", { "quests" })
end

function handlers.TRAIT_CONFIG_UPDATED() debounced("talents", { "talents" }) end
handlers.TRAIT_NODE_CHANGED = handlers.TRAIT_CONFIG_UPDATED
handlers.TRAIT_TREE_CURRENCY_INFO_UPDATED = handlers.TRAIT_CONFIG_UPDATED
handlers.CHARACTER_POINTS_CHANGED = handlers.TRAIT_CONFIG_UPDATED

function handlers.UPDATE_FACTION() debounced("reputations", { "reputations" }) end

function handlers.CHAT_MSG_LOOT(msg)
  local link = msg and selfLootLink(msg)
  if not link then return end
  local item = ns.guard("loot", ns.itemInfo, link)
  if item and (item.quality or 0) >= 2 then
    ns.journalAdd("loot", { id = item.id, name = item.name, quality = item.quality, ilvl = item.ilvl, link = item.link })
  end
end

function handlers.PLAYER_EQUIPMENT_CHANGED(slot)
  local link = GetInventoryItemLink("player", slot)
  local item = link and ns.guard("equip", ns.itemInfo, link)
  ns.journalAdd("equip", { slot = slot, id = item and item.id, name = item and item.name })
  ns.refresh({ "equipped" })
end

function handlers.SKILL_LINES_CHANGED()
  local before = skillRanks()
  ns.refresh({ "skills" })
  for _, sk in ipairs(ForeverLogDB.snapshot.skills or {}) do
    local old = before[sk.name]
    if old and sk.rank and sk.rank > old then
      ns.journalAdd("skill", { name = sk.name, rank = sk.rank, max = sk.max })
    end
  end
end

local function knownSpells()
  local known = {}
  for _, sp in ipairs(ForeverLogDB.snapshot.spells or {}) do known[sp.name .. "|" .. (sp.rank or "")] = true end
  return known
end

-- The spellbook changes at a trainer, on a level up and with a new profession. The first
-- change after login only fills the snapshot (the client loads the book in pieces then);
-- later ones also journal what is new.
local spellsLoaded = false
local function refreshSpells()
  local before = knownSpells()
  ns.refresh({ "spells" })
  if not spellsLoaded then spellsLoaded = true; return end
  for _, sp in ipairs(ForeverLogDB.snapshot.spells or {}) do
    if not before[sp.name .. "|" .. (sp.rank or "")] then
      ns.journalAdd("spell", { name = sp.name, rank = sp.rank, id = sp.id })
    end
  end
end

function handlers.SPELLS_CHANGED()
  if pending.spells then return end
  pending.spells = true
  C_Timer.After(1, function()
    pending.spells = nil
    ns.guard("spells:changed", refreshSpells)
  end)
end

function handlers.PLAYER_DEAD()
  ns.journalAdd("death", { zone = GetZoneText(), subzone = GetSubZoneText(), level = UnitLevel("player") })
end

function handlers.ZONE_CHANGED_NEW_AREA()
  ns.refresh({ "location" })
  ns.journalAdd("zone", { zone = ForeverLogDB.snapshot.zone, mapId = ForeverLogDB.snapshot.mapId })
end

function handlers.TRAINER_SHOW()
  local profession = IsTradeskillTrainer and IsTradeskillTrainer() and true or false
  ns.journalAdd("trainer", { level = UnitLevel("player"), npc = UnitName("npc"), kind = profession and "profession" or "class" })
end

-- The bank can be read only while its window is open (see ns.readBank): once when it opens,
-- and again a moment after each change during the visit.
local bankOpen = false
local function bankChanged()
  if not bankOpen or pending.bank then return end
  pending.bank = true
  C_Timer.After(0.3, function()
    pending.bank = nil
    if bankOpen then ns.guard("bank", ns.readBank) end
  end)
end

function handlers.BANKFRAME_OPENED()
  bankOpen = true
  ns.guard("bank", ns.readBank)
end

function handlers.BANKFRAME_CLOSED()
  bankOpen = false
end

function handlers.PLAYERBANKSLOTS_CHANGED() bankChanged() end

function handlers.BAG_UPDATE()
  debounced("bags", { "bags" })
  bankChanged()
end

function handlers.PLAYER_LOGOUT()
  -- Events keep the other sections current. At logout some APIs are already gone, and
  -- classic fallbacks may answer with empty data, so only the cheap basics refresh here.
  ns.refresh({ "xp", "money", "location" }, { quiet = true })
  local now = ForeverLogDB.snapshot.money
  if sessionMoneyStart and now then
    ns.journalAdd("session_money", { delta = now - sessionMoneyStart, money = now })
  end
end

for event in pairs(handlers) do
  -- An event this client does not know must not stop the others from registering.
  pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event, ...)
  if event ~= "ADDON_LOADED" and not ForeverLogDB then ns.initDB() end
  ns.guard("event:" .. event, handlers[event], ...)
end)
