# Windows compatibility plan

> **For the agent carrying this out:** work task by task, test first. For each task: write the
> failing test, run it and see it fail, make the smallest change that passes, run the whole
> suite, commit. Do not batch tasks into one commit.

**Goal:** take Windows from "beta, untested on a real PC" to a supported platform for the
addon, `wowf` and the chat overlay. Live state stays macOS-only for now (Task 12 is a
separate design).

**Where this comes from:** a first install on a real Windows 11 PC (Node 26, WoW: Forever
in `C:\Program Files (x86)\World of Warcraft\_forever_`), the test suites run on that PC,
and a read-through of every `process.platform` branch, spawn and path in the repo.

**What already works on that PC:** `wowf detect`, `wowf setup --yes` (addon copied into
`Program Files (x86)` without elevation, overlay and Electron installed), and `wowf doctor`.
Overlay tests: 237/237. Core tests: 428 pass, 2 fail (Task 1), 6 skipped.

**What still needs testing in the game on that PC:** `/fc sync`, the overlay over the game,
**look**, and Esc. Tasks 6 to 8 call out what to check.

**Tech:** Node 22+ (`node --test`), Electron overlay, Lua 5.1 addon tests.

Run everything with:

```powershell
node --test "test/*.test.js"
node --test "overlay/test/*.test.js"
lua addon/test/run.lua
```

---

## Phase 1: correctness fixes (small, low risk)

### Task 1: make the two red core tests portable

On a real Windows PC two core tests fail. In both cases the app is right and the test is not.

- `test/init.test.js:59`: `gitSafeToRun` is darwin-only logic, but it builds candidate paths
  with `path.join`, which uses `\` on a Windows host. So `/opt/homebrew/bin/git` never
  matches the fake `exists`.
- `test/setup.test.js:478`: it expects `node bin/wowf setup`, but on win32 the message
  correctly says `node bin\wowf setup`.

**Files:** `src/init.js:24`, `test/setup.test.js:478`

- [ ] In `gitSafeToRun`, use `path.posix.join(dir, 'git')`. The function only does real work
      on darwin, so POSIX paths are right.
- [ ] In the setup test, accept either separator: `/node bin[\\/]wowf setup/`.
- [ ] Check `gh run list --workflow ci.yml`. If the windows-latest jobs are red on `main` for
      the same reason, this task also turns CI green.

### Task 2: hide console windows for every spawn the overlay makes

Electron runs with no console, so every console program it starts without `windowsHide`
opens a console window. That window can land over WoW and take focus.

**Files:** `overlay/src/pi-client.js:69`, `overlay/src/claude-client.js:87`,
`overlay/src/setup-check.js:9`, and their tests.

- [ ] Test: give each client a fake `spawn` and assert the options include
      `windowsHide: true`. If the clients have no `spawn` seam yet, add one through the
      constructor options.
- [ ] Add `windowsHide: true` to the three spawns. It has no effect on macOS.

### Task 3: give the `claude` backend a Bash-safe path to `wowf` on Windows

`REPO.replace(/\/$/, '')` in `overlay/main.js:104` does not strip the trailing `\` on
Windows, so `claudeArgs` builds `node C:\...\wow-forever-companion\/bin/wowf`. Claude Code
runs Bash commands through Git Bash on Windows. Unquoted backslashes there are escapes, so
both the system prompt and the `Bash(...)` permission rules point at a path that does not
exist.

**Files:** `overlay/main.js:104`, `overlay/src/claude-client.js:41-45`,
`overlay/test/claude-client.test.js`

- [ ] Test: `claudeArgs({ repo: 'D:\\Games\\wow-forever-companion\\' , platform: 'win32' })`
      produces `node "D:/Games/wow-forever-companion/bin/wowf"` in the prompt and in
      every allow rule. Keep the current POSIX cases.
- [ ] In `claudeArgs`, strip `[\\/]+$`. On win32, convert `\` to `/`. Node and Git Bash
      both accept `C:/...`. Always quote the path.
- [ ] Manual check on Windows with `overlay.backend: "claude"`: ask "what should I do
      next?" and confirm the `wowf` tool calls run.

### Task 4: run the Claude Code plugin hook without `sh`

`hooks/hooks.json` wraps the sync in `sh -c '...'`. Whether that works depends on which
shell Claude Code uses for hooks on Windows.

**Files:** `hooks/hooks.json`, `test/plugin.test.js`

- [ ] Test: the hook command does not start with `sh ` and calls
      `node "${CLAUDE_PLUGIN_ROOT}/bin/wowf" sync --hook`.
- [ ] Change the command to exactly that. `sync --hook` already exits 0 when nothing can be
      done. A missing `node` gives a non-blocking hook error, which is acceptable.

### Task 5: find Pi the same way everywhere

`wowf setup` starts Pi as the hardcoded `pi.cmd` (`src/setup.js:30-36`). Doctor and the
overlay use `resolveTool('pi')`. A Pi installed as an `.exe` is therefore reported as
missing by setup only.

**Files:** `src/setup.js`, `test/setup.test.js`

- [ ] Test: with a fake PATH that has `pi.exe` and no `pi.cmd`, setup reports Pi as
      installed.
- [ ] Use `resolveTool('pi')` for Pi. Keep `npm.cmd` with `shell: true` and constant
      arguments, as today.

---

## Phase 2: overlay behaviour on Windows

### Task 6: tie the overlay to WoW running, as on macOS

On Windows the topmost FC button and the global hotkey are there all the time, even with
WoW closed (`overlay/main.js:31,413-414`). `isWowRunning` uses `pgrep` and is macOS-only.

**Files:** `overlay/src/focus.js` (or a new `overlay/src/wow-process.js`),
`overlay/main.js:31,413-414`, tests.

- [ ] Test: `isWowRunning({ platform: 'win32', list })` is true when the window list has a
      window titled `World of Warcraft` and false otherwise.
- [ ] Implement it with `desktopCapturer.getSources({ types: ['window'],
      thumbnailSize: { width: 0, height: 0 } })` and a title match. This starts no extra
      process. The fallback is `tasklist /FO CSV /NH` with `windowsHide: true`, matching
      the `.exe` names found in `cfg.gameDir`.
- [ ] Use `watchWow` on every platform and remove the `followWow(true)` branch.
- [ ] Manual check: start the overlay with WoW closed (no button), start WoW (the button
      appears), quit WoW (the button goes away).
- [ ] Update README (the overlay section) so it no longer says this is macOS-only.

### Task 7: choose a different default hotkey on Windows

`Alt+Space` opens the window menu in every Windows app, and PowerToys Run / Command Palette
uses it by default. If registration fails, the error only goes to `console.error`, which no
one sees in a detached GUI process.

**Files:** `overlay/main.js:395-402`, `overlay/src/hints.js` (or the status line), README,
`docs/SETUP.md`, `docs/AGENT-INSTALL.md`, `skills/wow-setup/SKILL.md`, `src/cli.js:330-331`

- [ ] Test: the default hotkey is `Alt+Space` on darwin and `Ctrl+Shift+Space` on win32.
      An explicit `overlay.hotkey` always wins.
- [ ] Test: a failed `globalShortcut.register` shows a hint in the overlay that names the
      key and the config setting.
- [ ] Update every doc that names the hotkey to give both defaults.

### Task 8: give focus back to WoW on Esc

`focusBack` is a no-op off macOS (`overlay/src/focus.js:8`). After `win.hide()`, Windows
activates whatever is next in the Z-order, which is usually WoW but not always.

- [ ] Manual check first: open the chat over WoW and press Esc. Does WoW get keyboard focus
      every time? If it does, document that and close this task.
- [ ] If it does not: get WoW's HWND from the desktopCapturer id (`window:<HWND>:0`) and
      call `SetForegroundWindow` while the overlay still owns the foreground. That needs a
      small native call (koffi). Do not spawn PowerShell for every Esc.
- [ ] Cheap first step: `win.blur()` before `win.hide()`.

### Task 9: check "look" against a DirectX game window

`capture.js` uses `desktopCapturer` on Windows, with no permission step (that part is
right). DirectX windows can come back black, and `isEmpty()` does not detect black.

- [ ] Manual check on Windows: tick **look** and ask about the screen. Is the image the
      game, or black?
- [ ] Test plus fix: if most sampled pixels are black, return a note ("the WoW window came
      back black; try Windowed (Fullscreen)") instead of sending the image.
- [ ] Docs: tell Windows players to use **Display Mode: Windowed (Fullscreen)**. It is
      needed for the overlay to draw over the game and probably for "look" too.

### Task 10: make the "stop" button stop Claude cleanly on Windows

`this.proc.kill('SIGINT')` terminates the process outright on Windows, so the chat shows
"Claude Code exited (code null)".

**Files:** `overlay/src/claude-client.js:194-196`, test

- [ ] Test: after `abort()`, an exit with a null code resolves the turn as stopped, not
      failed.
- [ ] Implement that (and, if the Claude Code stream-json input supports an interrupt
      message, send it first).

---

## Phase 3: setup, docs and robustness

### Task 11: Windows-correct wording and hints

- [ ] `overlay/src/setup-check.js:34`: do not offer `curl ... | sh` on win32.
- [ ] `src/setup.js:319,325` and `setup-check.js:38`: on win32 write `npm.cmd` / `pi.cmd`
      in the commands players type. PowerShell's default execution policy blocks the
      `.ps1` shims that plain `npm` / `pi` resolve to.
- [ ] `skills/wow-advisor/SKILL.md:21`: add the Windows config path
      `%APPDATA%\forever-companion\config.json`.
- [ ] `src/install-addon.js`: on `EPERM` / `EACCES`, say the AddOns folder is not
      writable. Today the message says "close WoW", which points the player the wrong way.
- [ ] Optional: ship `bin/wowf.cmd` (`@node "%~dp0wowf" %*`) so `bin\wowf setup` works
      without typing `node`.
- [ ] README "Requirements": move Windows from "nobody has tried it" to "tested on Windows 11
      with Node 26" once the manual checks in Tasks 3 and 6 to 9 pass. Keep the
      `Windows (beta)` string until then (`test/docs.test.js` checks for it).

### Task 12: smaller robustness items

- [ ] `src/cli.js:73-74,177`: compare the hook's cwd with `dataDir` using
      `fs.realpathSync.native` and, on win32, case-insensitively.
- [ ] `src/lua/parse.js:66-70`: treat backslash + `\r\n` as an escaped newline, as Lua
      does, in case WoW writes SavedVariables with CRLF on Windows. Add a fixture test.
- [ ] `src/config.js:39`, `src/knowledge.js:94` and the sync's atomic write: retry
      `renameSync` a few times on `EPERM` / `EBUSY` on win32 (antivirus, OneDrive).
- [ ] `src/install-addon.js:22`: add a win32 test that `install-addon --link` over an
      existing junction removes only the junction. On Node 26 this was checked by hand and
      the source survives; the test locks that in.
- [ ] `src/detect.js`: add fallbacks for installs on other drives. Check the Battle.net
      uninstall key's `InstallLocation`, then `X:\World of Warcraft\_forever_` and
      `X:\Games\World of Warcraft\_forever_` on fixed drives.
- [ ] `scripts/release.js` (maintainer only): `npm.cmd` without `shell: true` throws on
      Node 20.12+, and `zip` is not on Windows. Either fix both or state that releases are
      built on macOS / Linux.

---

## Phase 4: features that are macOS-only today

### Task 13: start at login on Windows

After Task 6, so the button only shows with WoW.

- [ ] `src/autostart.js`: add a win32 branch that writes
      `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ForeverCompanion` =
      `"<electron.exe from path.txt>" "<overlay dir>"` with `reg add` through `execFile`.
      `off` removes the value and `status` reads it.
- [ ] Remove the darwin-only guards in `src/cli.js:299` and `src/setup.js:356-357`, and
      update the docs.

### Task 14: live state on Windows (separate design, not part of this pass)

The addon side is gated with `IsMacClient()` (`addon/ForeverLog/Bridge.lua:217-219`). The
overlay side uses `screencapture` plus a TIFF reader. A Windows version needs a
native-pixel capture of the top rows of WoW's client area, for example `PrintWindow`
with `PW_RENDERFULLCONTENT` through a small native helper, at about 1 % CPU. It must not
spawn PowerShell every 10 seconds. Write a separate design before any code, covering the
helper, DPI awareness and the risk statement for Windows.

---

## Order and what to check by hand

1. Phase 1 (Tasks 1 to 5): only unit tests needed. One PR.
2. Tasks 6 and 7, then the manual checks for 8 and 9 on a real PC with the game in
   Windowed (Fullscreen). Then Task 10.
3. Phase 3.
4. Task 13. Task 14 only after its own design.
