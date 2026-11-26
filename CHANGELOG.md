# Changelog

## Unreleased

## 0.5.0 (2026-11-26)

**Easier to install and update**

- **One line to install.** On macOS paste one line into Terminal, on Windows one line
  into PowerShell (both are in the README). It checks for Node.js and offers to install
  it, downloads Forever Companion (git is no longer needed) and starts setup. Pasting it
  again updates.
- `wowf update` now also works in a folder made without git: it downloads the newest
  files and replaces the old ones.
- `wowf init` is gone: `wowf setup` does the same and more.

**The companion knows more about you**

- **Your game plan.** A **Plan** button in the chat overlay opens one page per character with
  your goal, role and build, playstyle, professions, milestones and what to skip, on a card
  whose parts fold in and out. The first time, click **Start my game plan** and the
  companion asks a few questions, one at a time. Every answer then follows the plan, and the
  companion says so when something you ask goes against it and offers to update it. From a
  terminal agent, ask "set up my game plan"; `wowf gameplan show` prints it.
- **Your spellbook.** The addon now saves which spells and abilities your character
  knows, profession abilities included, so the companion can check before it says you have
  one or puts it in a macro. After updating, type `/reload` and `/fc sync` once.
- **Upgrade reminders for every class.** The companion now researches what your class can
  wear and wield and how much each stat is worth, and saves it in your data folder
  (`wowf classdata show`). The "upgrade in bags" reminder works from that, for any class;
  before, only Warriors got it, from a file that shipped with the toolkit. Until the companion
  has done that research for your class (ask it about an item), there is no such reminder.
- **No shipped game notes any more.** The toolkit carried hand-written notes for one class
  and four professions that never aged out. They are gone: the companion looks up what it
  needs for your class and professions on the allowed WoW sites, saves dated notes in your
  data folder and checks them again after 14 days. `wowf knowledge list` shows only your own.
- "About me" in your data folder's `AGENTS.md` now holds who you play with, when you play
  and how you like your answers; goals, build and professions moved to the game plan.

**The chat**

- **Reply chips.** When the companion asks a question with a few likely answers, it offers
  them as chips above the input: click one to answer, or tick several and click
  **Send these**. You can always type instead.
- **Stop.** While the companion answers, a **Stop** button ends the answer. The chat keeps
  what was written so far, and your next question goes on in the same conversation.
- Macros and commands in answers appear in their own box, exactly as written, with a
  **Copy** button for pasting into the game.
- Every answer shows when it was written, so an older "you have 63s now" is not taken
  for the present.
- Numbered steps in answers keep their numbers: a list no longer restarts at 1 after a
  paragraph or bullets in between, and bullets under a step are shown under that step.
- Sources in answers are links now instead of raw `[text](address)`; a click opens the page
  in your browser.
- A failed question offers **Try again**.
- The chat window opens where you left it, at the size you gave it. The first time, it is
  a little larger and sits left of the minimap and quest tracker; the round button starts
  just below the minimap.
- When another app holds the key that opens the chat, the chat says so and names the
  setting to change; the round button's tooltip names the key you really use.
- Commands the overlay asks you to run (on the "Almost there" page and in the new-version
  notice) can be copied with a click.

**Fixed**

- The companion could fail to read your character when a gear slot was empty (no helmet,
  necklace or trinket yet). It reads it again.

## 0.4.0 (2026-11-25)

First public release of Forever Companion: an advisor for WoW: Forever that reads your real
character and quest data and answers in an AI app or in a small chat window beside the game.
It tells you what to do next, which quests to take or turn in, whether an item is an upgrade,
which talents to pick and how to level your professions. It never clicks, types or sends keys
in the game.

- **ForeverLog addon.** Saves a snapshot of your character (level, gear, talents, skills,
  quests, money) and a journal of what happened, so your companion knows where you stand.
  Type `/fc sync` to save, `/fc` to show or hide the plan panel, `/fc help` for the guide.
- **In-game guide.** `/fc help` explains the commands and settings inside the game.
- **Plan panel with map pins.** The companion's step-by-step plan shows in game; steps tick
  themselves off as you turn in quests, level up or equip items.
- **Live state, opt-in (macOS).** `/fc bridge on` draws a thin coded line at the top of the
  game window that the chat overlay reads, so the companion sees your level, XP, money, map
  and quest progress without `/fc sync`. It is off by default. Blizzard has not approved or
  ruled on this technique, so use it at your own risk; `/fc bridge off` turns it off.
- **One command from clone to ready.** `wowf setup` finds the game, installs the addon, sets
  up your data folder and, if you want it, the chat overlay and an AI login. `wowf update`
  brings the toolkit and the addon to the newest version, and `wowf doctor` prints a short
  report you can paste when something goes wrong (no character names, your home folder
  shown as `~`).
- **Chat overlay.** A small chat window beside the game with suggestions that follow what is
  happening in your game, one click to ask them, and a history of past chats you can reopen
  and continue. While the companion works you see what it is doing. Long chats are
  summarised for the companion when they get too long (you keep the full text); typing
  `/compact` does it right away.
- **Report a problem.** A link in the overlay opens a bug report on GitHub with only the
  toolkit version, system and AI backend filled in. Nothing is sent until you submit it.
- **Works with your AI app.** Pi and Claude Code both get the advisor skills and keep your
  saved data in sync before each question.

## Earlier versions

Versions 0.2.0 and 0.3.0 were never published; everything they held is part of 0.4.0.
