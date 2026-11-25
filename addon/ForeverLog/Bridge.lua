-- ForeverLog pixel bridge: draws live state (level, XP, money, map, position, quest progress)
-- as a thin strip of near-black grey blocks along the top screen edge, so the companion
-- overlay can capture and decode it without a UI reload. The strip is off unless the player
-- turns it on, and hidden while the player is in combat.
--
-- The encoder mirrors src/bridge/codec.js exactly; both reproduce the golden vectors in
-- test/fixtures/bridge-vectors.lua. Lua 5.1 has no integer bit operators, so every bit step is
-- plain arithmetic (math.floor, %, *), exact for doubles up to 2^53.
--
-- Frame layout, in symbols (2 bits each, one of four greys):
--   marker (6) | header (18 = 36 bits) | payload (bits padded to even) | checksum (8 = 16 bits)
-- Header bits: version 4, seq 8, page 4, pages 4, tag 16. Page 0 carries the core; pages
-- 1..pages-1 carry the quest log. The checksum is Fletcher-16 over header and payload symbols.
local ADDON_NAME, ns = ...

local B = {}
ns.bridge = B

local GREYS = { 0, 24, 48, 72 }
local MARKER = { 3, 0, 3, 0, 3, 3 }
local FORMAT_VERSION = 1
local BLOCK_W, BLOCK_H = 3, 2 -- block size in physical pixels
local HEADER_SYMBOLS, CHECKSUM_SYMBOLS = 18, 8
local CORE_WIDTHS = {
  { "level", 7 }, { "xp", 24 }, { "xpMax", 24 }, { "rested", 24 }, { "money", 32 },
  { "uiMapId", 16 }, { "x", 10 }, { "y", 10 }, { "questDigest", 16 }, { "questCount", 5 },
}
local QUEST_COUNT_BITS, QUEST_ID_BITS, QUEST_OBJ_COUNT_BITS, QUEST_OBJ_BITS = 5, 17, 3, 8
local MAX_OBJECTIVES = 2 ^ QUEST_OBJ_COUNT_BITS - 1
local MAX_QUESTS = 2 ^ QUEST_COUNT_BITS - 1
local MAX_PAGES = 15 -- the header's 4-bit page count
B.DISCLOSURE = "Live strip on. It draws a thin coded line at the top of the game window that the Forever Companion overlay on your computer reads. It never controls the game. Blizzard has not approved or ruled on this technique; use it at your own risk. /fc bridge off turns it off."
local REDRAW_EVENTS = { "PLAYER_XP_UPDATE", "PLAYER_MONEY", "QUEST_LOG_UPDATE", "ZONE_CHANGED",
  "ZONE_CHANGED_NEW_AREA", "PLAYER_LEVEL_UP" }

-- ---------------------------------------------------------------------------------------
-- Encoder (pure)

function B.fletcher16(values)
  local s1, s2 = 0, 0
  for i = 1, #values do
    s1 = (s1 + values[i]) % 255
    s2 = (s2 + s1) % 255
  end
  return s2 * 256 + s1
end

-- string.byte yields the same bytes as the JS side's UTF-8 encoding.
function B.characterTag(name, classFile)
  local s = tostring(name) .. "-" .. tostring(classFile)
  local bytes = {}
  for i = 1, #s do bytes[i] = s:byte(i) end
  return B.fletcher16(bytes)
end

local function pushBits(out, value, width)
  local max = 2 ^ width - 1
  if type(value) ~= "number" or value ~= math.floor(value) or value < 0 or value > max then
    error("value " .. tostring(value) .. " does not fit " .. width .. " bits", 2)
  end
  for i = width - 1, 0, -1 do out[#out + 1] = math.floor(value / 2 ^ i) % 2 end
end

local function append(out, bits)
  for i = 1, #bits do out[#out + 1] = bits[i] end
  return out
end

function B.packCore(core)
  local bits = {}
  for _, field in ipairs(CORE_WIDTHS) do pushBits(bits, core[field[1]], field[2]) end
  return bits
end

local function packQuest(q)
  if #q.objectives > MAX_OBJECTIVES then error("too many objectives", 2) end
  local bits = {}
  pushBits(bits, q.id, QUEST_ID_BITS)
  pushBits(bits, q.complete and 1 or 0, 1)
  pushBits(bits, q.failed and 1 or 0, 1)
  pushBits(bits, #q.objectives, QUEST_OBJ_COUNT_BITS)
  for _, have in ipairs(q.objectives) do
    pushBits(bits, math.min(255, math.max(0, math.floor(have))), QUEST_OBJ_BITS)
  end
  return bits
end

-- Splits quests into pages of at most capacityBits bits each: a 5-bit quest count, then the
-- quests. A quest is never split; one that does not fit starts the next page.
function B.packQuests(quests, capacityBits)
  local pages, cur, count = {}, nil, 0
  local function flush()
    if not cur then return end
    local page = {}
    pushBits(page, count, QUEST_COUNT_BITS)
    pages[#pages + 1] = append(page, cur)
    cur, count = nil, 0
  end
  for _, q in ipairs(quests) do
    local qb = packQuest(q)
    if QUEST_COUNT_BITS + #qb > capacityBits then error("quest does not fit a page", 2) end
    if cur and (QUEST_COUNT_BITS + #cur + #qb > capacityBits or count >= MAX_QUESTS) then flush() end
    cur = cur or {}
    append(cur, qb)
    count = count + 1
  end
  flush()
  return pages
end

-- Fletcher-16 over each quest's own bits in log order: no page counts, no padding, so it is
-- the same at every screen width.
function B.questDigest(quests)
  local bits = {}
  for _, q in ipairs(quests) do append(bits, packQuest(q)) end
  return B.fletcher16(bits)
end

local function bitsToSymbols(bits, out)
  for i = 1, #bits, 2 do out[#out + 1] = bits[i] * 2 + (bits[i + 1] or 0) end
  return out
end

function B.encodeFrame(h, bits)
  local head = {}
  pushBits(head, h.version or FORMAT_VERSION, 4)
  pushBits(head, h.seq, 8)
  pushBits(head, h.page, 4)
  pushBits(head, h.pages, 4)
  pushBits(head, h.tag, 16)
  local body = bitsToSymbols(bits, bitsToSymbols(head, {}))
  local sum = {}
  pushBits(sum, B.fletcher16(body), 16)
  local out = append({}, MARKER)
  append(out, body)
  return bitsToSymbols(sum, out)
end

function B.pageCapacityBits(widthPx)
  return (math.floor(widthPx / BLOCK_W) - #MARKER - HEADER_SYMBOLS - CHECKSUM_SYMBOLS) * 2
end

-- ---------------------------------------------------------------------------------------
-- Live state, read through the snapshot collectors and clamped so packing never throws.

local function fit(v, width)
  if type(v) ~= "number" or v ~= v then return 0 end
  v = math.floor(v)
  local max = 2 ^ width - 1
  if v < 0 then return 0 elseif v > max then return max end
  return v
end

local function perMille(f)
  if type(f) ~= "number" or f ~= f then return 0 end
  return math.max(0, math.min(1000, math.floor(f * 1000)))
end

function B.collect()
  local s = {}
  for _, name in ipairs({ "xp", "money", "location", "quests" }) do
    ns.guard("bridge:" .. name, ns.collect[name], s)
  end
  local quests = {}
  for _, q in ipairs(s.quests or {}) do
    if #quests >= MAX_QUESTS then break end
    local id = q.id
    if type(id) == "number" and id == math.floor(id) and id > 0 and id < 2 ^ QUEST_ID_BITS then
      local objectives = {}
      for i, o in ipairs(q.objectives or {}) do
        if i > MAX_OBJECTIVES then break end
        objectives[i] = fit(o.have, QUEST_OBJ_BITS)
      end
      quests[#quests + 1] = { id = id, complete = q.complete and true or false,
        failed = q.failed and true or false, objectives = objectives }
    end
  end
  local mapId = s.mapId
  if type(mapId) ~= "number" or mapId < 0 or mapId >= 2 ^ 16 then mapId = 0 end
  -- The reader calls the quest log complete only when the quest pages hold questCount quests.
  -- A log that could not be read sends no quest pages and the largest count, which never
  -- matches, so it is never mistaken for an empty log (that would mark every quest as gone).
  local questCount = s.quests and #quests or MAX_QUESTS
  local core = {
    level = fit(s.level, 7), xp = fit(s.xp, 24), xpMax = fit(s.xpMax, 24), rested = fit(s.rested, 24),
    money = fit(s.money, 32), uiMapId = math.floor(mapId), x = perMille(s.x), y = perMille(s.y),
    questDigest = B.questDigest(quests), questCount = questCount,
  }
  return core, quests
end

-- ---------------------------------------------------------------------------------------
-- Drawing

B.textures = {}
local state = { seq = 0, lastPage = 0, cursor = 0, shown = 0, levels = {} }

local function settings()
  local db = ForeverLogDB or ns.initDB()
  return db.bridge
end

local function account()
  if type(ForeverCompanionAccountDB) ~= "table" then ForeverCompanionAccountDB = {} end
  return ForeverCompanionAccountDB
end

-- PLAYER_REGEN_DISABLED fires just before the combat lockdown starts, so the event flag
-- covers its first moment; InCombatLockdown covers a reload or a toggle in mid-combat.
local function inCombat()
  if state.inCombat then return true end
  return InCombatLockdown ~= nil and InCombatLockdown() and true or false
end

-- The overlay that reads the strip runs only on macOS. Elsewhere the strip would carry the
-- risk with no benefit, so it never draws. A client without IsMacClient counts as a Mac.
function B.supported()
  return IsMacClient == nil or IsMacClient() and true or false
end

B.NOT_SUPPORTED = "The live strip works only on macOS, where the overlay can read it. Here your companion sees new data after /fc sync."

-- The one rule for drawing: a Mac client, turned on, in the world, and not in combat.
local function shouldShow()
  return B.supported() and settings().enabled and state.inWorld and not inCombat() and true or false
end

local function characterTag()
  if not state.tag then
    local name = UnitName("player")
    local _, classFile = UnitClass("player")
    if not name or not classFile then return 0 end
    state.tag = B.characterTag(name, classFile)
  end
  return state.tag
end

local function place(t, i)
  t:ClearAllPoints()
  t:SetSize(BLOCK_W * state.px, BLOCK_H * state.px)
  t:SetPoint("TOPLEFT", B.frame, "TOPLEFT", (i - 1) * BLOCK_W * state.px, 0)
end

-- Sizes the strip in physical pixels: with the parent scale ignored and scale 1, the screen
-- is 768 units high, so one physical pixel is 768 / physicalHeight units.
local function layout()
  local w, h = GetPhysicalScreenSize()
  if not w or not h or w <= 0 or h <= 0 then error("no physical screen size", 0) end
  state.width, state.px, state.slots = w, 768 / h, math.floor(w / BLOCK_W)
  local f = B.frame
  if not f then
    -- WorldFrame, not UIParent, so the strip keeps drawing while Alt+Z hides the UI.
    local parent = WorldFrame or UIParent
    f = CreateFrame("Frame", "ForeverLogPixelBridge", parent)
    f:SetIgnoreParentScale(true)
    f:SetScale(1)
    f:SetFrameStrata("TOOLTIP")
    f:SetPoint("TOPLEFT", parent, "TOPLEFT", 0, 0)
    B.frame = f
  end
  f:SetSize(state.slots * BLOCK_W * state.px, BLOCK_H * state.px)
  for i, t in ipairs(B.textures) do place(t, i) end
  state.lastKey = nil
end

-- Sets only the textures whose grey changed; textures past the frame's end are hidden.
local function paint(symbols)
  local n = math.min(#symbols, state.slots)
  for i = 1, n do
    local t = B.textures[i]
    if not t then
      t = B.frame:CreateTexture(nil, "OVERLAY")
      B.textures[i] = t
      place(t, i)
    elseif i > state.shown then
      t:Show()
    end
    local level = symbols[i]
    if state.levels[i] ~= level then
      local g = GREYS[level + 1] / 255
      t:SetColorTexture(g, g, g, 1)
      state.levels[i] = level
    end
  end
  for i = n + 1, state.shown do B.textures[i]:Hide() end
  state.shown = n
end

-- Page 0 every other redraw, quest pages rotating in between; force0 draws page 0 now.
local function nextPage(pages, force0)
  if pages <= 1 or force0 or state.lastPage ~= 0 then return 0 end
  state.cursor = state.cursor % (pages - 1) + 1
  return state.cursor
end

-- Draws the next frame. A redraw happens only when the frame differs from the one on screen
-- apart from seq, so an idle second re-sets no texture; seq counts redraws.
function B.redraw(force0)
  if not B.frame or not shouldShow() then return end
  local core, quests = B.collect()
  local questPages = ns.guard("bridge:pages", B.packQuests, quests, B.pageCapacityBits(state.width)) or {}
  while #questPages > MAX_PAGES - 1 do table.remove(questPages) end
  local pages = #questPages + 1
  local page = nextPage(pages, force0)
  local bits = page == 0 and B.packCore(core) or questPages[page]
  local tag = characterTag()
  local key = page .. ":" .. pages .. ":" .. tag .. ":" .. table.concat(bits)
  if key == state.lastKey then return end
  local seq = (state.seq + 1) % 256
  paint(B.encodeFrame({ seq = seq, page = page, pages = pages, tag = tag }, bits))
  state.seq, state.lastKey, state.lastPage = seq, key, page
end

local function tick()
  ns.guard("bridge:redraw", B.redraw)
end

local function show()
  if not B.frame then layout() end
  B.frame:Show()
  state.ticker = state.ticker or C_Timer.NewTicker(1, tick)
  B.redraw(true)
end

local function hide()
  if state.ticker then state.ticker:Cancel() end
  state.ticker = nil
  if B.frame then B.frame:Hide() end
end

-- Shows or hides the strip to match shouldShow. A combat hide leaves the setting alone.
local function refresh()
  if shouldShow() then show() else hide() end
end

-- Saves the setting and shows or hides the strip. The first time the strip is turned on per
-- account it prints the risk disclosure and returns true. Off a Mac, turning it on prints
-- one line saying it is macOS only, keeps it off and returns true (a line was printed).
function B.setEnabled(on)
  on = on and true or false
  if on and not B.supported() then
    settings().enabled = false
    ns.print(B.NOT_SUPPORTED)
    refresh()
    return true
  end
  settings().enabled = on
  local disclosed = false
  if on then
    local acct = account()
    if not acct.bridgeDisclosed then
      acct.bridgeDisclosed = true
      ns.print(B.DISCLOSURE)
      disclosed = true
    end
  end
  refresh()
  return disclosed
end

local function onEvent(event)
  if event == "PLAYER_ENTERING_WORLD" then
    state.inWorld = true
    refresh()
  elseif event == "PLAYER_REGEN_DISABLED" then
    state.inCombat = true
    refresh()
  elseif event == "PLAYER_REGEN_ENABLED" then
    state.inCombat = false
    refresh()
  elseif event == "DISPLAY_SIZE_CHANGED" then
    if B.frame then
      layout()
      B.redraw(true)
    end
  else
    B.redraw(true)
  end
end

-- Registers the bridge's events once; drawing starts when the player enters the world.
function B.start()
  if state.events then return end
  local f = CreateFrame("Frame")
  state.events = f
  pcall(f.RegisterEvent, f, "PLAYER_ENTERING_WORLD")
  pcall(f.RegisterEvent, f, "PLAYER_REGEN_DISABLED")
  pcall(f.RegisterEvent, f, "PLAYER_REGEN_ENABLED")
  pcall(f.RegisterEvent, f, "DISPLAY_SIZE_CHANGED")
  for _, event in ipairs(REDRAW_EVENTS) do pcall(f.RegisterEvent, f, event) end
  f:SetScript("OnEvent", function(_, event) ns.guard("bridge:" .. event, onEvent, event) end)
end

ns.guard("bridge:start", B.start)
