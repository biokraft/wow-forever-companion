-- The addon ships on a game publisher's add-on platform that forbids advertising:
-- no AI product or vendor name and no donation ask may appear in any addon file.

local BANNED = {
  "openai", "chatgpt", "anthropic", "claude", "gemini", "google", "openrouter",
  "copilot", "donat", "patreon", "ko%-fi",
}

-- The .toc is the authoritative file list; read it instead of shelling out (Windows CI).
local TOC = "ForeverLog.toc"

local function addonFiles()
  local f = assert(io.open("addon/ForeverLog/" .. TOC, "rb"))
  local files = { TOC }
  for line in f:lines() do
    local name = line:match("^%s*([^#%s][^%s]*%.lua)%s*$")
    -- ForeverLog_Plan.lua is generated with the player's plan text; it is git-ignored.
    if name and name ~= "ForeverLog_Plan.lua" then files[#files + 1] = name end
  end
  f:close()
  return files
end

T.run("content: addon files name no AI product or vendor and ask for no donation", function()
  local files = addonFiles()
  T.ok(#files >= 8, "found the addon files (toc plus 7 lua)")
  local hits = {}
  for _, name in ipairs(files) do
    local f = assert(io.open("addon/ForeverLog/" .. name, "rb"))
    local text = f:read("*a")
    f:close()
    local lower = text:lower()
    for _, word in ipairs(BANNED) do
      if lower:find(word) then hits[#hits + 1] = name .. ": " .. word end
    end
    if text:find("%f[%a]Pi%f[%A]") then hits[#hits + 1] = name .. ": Pi" end
  end
  T.eq(table.concat(hits, "; "), "", "banned words in addon files")
end)
