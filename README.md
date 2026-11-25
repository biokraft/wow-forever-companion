# Forever Companion

<p align="center">
  <img src="assets/logo/lockup.svg" alt="Forever Companion" width="640">
</p>

<p align="center">
  <a href="https://github.com/biokraft/wow-forever-companion/actions/workflows/ci.yml"><img src="https://github.com/biokraft/wow-forever-companion/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/biokraft/wow-forever-companion/releases"><img src="https://img.shields.io/github/v/release/biokraft/wow-forever-companion?color=c8a24a" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-c8a24a" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&amp;logoColor=white" alt="Node 22 or newer">
  <img src="https://img.shields.io/badge/WoW-Forever-8a6a2e" alt="WoW: Forever">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%28beta%29-555" alt="macOS and Windows (beta)">
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/Pi-package-c8a24a" alt="Pi package"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757" alt="Claude Code plugin">
</p>

Forever Companion is a free AI leveling helper for **WoW: Forever**. It reads the data its
addon saves about your character (level, gear, bags, talents, professions, quest log) and your
installed Questie quest database, answers your questions in a small chat window over the game,
and shows its plan in a panel inside the game that ticks steps off as you play.
It sends no input to the game, reads no game memory and automates nothing.

<!-- Screenshot of the chat overlay over the game goes here: assets/screenshots/overlay.png -->

## Requirements

- **WoW: Forever** on macOS, or on Windows (beta). Windows (beta) means: the automated tests
  run on Windows, but nobody has tried the setup on a real Windows PC yet, and live state
  (below) is macOS only.
- **Node.js 22 or newer.** [docs/SETUP.md](docs/SETUP.md) shows how to install it.
- **git**, or download the project as a ZIP from GitHub instead.
- **A terminal** to paste two lines into.
- **An AI login**: an OpenAI, Anthropic or Google Gemini API key, an OpenRouter account, or
  a ChatGPT account. AI providers require their users to be 18 or older. Using an AI
  provider may cost money; that is between you and the provider.
  The author plays with the Claude Code backend (see Advanced); the default path through
  Pi is covered by the automated tests but gets less daily use, so reports are welcome.
- **About 250 MB** of disk space for the chat overlay.
- **[Questie](https://github.com/Questie/Questie)**, strongly recommended: the
  companion reads its quest database for quest givers, routes and coordinates.

## Install

On macOS, open Terminal and paste:

```bash
git clone https://github.com/biokraft/wow-forever-companion.git
cd wow-forever-companion && node bin/wowf setup
```

On Windows (beta), open PowerShell and paste:

```powershell
git clone https://github.com/biokraft/wow-forever-companion.git
cd wow-forever-companion
node bin\wowf setup
```

Setup finds the game, asks which character is your main and where to keep your progress
data, installs the addon and the chat overlay, and helps you sign in to an AI provider. It
asks only what it cannot find out by itself, and it is safe to run again: steps that are
already done are skipped.
[docs/SETUP.md](docs/SETUP.md) explains every question, and how to install Node and git.

No git? Click **Code**, then **Download ZIP** on the
[GitHub page](https://github.com/biokraft/wow-forever-companion), unpack it, open a terminal in
that folder and run `node bin/wowf setup`.

## Let your agent install it

If you use an AI coding agent (Claude Code, Codex, Pi or similar), paste this line into it:

> Clone https://github.com/biokraft/wow-forever-companion and follow docs/AGENT-INSTALL.md to set it up for me.

The agent asks you a few short questions, runs setup for you and tells you what to do in
the game. It never touches the game window and never handles your AI keys or logins:
for the AI login step it tells you to run `node bin/wowf setup` yourself.

## First steps in the game

1. Quit WoW fully and start it again (the game loads new addons only at start).
2. On the character screen, click **AddOns** and tick **Forever Companion**.
3. Log in and type `/fc sync`. This saves your character data for the companion.
4. Start the chat overlay: `node bin/wowf overlay` in the wow-forever-companion folder (on
   Windows: `node bin\wowf overlay`). Skip this if the overlay already starts at login.
5. Click the round **FC** button over the game, or press **Alt+Space**, and ask
   "what should I do next?". **Esc** closes the chat (on macOS it also hands the keyboard straight back to the game).

The first time you log in with the addon, an in-game guide opens. Reopen it any time with
the **?** on the plan panel or `/fc help`.

| In game | What it does |
|---|---|
| `/fc` | show or hide the plan panel |
| `/fc sync` | save your data for the companion and load its newest plan (reloads the UI) |
| `/fc status` | one-line status in chat |
| `/fc help` | open the in-game guide |
| `/fc bridge on\|off` | turn live state on or off (macOS, see below) |
| left-click a step | map pin at the step's location |
| right-click a step | tick it by hand |

The companion sees your data when the game saves it: on `/fc sync`, logout or quit. Put
`/fc sync` on an action-bar macro.

## What you can ask

- **What now?** The next quests to pick up and turn in, with NPC names and coordinates,
  grouped by area.
- **Upgrades:** "is the Ringed Vest an upgrade?" It compares your bags with your gear using
  your class's stat weights and weapon skills.
- **Talents, trainers, weapon skills, professions:** "which talent at 12?", "where do I train
  Engineering?", "what do I need for Mining 75?"
- **Plans in the game:** ask for a route and it puts the steps in the in-game panel. Steps
  tick themselves when you turn in the quest, reach the level, equip the item or learn the
  skill. Click a step for a map pin.
- **Look:** tick **look** in the chat to send a screenshot of the WoW window with your
  question.

It does not give rotation advice or live combat calls (what to press, when to interrupt,
where to stand). It helps with leveling, quests, routes, gear, talents, professions and
preparation.

When it needs class or profession knowledge it does not have, it reads a short list of WoW
sites and saves dated notes with their sources in your data folder. Notes older than 14 days
are checked again. Answers come from an AI and can be wrong.

Tell it about yourself: fill in "About me" in the `AGENTS.md` file in your data folder (by
default `~/wow-companion/AGENTS.md`) with your goals, talent plan and professions.

## Update

```bash
node bin/wowf update
```

(Windows: `node bin\wowf update`.) It downloads the newest version with git, refreshes the
overlay's packages when they changed and copies the new addon into the game. It stops
without changing anything if you edited files in the wow-forever-companion folder. Afterwards,
type `/reload` in the game, and if the overlay was running, run `node bin/wowf overlay`
again to restart it.

If you downloaded a ZIP, `wowf update` tells you to download the newest ZIP from the
releases page, unpack it in place of the old folder and run `node bin/wowf setup`. Your
settings and progress data live elsewhere and are kept.

Once a day the overlay and `wowf doctor` check whether a newer version is out. When one
is, the overlay shows "0.4.1 is out" with "run: node bin/wowf update", and `wowf doctor`
shows "Update: 0.4.1 is available; run: node bin/wowf update". See [Privacy](#privacy) for
what that check sends.

## Live state (macOS, optional, off by default)

With live state on and the overlay running, the companion sees your level, XP, rested XP,
money, position and quest progress as you play, without a `/fc sync`.

How it works: the addon draws a thin coded line of near-black pixels along the top edge of
the game window. The overlay takes a picture of the WoW window only, about every 10 seconds
(more often for a moment while it collects quest pages, and once before each question),
reads the line, deletes the picture at once and writes the values next to your character
data. The line is hidden while you are in combat.

**The risk:** an outside program reads a coded line that the addon draws. It never controls
the game. Blizzard has not approved or ruled on this technique; use it at your own risk.
That is why it is off unless you turn it on.

- **Turn it on:** `/fc bridge on`, or in the settings of the in-game guide. The first time,
  the addon prints a short note explaining what it does.
- **Turn it off:** `/fc bridge off`. Live data then ages out within two minutes.
- **Needs:** macOS, the overlay running, and *Screen Recording* permission for the overlay
  (the same permission **look** uses). Windows has no live state.
- **Still needs `/fc sync`:** gear, bags, loot, talents and skills. A new plan needs a reload.

Live values are never written into your snapshot, journal or plans, and the live file is
never committed to your data folder's history.

## Privacy

Your data stays on your computer. Your data folder holds snapshots of your character,
history, plans and research notes (and, if you let the companion keep them, dated progress
notes in `knowledge/progress.md`).

What leaves your computer:

- **To your AI provider**, while it answers: your question, the data the companion reads to
  answer it, and a screenshot only when you tick **look**. Pi or Claude Code may keep these
  in their own session files on your computer.
- **To WoW sites**, when the companion researches: page requests to Warcraft Tavern,
  warcraft.wiki.gg, Blizzard's forums and news, Icy Veins and Method. With the default
  Pi backend, those requests name Forever Companion in their user agent, obey each site's
  robots.txt, wait a second between pages of one site, and are never retried when a site
  blocks them. With the `claude` backend (see Advanced), Claude Code's own fetcher is used,
  limited to the same sites, and the companion may also run web searches through Claude
  Code. Sites whose terms do not allow automated access are not fetched; the companion gives
  you the link instead.
- **To GitHub**, once a day: the update check asks GitHub's public API for the newest
  release. The request carries nothing about you. Set `"updateCheck": false` in the config
  to turn it off.
- **To GitHub**, only when you click **Report a problem**: a bug form opens in your browser,
  filled in with the version, your operating system and the backend. Nothing is sent until
  you submit the form yourself.

## Advanced

### Use it from Pi or Claude Code in a terminal

The overlay brings everything it needs. If you also want to ask from a terminal agent,
install the package there and start the agent **in your data folder**:

- Pi: `pi install git:github.com/biokraft/wow-forever-companion` (or `pi install ./` from the clone)
- Claude Code: `/plugin marketplace add biokraft/wow-forever-companion`, then
  `/plugin install forever-companion@forever-companion`

Before every question the agent syncs your newest game data. Pi reads "About me" from
`AGENTS.md` directly; Claude Code reads it through `CLAUDE.md`, which imports it.

### The overlay

- It starts hidden. Click the round **FC** button (drag it anywhere; it remembers) or press
  **Alt+Space**. **Esc** closes it (on macOS focus goes straight back to the game). It never takes focus by
  itself.
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

### Configuration

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
| `overlay.opacity` | chat window opacity, 0.4 to 1 (default 1; also a slider in the overlay) |

### The `wowf` command

Run it as `node bin/wowf <command>` in the wow-forever-companion folder (Windows:
`node bin\wowf <command>`, with full paths such as `C:\Games\wow-companion` instead of `~`).
On macOS you can put `bin/` on your PATH and type `wowf`.

| Command | Use |
|---|---|
| `wowf setup [--yes] [--game-dir P] [--data-dir P] [--main Folder] [--no-overlay]` | set everything up; safe to run again. `--yes` never asks and skips the AI login |
| `wowf detect` | find the game folder and characters |
| `wowf init --data-dir <dir> [--git]` | write the config and set up the data folder (setup does this) |
| `wowf sync` | copy the addon's saved data into the data folder (and compute reminders); shows live state when fresh |
| `wowf state [--json]` | sync, then show the character with fresh live state merged in |
| `wowf quests available [--zone <name>] [--band lo,hi]` | quests you can pick up now |
| `wowf quests show <id>` | givers, turn-in, prerequisites, coordinates |
| `wowf npc <name>` | find any NPC (trainers, vendors) with coordinates |
| `wowf knowledge list \| show <slug>` | shipped and cached research notes |
| `wowf plan write <file>` / `wowf plan show` | push a plan to the in-game panel / show the newest |
| `wowf overlay` | start the chat overlay |
| `wowf overlay autostart on\|off\|status` | start the overlay at login (macOS) |
| `wowf install-addon [--link]` | install (or link, for development) the addon |
| `wowf update` | pull the newest version, then refresh the overlay's packages and the addon |
| `wowf doctor` | print a health report with no personal data; paste it into a bug report |

How the parts fit together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Troubleshooting

Run this first:

```bash
node bin/wowf doctor
```

It checks Node, the config, the game folder, the addon, the data folder, your first sync,
the overlay and the AI login, and says what to run for anything that fails. It shows your
home folder as `~` and contains no character names, so you can paste it anywhere.

- **"No synced data"**: log in, type `/fc sync`, then run `node bin/wowf sync`.
- **The addon is missing in the AddOns list**: quit WoW fully and start it again.
- **Empty talents or skills**: check `diagnostics` in your character file in the data
  folder's `characters/` folder.
- **The overlay did not install, or its Electron app did not download**: run
  `node bin/wowf setup` again.
- **Quest lookups unavailable**: install Questie.
- **The game lost its mouse cursor**: click into WoW once. The overlay never takes focus by
  itself, only when you open it.

**Report a problem:** in the overlay, click **☰** and then **Report a problem** at the bottom
of the chat list. It opens a GitHub bug form in your browser, filled in with the version,
your operating system and the backend. Paste the `wowf doctor` output into it. You can also
open an issue directly on [GitHub](https://github.com/biokraft/wow-forever-companion/issues).

## Credits and trademarks

Forever Companion is a fan-made tool. It is not affiliated with or endorsed by Blizzard
Entertainment.
World of Warcraft and Warcraft are trademarks or registered trademarks of Blizzard Entertainment, Inc.

Quest data comes from your own installed copy of [Questie](https://github.com/Questie/Questie).
Research notes cite their sources, such as [warcraft.wiki.gg](https://warcraft.wiki.gg).
The overlay is built with [Electron](https://www.electronjs.org) and talks to
[Pi](https://pi.dev) or Claude Code.

## License

[MIT](LICENSE)
