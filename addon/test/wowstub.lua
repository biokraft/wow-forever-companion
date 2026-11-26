-- Stubbed WoW API for unit tests. Each test gets a clean global state via install().
local M = {}
local frames = {}
local timers = {}
local tickers = {}

local defaults = {
  time = function() return 1795600000 end,
  UnitName = function() return "Testa Grimtusk" end,
  GetRealmName = function() return "Testrealm" end,
  UnitRace = function() return "Troll", "Troll", 8 end,
  UnitClass = function() return "Warrior", "WARRIOR", 1 end,
  UnitFactionGroup = function() return "Horde", "Horde" end,
  UnitLevel = function() return 12 end,
  UnitXP = function() return 3600 end,
  UnitXPMax = function() return 9000 end,
  GetXPExhaustion = function() return nil end,
  GetMoney = function() return 2534 end,
  GetZoneText = function() return "Durotar" end,
  GetSubZoneText = function() return "Razor Hill" end,
  GetInventoryItemLink = function() return nil end,
  GetNumFactions = function() return 0 end,
  GetNumSkillLines = function() return 0 end,
  GetNumSpellTabs = function() return 0 end,
  GetSpellTabInfo = function() end,
  GetSpellBookItemName = function() end,
  GetSpellBookItemInfo = function() return "SPELL" end,
  IsPassiveSpell = function() return false end,
  GetNumTalentTabs = function() return 0 end,
  UnitCharacterPoints = function() return 0 end,
  GetQuestsCompleted = function() return {} end,
  GetNumQuestLogEntries = function() return 0, 0 end,
  GetQuestLogTitle = function() return nil end,
  GetContainerNumSlots = function() return 0 end,
  GetContainerNumFreeSlots = function() return 0 end,
  GetItemInfo = function() return nil end,
  GetItemStats = function() return nil end,
  ReloadUI = function() M.reloaded = true end,
  SlashCmdList = {},
  C_Map = {
    GetBestMapForUnit = function() return 1411 end,
    GetPlayerMapPosition = function()
      return { GetXY = function() return 0.5214, 0.4377 end }
    end,
  },
  C_Timer = {
    After = function(_, fn) timers[#timers + 1] = fn end,
    NewTicker = function(interval, fn)
      local t = { interval = interval, fn = fn, cancelled = false }
      function t:Cancel() self.cancelled = true end
      function t:IsCancelled() return self.cancelled end
      tickers[#tickers + 1] = t
      return t
    end,
  },
  GetPhysicalScreenSize = function() return 1280, 720 end,
  InCombatLockdown = function() return false end,
  LOOT_ITEM_SELF = "You receive loot: %s.",
  LOOT_ITEM_SELF_MULTIPLE = "You receive loot: %sx%d.",
  LOOT_ITEM_PUSHED_SELF = "You receive item: %s.",
}

function M.install(overrides)
  frames, timers, tickers, M.reloaded = {}, {}, {}, false
  M.colorSets = 0
  _G.ForeverLogDB = nil
  _G.ForeverCompanionAccountDB, _G.ForeverCompanionHelp = nil, nil
  _G.UISpecialFrames = {}
  _G.C_QuestLog, _G.C_Container, _G.C_Item, _G.C_Reputation = nil, nil, nil, nil
  _G.C_SkillInfo, _G.C_Traits, _G.C_ClassTalents = nil, nil, nil
  _G.GetNormalizedRealmName, _G.UnitFullName, _G.GetSpellInfo, _G.C_Spell = nil, nil, nil, nil
  _G.IsTradeskillTrainer = nil
  _G.IsMacClient = nil -- absent unless a test passes it (absent counts as a Mac)
  _G.ForeverLogPlan = nil
  _G.ForeverLogPanel, _G.UiMapPoint, _G.C_SuperTrack = nil, nil, nil
  M.printed = {}
  _G.print = function(...) M.printed[#M.printed + 1] = table.concat({ ... }, " ") end
  for k, v in pairs(defaults) do _G[k] = v end
  -- UI widgets: unknown methods are recorded no-ops, so addon UI code runs under test.
  local function widget(kind)
    local w = { kind = kind, events = {}, scripts = {}, shown = true, children = {}, calls = {} }
    function w:RegisterEvent(e) self.events[e] = true end
    function w:UnregisterEvent(e) self.events[e] = nil end
    function w:SetScript(name, fn) self.scripts[name] = fn; if name == "OnEvent" then self.onEvent = fn end end
    function w:GetScript(name) return self.scripts[name] end
    function w:Show() self.shown = true end
    function w:Hide() self.shown = false end
    function w:IsShown() return self.shown end
    function w:SetShown(v) self.shown = v and true or false end
    function w:SetText(t) self.text = t end
    function w:GetText() return self.text end
    function w:GetStringHeight() return rawget(self, "stringHeight") or 14 end
    function w:GetHeight() return 14 end
    function w:GetPoint() return "CENTER", nil, "CENTER", 10, 20 end
    function w:CreateFontString() local c = widget("FontString"); self.children[#self.children + 1] = c; return c end
    function w:CreateTexture() local c = widget("Texture"); self.children[#self.children + 1] = c; return c end
    function w:SetColorTexture(r, g, b, a) self.color = { r, g, b, a }; M.colorSets = M.colorSets + 1 end
    return setmetatable(w, { __index = function(t, k)
      return function(self, ...) t.calls[k] = { ... } end
    end })
  end
  M.widget = widget
  _G.UIParent = widget("Frame")
  _G.WorldFrame = widget("Frame")
  _G.CreateFrame = function(kind, name, parent)
    local f = widget(kind or "Frame")
    f.parent = parent
    if parent and parent.children then parent.children[#parent.children + 1] = f end
    if name then _G[name] = f end
    frames[#frames + 1] = f
    return f
  end
  for k, v in pairs(overrides or {}) do _G[k] = v end
end

function M.fire(event, ...)
  for _, f in ipairs(frames) do
    if f.events[event] and f.onEvent then f.onEvent(f, event, ...) end
  end
end

-- Runs every live C_Timer.NewTicker callback once, like one second passing.
function M.tick()
  for _, t in ipairs(tickers) do
    if not t.cancelled then t.fn(t) end
  end
end

-- How many C_Timer.NewTicker tickers are still running.
function M.activeTickers()
  local n = 0
  for _, t in ipairs(tickers) do
    if not t.cancelled then n = n + 1 end
  end
  return n
end

function M.flushTimers()
  local pending = timers
  timers = {}
  for _, fn in ipairs(pending) do fn() end
end

return M
