-- Forever Companion guide: a large help window with a section list. Opens once per account
-- on the first login, then only from the panel's ? button or /fc help. Never takes the
-- keyboard; Esc closes it through UISpecialFrames. New help = one more entry in SECTIONS.
local ADDON_NAME, ns = ...

local H = {}
ns.help = H

local WIDTH, HEIGHT, NAV_WIDTH = 700, 460, 180
local GOLD, GREY, TEAL, WHITE = "|cffc8a24a", "|cff8a8a90", "|cff3cc2b6", "|cffffffff"
local function head(text) return GOLD .. text .. "|r" end
local function cmd(text) return TEAL .. text .. "|r" end

local function setupText()
  local db = ForeverLogDB or {}
  local lines = { head("What the addon sees right now"), "" }
  lines[#lines + 1] = "Addon: " .. WHITE .. "v" .. tostring(ns.VERSION) .. "|r, working."
  local plan = ForeverLogPlan
  if type(plan) == "table" and type(plan.steps) == "table" and #plan.steps > 0 then
    lines[#lines + 1] = "Plan: " .. WHITE .. tostring(plan.title or "loaded") .. "|r (" .. #plan.steps .. " steps). It shows in the panel."
  else
    lines[#lines + 1] = "Plan: No plan yet. Ask your companion for one (\"plan my next hour\"), then type " .. cmd("/fc sync") .. " to load it."
  end
  local strip = db.bridge and db.bridge.enabled
  if ns.bridge and not ns.bridge.supported() then
    lines[#lines + 1] = "Live strip: macOS only. On this computer your companion sees new data after " .. cmd("/fc sync") .. "."
  else
    lines[#lines + 1] = "Live strip: " .. (strip and "on" or "off") .. (strip
      and ". Your companion sees level, XP, money, zone and quests while its overlay runs."
      or ". Type " .. cmd("/fc bridge on") .. " to let the companion see live progress.")
  end
  local snap = db.snapshot or {}
  if snap.time then
    local mins = math.floor(math.max(0, time() - snap.time) / 60)
    lines[#lines + 1] = "Last save for the companion: " .. mins .. " min ago (gear, bags, talents, skills)."
  else
    lines[#lines + 1] = "Last save for the companion: not yet. Type " .. cmd("/fc sync") .. " once so it sees your character."
  end
  lines[#lines + 1] = ""
  lines[#lines + 1] = GREY .. "Not visible from inside the game: whether the overlay or your AI app is running. If your companion says it has no data, check that first.|r"
  return table.concat(lines, "\n")
end

H.SECTIONS = {
  { id = "welcome", title = "Welcome", body = table.concat({
    head("Your AI leveling companion"), "",
    "Forever Companion connects WoW: Forever to an AI of your choice (see the README for the options).",
    "It reads your real character: level, gear, bags, talents, professions and quest log, plus every quest from your Questie database.",
    "From that it tells you what to do next and puts the plan right here in the game.", "",
    head("Three parts work together"),
    "- This addon records your progress and shows the plan panel.",
    "- The companion (your AI app, opened in your data folder) answers questions and writes plans.",
    "- An optional chat overlay floats over the game so you can ask without tabbing out.", "",
    "Use " .. cmd("Next") .. " to walk through the guide, or pick a section on the left. Reopen it any time with the " .. cmd("?") .. " on the plan panel or " .. cmd("/fc help") .. ".",
  }, "\n") },
  { id = "panel", title = "The plan panel", body = table.concat({
    head("Your plan, in the game"), "",
    "The panel shows the newest plan your companion wrote: steps in order, with NPCs, zones and coordinates.",
    "- Steps tick themselves as you play: quest turned in, level reached, item equipped, skill rank.",
    "- " .. cmd("Left-click") .. " a step for a map pin at its location.",
    "- " .. cmd("Right-click") .. " a step to tick it by hand.",
    "- Drag the panel to move it; " .. cmd("-") .. " collapses it; " .. cmd("/fc") .. " hides or shows it.",
    "- Live reminders appear under the steps: quests ready to turn in, unspent talent points.", "",
    "A new plan reaches the panel when the UI reloads: " .. cmd("/fc sync") .. ".",
  }, "\n") },
  { id = "talk", title = "Talking to your companion", body = table.concat({
    head("Two ways to ask"), "",
    "In your AI app: open your AI app (see the README) in your companion data folder and ask in plain words:",
    GREY .. "  \"What should I do next?\"  \"Is the Ringed Vest an upgrade?\"  \"Which talent at 12?\"|r", "",
    "In the chat overlay (optional): click the round " .. cmd("FC") .. " button or press " .. cmd("Alt+Space") .. ".",
    "- Tick " .. cmd("look") .. " to send a screenshot of the game with your question.",
    "- " .. cmd("Esc") .. " hands the mouse straight back to the game.", "",
    "Ask for a plan (\"plan my next hour around Razor Hill\") and it lands in the panel after " .. cmd("/fc sync") .. ".",
  }, "\n") },
  { id = "live", title = "Live sync", body = table.concat({
    head("What your companion sees without a reload"), "",
    "Live sync works on macOS only, where the chat overlay can read it.", "",
    "The live strip is off unless you turn it on with " .. cmd("/fc bridge on") .. " or in Settings. When on, the addon draws a thin line of dark pixels along the very top edge of the screen, and the chat overlay reads it every few seconds. It is hidden while you are in combat.",
    "Blizzard has not approved or ruled on this technique; turn it on at your own risk.", "",
    "Through it your companion always knows your current:",
    "- level, XP, rested XP and money",
    "- zone and position",
    "- quest progress (objectives, quests turned in or abandoned)", "",
    "Everything else reaches it only when the game saves: gear, bags, talents, professions, weapon skills and reputation.", "",
    cmd("/fc bridge off") .. " turns the line off again. Without the overlay it does nothing.",
  }, "\n") },
  { id = "sync", title = "When to /fc sync", body = table.concat({
    head("/fc sync saves your data and loads the newest plan"), "",
    "It reloads the UI for a second. Your companion asks for it only when it needs to, so you rarely have to think about it.", "",
    "Type it:",
    "- after your companion pushed a new plan (that is how the plan reaches the panel);",
    "- after changing gear, training, or spending talent points, before asking about them;",
    "- when the overlay is not running and you want an up-to-date answer.", "",
    "Not needed for where you are, your level, XP or quest progress while the overlay runs.",
    "Logging out or quitting saves too. Tip: put " .. cmd("/fc sync") .. " on an action-bar macro.",
  }, "\n") },
  { id = "setup", title = "Setup check", body = setupText },
  -- Settings: one entry per option ({ id, label, tip, get() -> bool, set(bool), and an
  -- optional available() -> bool }); the section draws a checkbox for each available one
  -- under its text. Add future options here.
  { id = "settings", title = "Settings", body = table.concat({
    head("Settings"), "",
    "Changes apply right away and are saved per character.",
  }, "\n"), settings = {
    { id = "strip", label = "Live strip for the overlay",
      tip = "Lets the overlay see level, XP, money, zone and quests without /fc sync. Blizzard has not approved this technique; use it at your own risk.",
      get = function() return ForeverLogDB and ForeverLogDB.bridge and ForeverLogDB.bridge.enabled and true or false end,
      set = function(on) if ns.bridge then ns.bridge.setEnabled(on) end end,
      available = function() return not ns.bridge or ns.bridge.supported() end },
    { id = "panel", label = "Show the plan panel",
      tip = "Same as /fc. The ? on the panel and /fc help still open this guide.",
      get = function() return ns.panel and ns.panel.frame and ns.panel.frame:IsShown() and true or false end,
      set = function(on)
        if ns.panel and ns.panel.frame and (ns.panel.frame:IsShown() and true or false) ~= on then ns.panel.toggle() end
      end },
  } },
  { id = "commands", title = "Commands", body = table.concat({
    head("Slash commands"), "",
    cmd("/fc") .. "  show or hide the plan panel",
    cmd("/fc sync") .. "  save your data for the companion and load its newest plan",
    cmd("/fc help") .. "  open this guide",
    cmd("/fc status") .. "  one-line status in chat",
    cmd("/fc bridge on") .. " / " .. cmd("off") .. "  the live strip for the overlay (macOS)", "",
    head("On the panel"),
    "Left-click a step: map pin.  Right-click: tick by hand.  " .. cmd("?") .. ": this guide.",
  }, "\n") },
}

local selected = 1

function H.indexOf(id)
  for i, s in ipairs(H.SECTIONS) do if s.id == id then return i end end
  return nil
end

function H.bodyText(section)
  if type(section.body) == "function" then return section.body() end
  return section.body
end

function H.current() return H.SECTIONS[selected] end

local function account()
  if type(ForeverCompanionAccountDB) ~= "table" then ForeverCompanionAccountDB = {} end
  return ForeverCompanionAccountDB
end

local function backdrop(f, alpha)
  if not f.SetBackdrop then return end
  f:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 14,
    insets = { left = 3, right = 3, top = 3, bottom = 3 } })
  f:SetBackdropColor(0.047, 0.043, 0.055, alpha)
  f:SetBackdropBorderColor(0.541, 0.416, 0.180, 1)
end

local function button(parent, text, width, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(width, 22)
  b:SetText(text)
  b:SetScript("OnClick", onClick)
  return b
end

function H.build()
  if H.window then return H.window end
  local f = CreateFrame("Frame", "ForeverCompanionHelp", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  H.window = f
  f:Hide()
  f:SetSize(WIDTH, HEIGHT)
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 40)
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
  backdrop(f, 0.94)
  if type(UISpecialFrames) == "table" then table.insert(UISpecialFrames, "ForeverCompanionHelp") end

  local brand = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  brand:SetPoint("TOPLEFT", f, "TOPLEFT", 14, -12)
  brand:SetText(ns.BRAND .. GREY .. "  Guide|r")

  local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -2, -2)
  close:SetScript("OnClick", function() H.close() end)

  -- Section list on the left.
  f.nav = {}
  for i, s in ipairs(H.SECTIONS) do
    local b = CreateFrame("Button", nil, f)
    b:SetSize(NAV_WIDTH - 20, 22)
    b:SetPoint("TOPLEFT", f, "TOPLEFT", 14, -40 - (i - 1) * 24)
    b.label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    b.label:SetPoint("LEFT", b, "LEFT", 6, 0)
    b.label:SetJustifyH("LEFT")
    b:SetScript("OnClick", function() ns.guard("help:nav", H.select, i) end)
    b.title = s.title
    f.nav[i] = b
  end
  local divider = f:CreateTexture(nil, "ARTWORK")
  divider:SetColorTexture(0.541, 0.416, 0.180, 0.8)
  divider:SetPoint("TOPLEFT", f, "TOPLEFT", NAV_WIDTH, -38)
  divider:SetSize(1, HEIGHT - 76)

  -- Section text on the right, scrollable so long sections fit.
  f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  f.title:SetPoint("TOPLEFT", f, "TOPLEFT", NAV_WIDTH + 16, -40)
  local scroll = CreateFrame("ScrollFrame", "ForeverCompanionHelpScroll", f, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", f, "TOPLEFT", NAV_WIDTH + 16, -68)
  scroll:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -34, 44)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(WIDTH - NAV_WIDTH - 60, 10)
  scroll:SetScrollChild(content)
  f.scroll, f.content = scroll, content
  f.body = content:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  f.body:SetPoint("TOPLEFT", content, "TOPLEFT", 0, 0)
  f.body:SetWidth(WIDTH - NAV_WIDTH - 60)
  f.body:SetJustifyH("LEFT")
  f.body:SetJustifyV("TOP")
  f.body:SetSpacing(3)

  -- Checkboxes for the Settings section, shown only while it is selected.
  local sf = CreateFrame("Frame", nil, f)
  sf:SetPoint("TOPLEFT", f, "TOPLEFT", NAV_WIDTH + 16, -130)
  sf:SetSize(WIDTH - NAV_WIDTH - 60, 200)
  sf:Hide()
  f.settingsFrame, f.settings = sf, {}
  local settings = H.SECTIONS[H.indexOf("settings")].settings
  local row = 0
  for _, opt in ipairs(settings) do
    if not opt.available or opt.available() then
      row = row + 1
      local cb = CreateFrame("CheckButton", nil, sf, "UICheckButtonTemplate")
      cb:SetSize(24, 24)
      cb:SetPoint("TOPLEFT", sf, "TOPLEFT", 0, -(row - 1) * 44)
      cb.label = sf:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      cb.label:SetPoint("LEFT", cb, "RIGHT", 4, 1)
      cb.label:SetText(opt.label)
      cb.tip = sf:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
      cb.tip:SetPoint("TOPLEFT", cb.label, "BOTTOMLEFT", 0, -2)
      cb.tip:SetWidth(WIDTH - NAV_WIDTH - 100)
      cb.tip:SetJustifyH("LEFT")
      cb.tip:SetText(opt.tip)
      cb:SetScript("OnClick", function(self)
        ns.guard("help:setting:" .. opt.id, function()
          opt.set(not self.checked)
          self.checked = opt.get()
          self:SetChecked(self.checked)
        end)
      end)
      f.settings[opt.id] = cb
    end
  end

  f.back = button(f, "Back", 80, function() ns.guard("help:back", H.prev) end)
  f.back:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -104, 14)
  f.next = button(f, "Next", 80, function() ns.guard("help:next", H.next) end)
  f.next:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -16, 14)
  f.counter = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  f.counter:SetPoint("RIGHT", f.back, "LEFT", -12, 0)
  return f
end

function H.render()
  local f = H.window
  if not f then return end
  local s = H.SECTIONS[selected]
  f.title:SetText(s.title)
  f.body:SetText(H.bodyText(s))
  f.content:SetHeight((f.body:GetStringHeight() or 14) + 8)
  if f.scroll.SetVerticalScroll then f.scroll:SetVerticalScroll(0) end
  f.settingsFrame:SetShown(s.settings ~= nil)
  for _, opt in ipairs(s.settings or {}) do
    local cb = f.settings[opt.id]
    if cb then
      cb.checked = opt.get()
      cb:SetChecked(cb.checked)
    end
  end
  for i, b in ipairs(f.nav) do b.label:SetText((i == selected and GOLD or WHITE) .. b.title .. "|r") end
  f.counter:SetText(selected .. " / " .. #H.SECTIONS)
  if f.back.SetEnabled then f.back:SetEnabled(selected > 1) end
  f.next:SetText(selected < #H.SECTIONS and "Next" or "Done")
end

function H.select(i)
  selected = math.max(1, math.min(#H.SECTIONS, math.floor(tonumber(i) or 1)))
  H.render()
end

function H.next()
  if selected >= #H.SECTIONS and H.window and H.window:IsShown() and H.window.next:GetText() == "Done" then
    return H.close()
  end
  H.select(selected + 1)
end

function H.prev() H.select(selected - 1) end

function H.open(id)
  H.build()
  H.select(id and H.indexOf(id) or selected)
  H.window:Show()
end

function H.close()
  if H.window then H.window:Hide() end
end

-- First login on this account: show the guide once, after the loading screen settles.
function H.maybeShowFirstRun()
  local acct = account()
  if acct.guideSeen then return end
  acct.guideSeen = ns.VERSION
  selected = 1
  H.open("welcome")
end

local events = CreateFrame("Frame")
pcall(events.RegisterEvent, events, "PLAYER_ENTERING_WORLD")
events:SetScript("OnEvent", function(self)
  pcall(self.UnregisterEvent, self, "PLAYER_ENTERING_WORLD")
  local function later() ns.guard("help:firstRun", H.maybeShowFirstRun) end
  if C_Timer and C_Timer.After then C_Timer.After(2, later) else later() end
end)
