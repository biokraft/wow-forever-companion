-- Minimal test runner for the ForeverLog addon. Run from the repo root:
--   luajit addon/test/run.lua
package.path = "addon/test/?.lua;" .. package.path

local T = { passed = 0, failed = 0 }
-- Same order as ForeverLog.toc. The generated plan file is optional in tests.
T.ADDON_FILES = { "Core.lua", "Snapshot.lua", "Events.lua", "Plan.lua", "Panel.lua", "Bridge.lua", "Help.lua" }
_G.T = T

function T.eq(actual, expected, msg)
  if actual ~= expected then
    error((msg or "values differ") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual), 2)
  end
end

function T.ok(value, msg)
  if not value then error(msg or "expected truthy value", 2) end
end

-- Loads the addon files into a fresh stubbed environment and returns the addon namespace.
function T.loadAddon(overrides)
  local stub = dofile("addon/test/wowstub.lua")
  stub.install(overrides)
  local ns = {}
  for _, file in ipairs(T.ADDON_FILES) do
    local chunk = loadfile("addon/ForeverLog/" .. file)
    if chunk then chunk("ForeverLog", ns) elseif file ~= "ForeverLog_Plan.lua" then error("cannot load " .. file) end
  end
  stub.fire("ADDON_LOADED", "ForeverLog")
  return ns, stub
end

function T.run(name, fn)
  local ok, err = pcall(fn)
  if ok then
    T.passed = T.passed + 1
    io.write("ok   ", name, "\n")
  else
    T.failed = T.failed + 1
    io.write("FAIL ", name, "\n     ", tostring(err), "\n")
  end
end

for _, suite in ipairs({ "core_test", "snapshot_test", "events_test", "plan_test", "panel_test", "bridge_test", "help_test", "content_test" }) do
  dofile("addon/test/" .. suite .. ".lua")
end

io.write(string.format("\n%d passed, %d failed\n", T.passed, T.failed))
os.exit(T.failed == 0 and 0 or 1)
