# Forever Companion reference

The details the [README](../README.md) leaves out: using the companion from a terminal
agent, the overlay, the two AI backends, the config file and every `wowf` command.

## Use it from Pi or Claude Code in a terminal

The overlay brings everything it needs. If you also want to ask from a terminal agent,
install the package there and start the agent **in your data folder**:

- Pi: `pi install git:github.com/biokraft/wow-forever-companion` (or `pi install ./` from the clone)
- Claude Code: `/plugin marketplace add biokraft/wow-forever-companion`, then
  `/plugin install forever-companion@forever-companion`

Before every question the agent syncs your newest game data. Pi reads "About me" from
`AGENTS.md` directly; Claude Code reads it through `CLAUDE.md`, which imports it.

## The overlay

- It starts hidden. Click the round **FC** button (drag it anywhere; it remembers) or press
  **Alt+Space**. **Esc** closes it (on macOS focus goes straight back to the game). It never takes focus by
  itself.
- **Plan** switches between the chat and your game plan page: the plan card on top (fold
  each part or the whole card; it remembers), a chat below to change it. Each character
  has its own plan. While you have none, the chat shows a **Set up your game plan** chip.
- **Chips** appear only when the companion asks a question with a few clear answers; they
  vanish when you answer or type. Saved chats reopen without them.
- **Long chats:** when a chat gets too long for the AI, the companion summarises the older
  part for itself and the chat shows a note. You keep the full text. Type `/compact` to do
  it right away.
- On macOS it lives only while WoW runs: when the game closes, the button, chat and hotkey
  disappear; when WoW starts again, the button comes back.
- **Start at login (macOS):** `node bin/wowf overlay autostart on` adds a per-user
  LaunchAgent (`~/Library/LaunchAgents/com.forever-companion.overlay.plist`) from the next
  login on; `off` removes it, `status` shows it. Run it from the shell you use for Pi or
  Claude Code: it records that PATH so `node`, `pi` and `claude` are found at login.
- **look** attaches a screenshot of the WoW window. On macOS allow *Screen Recording* for
  Electron once (System Settings, Privacy & Security).
- **Backends** (`overlay.backend` in the config):
  - `"pi"` (default): any model Pi supports. `node bin/wowf setup` sets up the login.
  - `"claude"`: drives **your own** installed Claude Code under **your own** login, isolated from
    your personal Claude settings. It may read your data folder, run the safe `wowf` commands,
    search the web, fetch from WoW sites only, and write only its research notes
    (`knowledge/*.md`) and plan drafts (`drafts/*.json`). Opt-in, for personal use. Note:
    Anthropic's terms do not allow third-party developers to route requests through Free, Pro, Max,
    or Ultra plan credentials on behalf of users; decide for yourself whether this mode fits
    your use, or use Pi with an Anthropic API key instead.

## Configuration

`~/.config/forever-companion/config.json` (Windows: `%APPDATA%\forever-companion\config.json`),
written by `wowf setup`:

| Key | Meaning |
|---|---|
| `gameDir` | your `_forever_` game folder |
| `dataDir` | your private data folder |
| `main` | your main character's folder name, as `wowf detect` lists it |
| `updateCheck` | `false` turns off the daily new-version check (default on) |
| `overlay.backend` | `"pi"` or `"claude"` |
| `overlay.model` | Pi model, e.g. `"openai/gpt-5.4-mini"` |
| `overlay.claudeModel` | `"haiku"`, `"sonnet"`, or `"opus"` |
| `overlay.hotkey` | default `"Alt+Space"` |
| `overlay.button` | saved FC button position |
| `overlay.chat` | saved place and size of the chat window |
| `overlay.opacity` | chat window opacity, 0.4 to 1 (default 1; also a slider in the overlay) |

## The `wowf` command

Run it as `node bin/wowf <command>` in the wow-forever-companion folder (Windows:
`node bin\wowf <command>`, with full paths such as `C:\Games\wow-companion` instead of `~`).
On macOS you can put `bin/` on your PATH and type `wowf`.

| Command | Use |
|---|---|
| `wowf setup [--yes] [--game-dir P] [--data-dir P] [--main Folder] [--no-overlay]` | set everything up; safe to run again. `--yes` never asks and skips the AI login |
| `wowf detect` | find the game folder and characters |
| `wowf sync` | copy the addon's saved data into the data folder (and compute reminders); shows live state when fresh |
| `wowf state [--json]` | sync, then show the character with fresh live state merged in |
| `wowf quests available [--zone <name>] [--band lo,hi]` | quests you can pick up now |
| `wowf quests show <id>` | givers, turn-in, prerequisites, coordinates |
| `wowf npc <name>` | find any NPC (trainers, vendors) with coordinates |
| `wowf knowledge list \| show <slug>` | the research notes the companion saved for you |
| `wowf plan write <file>` / `wowf plan show` | push a plan to the in-game panel / show the newest |
| `wowf gameplan write <file>` / `wowf gameplan show` | save your character's game plan / show it |
| `wowf classdata write <file>` / `wowf classdata show` | save what the companion researched about your class (armor, weapons, stat weights) / show it |
| `wowf overlay` | start the chat overlay |
| `wowf overlay autostart on\|off\|status` | start the overlay at login (macOS) |
| `wowf install-addon [--link]` | install (or link, for development) the addon |
| `wowf update` | pull the newest version, then refresh the overlay's packages and the addon |
| `wowf doctor` | print a health report with no personal data; paste it into a bug report |

How the parts fit together: [ARCHITECTURE.md](ARCHITECTURE.md).
