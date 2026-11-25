---
name: wow-setup
description: "First-run setup for Forever Companion (WoW: Forever advisor). Use when the player says set up, install, get started, first time, or when wowf reports no config, no data folder, no addon, or no character data."
---

# Forever Companion setup

`wowf setup` does the setup: it finds the game, saves the config, creates the data folder,
installs the addon and the chat overlay, and offers the AI login. It is safe to run again.
This skill covers how to run it from an agent and what it cannot do. Never click or type
into the WoW window, and never handle AI keys or logins.

`wowf` below means the toolkit's CLI: `wowf` if it is on PATH, in Claude Code
`node "${CLAUDE_PLUGIN_ROOT}/bin/wowf"`, otherwise `node <toolkit folder>/bin/wowf`.

1. **Check first:** `wowf doctor`. Each line starts with `ok` or `FIX` and says what to run.
   If only `Snapshot: none yet` fails, skip to step 3.
2. **Run setup.** Setup asks questions, so in a terminal the player runs `wowf setup`
   themselves. From an agent, follow `docs/AGENT-INSTALL.md` in the toolkit folder: run
   `wowf detect`, ask the player for the game folder (only if not found), their main
   character, the data folder and whether to install the overlay (about 250 MB), then run
   `wowf setup --yes` with `--game-dir`, `--main`, `--data-dir` and, if they said no,
   `--no-overlay`. With `--yes`, setup skips the AI login; tell the player to run
   `wowf setup` themselves for that step.
3. **In the game** (only the player can do this): quit WoW fully and start it again, click
   **AddOns** on the character screen and tick Forever Companion, log in, and type `/fc sync`.
   Then check with `wowf sync`: it should show level, XP and zone. Empty sections show up in
   the character file's `diagnostics`.
4. **About me:** offer to fill in "About me" in `AGENTS.md` in the data folder (main
   character, friends, when they play, how they like answers). Write only what the player
   tells you. Pi reads it directly; Claude Code reads it through `CLAUDE.md`, which imports
   it. Goals, build, professions and milestones go in the game plan instead: the overlay's
   Plan page sets it up, or the `wow-gameplan` skill when the player asks for it.
5. **Questie** is strongly recommended (quest database for routes and coordinates). Without
   it, quest lookups are unavailable but everything else works.
6. **Overlay:** the player starts it with `wowf overlay`; it stays hidden until the FC button
   or Alt+Space, and Esc returns to the game. Do not start it for them.
7. **Done:** suggest asking "what should I do next?" in the overlay, or from the data folder.
