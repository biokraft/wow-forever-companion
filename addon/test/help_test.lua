-- In-game guide: opens once per account, reopens from the panel's ? button and /fc help.

local function login(overrides)
  local ns, stub = T.loadAddon(overrides)
  stub.fire("PLAYER_ENTERING_WORLD", true, false)
  stub.flushTimers()
  return ns, stub
end

local function guideShown()
  return ForeverCompanionHelp ~= nil and ForeverCompanionHelp:IsShown()
end

T.run("guide: the first login opens it once at Welcome and remembers that per account", function()
  local ns = login()
  T.ok(guideShown(), "guide opens on the first login")
  T.eq(ns.help.current().id, "welcome")
  T.eq(ForeverCompanionAccountDB.guideSeen, ns.VERSION)
end)

T.run("guide: a later login, reload or alt with the account flag set does not open it", function()
  login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  T.ok(not guideShown(), "guide stays closed once seen")
end)

T.run("guide: saved data from an older version without the account table still works", function()
  local ns = login({ ForeverCompanionAccountDB = "garbage" })
  T.ok(guideShown())
  T.eq(type(ForeverCompanionAccountDB), "table")
  T.eq(ForeverCompanionAccountDB.guideSeen, ns.VERSION)
end)

T.run("guide: /fc help and /fc guide open it at any time", function()
  local ns = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  SlashCmdList.FOREVERLOG("help")
  T.ok(guideShown())
  ns.help.close()
  T.ok(not guideShown())
  SlashCmdList.FOREVERLOG("guide")
  T.ok(guideShown())
end)

T.run("guide: the panel's ? button opens it, also with the panel collapsed", function()
  local ns = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  T.ok(ns.panel.helpButton, "panel has a help button")
  ns.panel.setCollapsed(true)
  ns.panel.helpButton:GetScript("OnClick")(ns.panel.helpButton)
  T.ok(guideShown())
end)

T.run("guide: Next and Back walk the sections and stay in bounds", function()
  local ns = login()
  local n = #ns.help.SECTIONS
  T.ok(n >= 7, "at least seven sections")
  ns.help.prev()
  T.eq(ns.help.current().id, "welcome", "Back on the first section stays there")
  for _ = 1, n + 3 do ns.help.next() end
  T.eq(ns.help.current().id, ns.help.SECTIONS[n].id, "Next on the last section stays there")
  T.eq(ns.help.window.counter.text, n .. " / " .. n)
  ns.help.select(2)
  T.eq(ns.help.window.counter.text, "2 / " .. n)
  T.eq(ns.help.window.title.text, ns.help.SECTIONS[2].title)
end)

T.run("guide: every section has a title and a body, and opening by id selects it", function()
  local ns = login()
  for i, s in ipairs(ns.help.SECTIONS) do
    T.ok(type(s.id) == "string" and s.id ~= "", "section " .. i .. " id")
    T.ok(type(s.title) == "string" and s.title ~= "", "section " .. i .. " title")
    local body = ns.help.bodyText(s)
    T.ok(type(body) == "string" and #body > 40, "section " .. s.id .. " body")
  end
  ns.help.open("sync")
  T.eq(ns.help.current().id, "sync")
end)

T.run("guide: the setup check reports a missing plan and a disabled live strip", function()
  local ns = login()
  ForeverLogPlan = nil
  SlashCmdList.FOREVERLOG("bridge off")
  local text = ns.help.bodyText(ns.help.SECTIONS[ns.help.indexOf("setup")])
  T.ok(text:find("No plan yet", 1, true), "says no plan: " .. text)
  T.ok(text:find("Live strip: off", 1, true), "says strip off: " .. text)
  SlashCmdList.FOREVERLOG("bridge on")
  text = ns.help.bodyText(ns.help.SECTIONS[ns.help.indexOf("setup")])
  T.ok(text:find("Live strip: on", 1, true), "says strip on: " .. text)
end)

T.run("guide: Esc closes it through UISpecialFrames and it never captures the keyboard", function()
  local ns = login()
  local found = false
  for _, name in ipairs(UISpecialFrames) do if name == "ForeverCompanionHelp" then found = true end end
  T.ok(found, "registered for Esc")
  T.ok(not ForeverCompanionHelp.calls.EnableKeyboard, "no keyboard capture")
end)

T.run("guide: Settings holds toggles for the live strip and the panel, ready for more", function()
  local ns = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  local i = ns.help.indexOf("settings")
  T.ok(i, "a settings section exists")
  T.ok(i < ns.help.indexOf("commands"), "settings comes before commands")
  local s = ns.help.SECTIONS[i]
  T.ok(type(s.settings) == "table" and #s.settings >= 2, "settings are a list of options")
  ns.help.open("settings")
  local box = ns.help.window.settings
  T.ok(box and box.strip and box.panel, "a checkbox per option, keyed by id")
  T.eq(box.strip.checked, false, "strip starts off")
  box.strip:GetScript("OnClick")(box.strip)
  T.eq(ForeverLogDB.bridge.enabled, true, "ticking turns the strip on")
  T.eq(box.strip.checked, true)
  box.strip:GetScript("OnClick")(box.strip)
  T.eq(ForeverLogDB.bridge.enabled, false, "unticking turns the strip off")
  T.eq(box.strip.checked, false)
  T.eq(ns.panel.frame:IsShown(), true)
  box.panel:GetScript("OnClick")(box.panel)
  T.eq(ns.panel.frame:IsShown(), false, "unticking hides the panel")
  T.eq(box.panel.checked, false)
  ns.help.select(1)
  T.ok(not ns.help.window.settingsFrame:IsShown(), "settings controls only show on their section")
end)

T.run("guide: ticking the live strip the first time prints the risk disclosure once", function()
  local ns, stub = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  ns.help.open("settings")
  local box = ns.help.window.settings.strip
  local n = #stub.printed
  box:GetScript("OnClick")(box)
  T.eq(#stub.printed, n + 1, "one line")
  T.eq(stub.printed[n + 1], ns.BRAND .. ": " .. ns.bridge.DISCLOSURE)
  T.eq(ForeverCompanionAccountDB.bridgeDisclosed, true)
  box:GetScript("OnClick")(box)
  box:GetScript("OnClick")(box)
  T.eq(#stub.printed, n + 1, "not again")
  T.eq(box.checked, true)
end)

T.run("guide: the live sync page and the strip tip say it is off unless turned on, and the risk", function()
  local ns = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  local live = ns.help.bodyText(ns.help.SECTIONS[ns.help.indexOf("live")])
  T.ok(live:find("off unless you turn it on", 1, true), "off by default: " .. live)
  T.ok(live:find("hidden while you are in combat", 1, true), "combat: " .. live)
  T.ok(live:find("Blizzard has not approved", 1, true), "risk: " .. live)
  local tip = ns.help.SECTIONS[ns.help.indexOf("settings")].settings[1].tip
  T.ok(tip:find("Blizzard has not approved", 1, true), "risk in the tip: " .. tip)
end)

T.run("guide: the strip checkbox shows the saved setting while combat hides the strip", function()
  local ns, stub = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  SlashCmdList.FOREVERLOG("bridge on")
  stub.fire("PLAYER_REGEN_DISABLED")
  ns.help.open("settings")
  T.eq(ns.help.window.settings.strip.checked, true, "still ticked in combat")
end)

local NOT_MAC = { ForeverCompanionAccountDB = { guideSeen = "0.3.0" }, IsMacClient = function() return false end }

T.run("guide: on a non-Mac client the setup check says live state is macOS only and offers no /fc bridge on", function()
  local ns = login(NOT_MAC)
  local text = ns.help.bodyText(ns.help.SECTIONS[ns.help.indexOf("setup")])
  T.ok(text:find("macOS only", 1, true), "says macOS only: " .. text)
  T.ok(not text:find("/fc bridge on", 1, true), "no hint to turn it on: " .. text)
end)

T.run("guide: on a non-Mac client Settings offers no live strip checkbox, the panel one stays", function()
  local ns = login(NOT_MAC)
  ns.help.open("settings")
  local box = ns.help.window.settings
  T.ok(box.strip == nil, "no strip checkbox")
  T.ok(box.panel, "panel checkbox")
  T.eq(box.panel.checked, true)
  box.panel:GetScript("OnClick")(box.panel)
  T.eq(ns.panel.frame:IsShown(), false)
end)

T.run("guide: the live sync section says it works on macOS only", function()
  local ns = login({ ForeverCompanionAccountDB = { guideSeen = "0.3.0" } })
  T.ok(ns.help.bodyText(ns.help.SECTIONS[ns.help.indexOf("live")]):find("macOS", 1, true))
end)
