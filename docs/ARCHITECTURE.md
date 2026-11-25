# Architecture

```
 WoW: Forever client                        Your machine
 ┌──────────────────────┐   SavedVariables   ┌───────────────┐   JSON    ┌──────────────────┐
 │ ForeverLog addon     │ ─────────────────▶ │ wowf sync     │ ────────▶ │ data folder      │
 │ (snapshot, journal,  │  (on /fc sync,     │ (Node CLI)    │           │ characters/      │
 │  plan panel)         │   logout, quit)    └───────────────┘           │ plans/ knowledge/│
 │                      │ ◀───────────────── wowf plan write ◀────────── │ CLAUDE.md        │
 └──────────────────────┘  ForeverLog_Plan.lua (loaded on reload)        └──────────────────┘
                                                                                  ▲
        Questie's installed database ──▶ wowf quests / npc (read from disk)       │ reads, writes notes
                                                                                  │
                                    AI agent (Pi or Claude Code) with the wow-advisor skill
                                    and the overlay chat window (Electron) in front of it
```

Live path (macOS, off until the player turns it on with `/fc bridge on`): the addon also
draws a pixel strip along the top edge of the game window, hidden in combat (`Bridge.lua`:
level, XP, rested, money, zone and position, quest progress). The overlay captures only
the WoW window with `screencapture` every 10 s into a temporary TIFF, reads the strip from
its top rows and deletes the file at once (short bursts while the quest pages are still
incomplete, once before each question), decodes the strip, and writes
`characters/<slug>.live.json`. `wowf` lays fresh live data over the last snapshot for every
reader.

```
 addon strip ──▶ screencapture (WoW window) ──▶ overlay bridge-reader ──▶ <slug>.live.json ──▶ wowf (overlay on snapshot)
```

## Components

| Part | Where | What it does |
|---|---|---|
| ForeverLog addon | `addon/ForeverLog/` | Records a snapshot (level, XP, gear, bags, talents, skills, quests, completed quests, reputations) and a journal of events in SavedVariables; shows the plan panel; `/fc`. Event-driven, never throws, probes modern and classic APIs. |
| `wowf` CLI | `bin/wowf`, `src/` | Parses SavedVariables, writes JSON + journal into the data folder, computes reminders, reads Questie's baked database (CBOR in the `.toc`), validates and emits plans as Lua, manages the knowledge cache. Zero runtime dependencies. |
| Setup and update | `src/setup.js`, `src/update.js`, `src/doctor.js`, `src/update-check.js` | `wowf setup` takes a fresh clone to a working install (config, data folder, addon, overlay packages, Pi login offer); every step checks first, so it is safe to run again. `wowf update` pulls with `--ff-only` and refreshes the overlay packages and the addon. `wowf doctor` prints a health report without personal data. The overlay and `doctor` ask GitHub for the newest release once a day. Player guide: [SETUP.md](SETUP.md); agent guide: [AGENT-INSTALL.md](AGENT-INSTALL.md). |
| Skills | `skills/` | `wow-advisor` (how to answer; follows the game plan), `wow-checkin` (quick status), `wow-gameplan` (the game plan interview and later changes), `wow-setup` (first run around `wowf setup`). Agent Skills format, used by Pi and Claude Code. |
| Pi package | `pi/` | Extension: syncs before each prompt; tools `wow_state`, `wow_quests`, `wow_npc`, `wow_plan_write`, `wow_gameplan`, `wow_knowledge`, `wow_web_fetch` (WoW sites only). |
| Claude Code plugin | `.claude-plugin/`, `hooks/` | Same skills; a prompt hook runs `wowf sync --hook` in the data folder. |
| Overlay | `overlay/` | Electron chat window and FC launcher. Talks to `pi --mode rpc` or `claude -p` (stream JSON). Renders reply chips (see below) and the game plan page: a foldable plan card drawn from the validated game plan file, with its own chat per character. On macOS also decodes the addon's pixel strip into `<slug>.live.json` (`src/bridge-reader.js`). |
| Game plan | `src/gameplan.js` | `wowf gameplan write <file>` validates a game plan (schema version 1: summary and goal required; role, playstyle, professions, milestones, avoid, notes, each with length and count limits) and stores it atomically in `gameplans/<slug>.json`; an invalid plan exits 1 with every reason and writes nothing. `wowf gameplan show` prints it. The Claude Code hook, `wowf sync` and Pi add one `Game plan: <summary> · next: <milestone>` line before each prompt. |
| Live state | `src/live.js` | Merges `<slug>.live.json` over the snapshot when it is under 2 minutes old and newer than the saved game data; read-only, never written back to the snapshot, journal, or plans. |
| Knowledge | `knowledge/` | Shipped notes (Forever rule changes, Warrior and professions as examples). Players' agents add their own notes to `<data>/knowledge/`. |

## Data folder

```
<data>/
  CLAUDE.md, AGENTS.md     the player's goals and preferences (read by the agent)
  characters/<realm>-<name>.json          latest snapshot + reminders + diagnostics
  characters/<realm>-<name>.journal.jsonl history: level, quests, loot, gear, skills, deaths, zones
  characters/<realm>-<name>.live.json     live state from the pixel strip (gitignored, overwritten, never committed)
  plans/*.json             every plan pushed to the panel
  gameplans/<realm>-<name>.json  the character's game plan (written only by wowf gameplan write)
  knowledge/*.md           researched notes: topic, sources, checked date, scope
  knowledge/progress.md    dated progress notes the overlay's agent keeps (level, zone, quests)
  drafts/                  scratch files the agent writes before pushing a plan or saving the game plan
```

The game plan has its own folder because `wowf plan show` reads every file in `plans/` as a
step plan. "About me" in `AGENTS.md` keeps the rest (friends, schedule, tone); for goal,
build, playstyle, professions, milestones and avoid, the game plan wins.

## Reply chips

In overlay chats only, an answer may end with one block that the overlay turns into chips:

```
<choices>
Fast questing
Dungeons
A mix
</choices>
```

`<choices multi>` lets the player tick several and send them together. 2 to 6 options, each
a plain line of at most 40 characters, and nothing after the closing tag; anything else is
not a chip block and shows as written (`overlay/src/choices.js`, pure). The block is hidden
while the answer streams and is not saved with the chat, so reopened chats show no chips.
The rules reach the agent through the overlay's system-prompt addition
(`overlay/src/advice-rules.js`, both backends); terminal agents are told never to write it.

## Trust order for answers

1. The player's Questie database (exact quest data, offline).
2. Knowledge notes, shipped or cached, with sources and dates.
3. Fresh research on allowlisted WoW sites, saved back as a note.
4. The model's own memory, last, and said so.

## Safety rules

- Nothing ever sends keys, clicks, or chat into the game.
- The overlay's agent gets read tools, the safe `wowf` subcommands, writes only to
  `knowledge/*.md` and `drafts/*.json` in the data folder, and fetches only from WoW sites
  (redirects are re-checked on every hop).
- The addon cannot reach the network; data crosses only through files the game reads or writes,
  plus the pixel strip, which the overlay reads from a screenshot of the WoW window only.
