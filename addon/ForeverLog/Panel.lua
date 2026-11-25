-- ForeverLog panel: shows the companion's current plan in game. Drag to move, click a step for a map
-- pin, right-click to tick it by hand. Refreshes on events, never per frame.
local ADDON_NAME, ns = ...

local P = {}
ns.panel = P

local MAX_ROWS = 12
local WIDTH = 270
-- Plain text marks: texture tags render as the same tick on Forever, and fonts lack ✓.
local ICON_DONE = "|cff3cc2b6[x]|r"
local ICON_TODO = "|cffc8a24a[ ]|r"
-- Palette shared with the overlay: gold-dim #c8a24a, bronze #8a6a2e, near-black #0c0b0e.
local GREY, GOLD, TEAL = "|cff8a8a90", "|cffc8a24a", "|cff3cc2b6"

local function state() return (ForeverLogDB or ns.initDB()).panel end

local function savePosition(frame)
  local point, _, _, x, y = frame:GetPoint()
  local st = state()
  st.point, st.x, st.y = point, x, y
end

function P.build()
  if P.frame then return P.frame end
  local f = CreateFrame("Frame", "ForeverLogPanel", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  P.frame = f
  f:SetWidth(WIDTH)
  f:SetFrameStrata("MEDIUM")
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self) self:StopMovingOrSizing(); savePosition(self) end)
  f:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine(ns.BRAND)
    GameTooltip:AddLine("Your plan from your AI companion. Steps tick themselves as you play.", 1, 1, 1, true)
    GameTooltip:AddLine("Click a step: map pin. Right-click: tick by hand.", 0.7, 0.7, 0.7, true)
    GameTooltip:AddLine("Drag to move. /fc hides or shows this panel. ? opens the guide.", 0.7, 0.7, 0.7, true)
    GameTooltip:Show()
  end)
  f:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
      edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12,
      insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    f:SetBackdropColor(0.047, 0.043, 0.055, 0.82)
    f:SetBackdropBorderColor(0.541, 0.416, 0.180, 1)
  end
  local st = state()
  f:ClearAllPoints()
  f:SetPoint(st.point or "RIGHT", UIParent, st.point or "RIGHT", st.x or -40, st.y or 120)

  P.brand = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  P.brand:SetPoint("TOPLEFT", f, "TOPLEFT", 10, -7)
  P.brand:SetText(ns.BRAND)

  P.header = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  P.header:SetPoint("TOPLEFT", P.brand, "BOTTOMLEFT", 0, -3)
  P.header:SetWidth(WIDTH - 40)
  P.header:SetJustifyH("LEFT")

  local toggle = CreateFrame("Button", nil, f)
  toggle:SetSize(18, 18)
  toggle:SetPoint("TOPRIGHT", f, "TOPRIGHT", -6, -5)
  toggle.label = toggle:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  toggle.label:SetPoint("CENTER", toggle, "CENTER", 0, 0)
  toggle:SetScript("OnClick", function() P.setCollapsed(not state().collapsed) end)
  P.toggleButton = toggle

  -- ? opens the guide (Help.lua); it loads after the panel, so look it up on click.
  local help = CreateFrame("Button", nil, f)
  help:SetSize(18, 18)
  help:SetPoint("RIGHT", toggle, "LEFT", -2, 0)
  help.label = help:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  help.label:SetPoint("CENTER", help, "CENTER", 0, 0)
  help.label:SetText(GOLD .. "?|r")
  help:SetScript("OnClick", function() if ns.help then ns.guard("help:open", ns.help.open) end end)
  help:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Guide (/fc help)")
    GameTooltip:Show()
  end)
  help:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  P.helpButton = help

  P.rows = {}
  for i = 1, MAX_ROWS do
    local row = CreateFrame("Button", nil, f)
    row:SetWidth(WIDTH - 20)
    row:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    row.label = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.label:SetPoint("TOPLEFT", row, "TOPLEFT", 0, 0)
    row.label:SetWidth(WIDTH - 20)
    row.label:SetJustifyH("LEFT")
    row.label:SetWordWrap(true)
    row:SetScript("OnClick", function(_, button) P.clickStep(i, button) end)
    row:Hide()
    P.rows[i] = row
  end

  P.nudges = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  P.nudges:SetWidth(WIDTH - 20)
  P.nudges:SetJustifyH("LEFT")
  P.nudges:SetWordWrap(true)

  P.empty = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  P.empty:SetPoint("TOPLEFT", P.header, "BOTTOMLEFT", 0, -6)
  P.empty:SetWidth(WIDTH - 20)
  P.empty:SetJustifyH("LEFT")
  P.empty:SetText("No plan yet. Ask your companion what's next, then /fc sync.")
  return f
end

local function currentView()
  return ns.planView(ForeverLogPlan, ForeverLogDB and ForeverLogDB.snapshot, time(), state().manual)
end

function P.refresh()
  if not P.frame then return end
  local view = currentView()
  local collapsed = state().collapsed and true or false
  P.toggleButton.label:SetText(collapsed and "+" or "-")

  if view.state == "none" then
    P.header:SetText("Next steps")
  elseif view.state == "other" then
    P.header:SetText(view.title .. " " .. GREY .. "(plan for " .. tostring(view.owner) .. ")|r")
  else
    P.header:SetText(view.title .. " " .. GREY .. view.ageText .. "|r")
  end
  P.empty:SetShown(view.state == "none" and not collapsed)

  -- Height follows the real text height, so a wrapped title never overflows the box.
  local top = 10 + (P.brand:GetStringHeight() or 12) + 3 + (P.header:GetStringHeight() or 14)
  local anchor, height = P.header, top
  for i, row in ipairs(P.rows) do
    local step = view.steps[i]
    if step and not collapsed then
      local where = step.waypoint and (" " .. GOLD .. "(" .. (step.waypoint.label or "") .. ")|r") or ""
      local text = step.done and (GREY .. step.text .. "|r") or step.text
      row.label:SetText((step.done and ICON_DONE or ICON_TODO) .. " " .. text .. where)
      row:ClearAllPoints()
      row:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -4)
      local h = math.max(16, (row.label:GetStringHeight() or 14) + 2)
      row:SetHeight(h)
      row:Show()
      anchor, height = row, height + h + 4
    else
      row:Hide()
    end
  end

  local nudgeLines = {}
  for _, n in ipairs(view.nudges or {}) do nudgeLines[#nudgeLines + 1] = "- " .. tostring(n) end
  if #nudgeLines > 0 and not collapsed and view.state ~= "none" then
    P.nudges:SetText(table.concat(nudgeLines, "\n"))
    P.nudges:ClearAllPoints()
    P.nudges:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -8)
    P.nudges:Show()
    height = height + (P.nudges:GetStringHeight() or 14) + 8
  else
    P.nudges:Hide()
  end
  if view.state == "none" and not collapsed then height = height + 6 + (P.empty:GetStringHeight() or 14) end
  P.frame:SetHeight(collapsed and top + 8 or height + 10)
end

function P.setCollapsed(collapsed)
  state().collapsed = collapsed and true or false
  ns.guard("panel", P.refresh)
end

function P.toggle()
  ns.guard("panel", function()
    P.build()
    local shown = not P.frame:IsShown()
    P.frame:SetShown(shown)
    state().shown = shown
    if shown then P.refresh() end
  end)
end

function P.clickStep(index, button)
  ns.guard("panel", P.handleClick, index, button)
end

function P.handleClick(index, button)
  local plan = ForeverLogPlan
  local step = plan and plan.steps and plan.steps[index]
  if not step then return end
  if button == "RightButton" then
    ns.toggleManual(plan, index)
    P.refresh()
    return
  end
  local wp = step.waypoint
  if not wp then
    ns.print("no map location for this step. Ask your companion to add one.")
    return
  end
  local ok = false
  if C_Map and C_Map.SetUserWaypoint and UiMapPoint and UiMapPoint.CreateFromCoordinates then
    ok = pcall(function()
      C_Map.SetUserWaypoint(UiMapPoint.CreateFromCoordinates(wp.mapId, wp.x, wp.y))
      if C_SuperTrack and C_SuperTrack.SetSuperTrackedUserWaypoint then C_SuperTrack.SetSuperTrackedUserWaypoint(true) end
    end)
  end
  ns.print((ok and "map pin set at " or "") .. tostring(wp.label))
end

ns.onRefresh = function()
  if P.frame and P.frame:IsShown() then P.refresh() end
end

local events = CreateFrame("Frame")
pcall(events.RegisterEvent, events, "PLAYER_ENTERING_WORLD")
events:SetScript("OnEvent", function()
  ns.guard("panel", function()
    P.build()
    P.frame:SetShown(state().shown ~= false)
    P.refresh()
  end)
end)
