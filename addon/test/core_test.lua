T.run("journalAdd trims to the cap and keeps seq monotonic", function()
  local ns = T.loadAddon()
  for i = 1, ns.JOURNAL_CAP + 1 do ns.journalAdd("level", { level = i }) end
  T.eq(#ForeverLogDB.journal, 3000, "journal length")
  T.eq(ForeverLogDB.journal[1].seq, 2, "first seq after trim")
  T.eq(ForeverLogDB.journalSeq, 3001, "journalSeq")
  T.eq(ForeverLogDB.journal[3000].kind, "level")
end)

T.run("journalSeq continues across reloads", function()
  local ns = T.loadAddon()
  ns.journalAdd("death", {})
  local saved = ForeverLogDB
  local ns2, stub = T.loadAddon()
  _G.ForeverLogDB = saved
  stub.fire("ADDON_LOADED", "ForeverLog")
  ns2.journalAdd("death", {})
  T.eq(ForeverLogDB.journalSeq, 2)
end)

T.run("guard returns nil on error and records the first diagnostic only", function()
  local ns = T.loadAddon()
  T.eq(ns.guard("X", function() error("first", 0) end), nil)
  ns.guard("X", function() error("second", 0) end)
  T.eq(ForeverLogDB.diagnostics.X, "first")
end)

T.run("guard passes results through", function()
  local ns = T.loadAddon()
  local a, b = ns.guard("Y", function() return 1, 2 end)
  T.eq(a, 1); T.eq(b, 2)
  T.eq(ForeverLogDB.diagnostics.Y, nil)
end)

T.run("db carries schema and addon version", function()
  local ns = T.loadAddon()
  T.eq(ForeverLogDB.schema, 1)
  T.eq(ForeverLogDB.addonVersion, ns.VERSION)
end)

T.run("initDB: a new character starts with the live strip off", function()
  local ns = T.loadAddon()
  _G.ForeverLogDB = nil
  ns.initDB()
  T.eq(ForeverLogDB.bridge.enabled, false)
  T.eq(ForeverLogDB.bridge.v, 2)
end)

T.run("initDB: a live strip saved as on by 0.3.0 or older is reset to off once", function()
  local ns = T.loadAddon()
  _G.ForeverLogDB = { bridge = { enabled = true } }
  ns.initDB()
  T.eq(ForeverLogDB.bridge.enabled, false)
  T.eq(ForeverLogDB.bridge.v, 2)
end)

T.run("initDB: a live strip turned on after the reset stays on", function()
  local ns = T.loadAddon()
  _G.ForeverLogDB = { bridge = { enabled = true, v = 2 } }
  ns.initDB()
  T.eq(ForeverLogDB.bridge.enabled, true)
  T.eq(ForeverLogDB.bridge.v, 2)
end)

T.run("/fl sync refreshes and reloads the UI", function()
  local ns, stub = T.loadAddon()
  SlashCmdList.FOREVERLOG("sync")
  T.ok(stub.reloaded, "ReloadUI called")
  T.eq(ForeverLogDB.snapshot.level, 12)
end)

T.run("a full refresh clears diagnostics from earlier sessions", function()
  local ns = T.loadAddon()
  ForeverLogDB.diagnostics.skills = "stale message"
  ns.refresh()
  T.eq(ForeverLogDB.diagnostics.skills, nil)
end)

T.run("slash: /fc is the shown command, /cf and /fl stay registered as aliases", function()
  T.loadAddon()
  T.eq(SLASH_FOREVERLOG1, "/fc")
  T.eq(SLASH_FOREVERLOG2, "/cf")
  T.eq(SLASH_FOREVERLOG3, "/fl")
end)

T.run("slash: no addon file mentions /cf except the alias registration", function()
  local files = { "ForeverLog.toc" }
  for _, f in ipairs(T.ADDON_FILES) do files[#files + 1] = f end
  for _, name in ipairs(files) do
    local fh = assert(io.open("addon/ForeverLog/" .. name, "r"))
    local n = 0
    for line in fh:lines() do
      n = n + 1
      if line:find("/cf", 1, true) and not line:find("SLASH_FOREVERLOG2", 1, true) then
        error(name .. ":" .. n .. " shows /cf: " .. line)
      end
    end
    fh:close()
  end
end)
