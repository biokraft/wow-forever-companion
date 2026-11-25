# Changelog

## Unreleased

- **Your game plan.** A **Plan** button in the chat overlay opens one page per character with
  your goal, role and build, playstyle, professions, milestones and what to skip, on a card
  whose parts fold in and out. The first time, click **Start my game plan** and the
  companion asks a few questions, one at a time. Every answer then follows the plan, and the
  companion says so when something you ask goes against it and offers to update it. From a
  terminal agent, ask "set up my game plan"; `wowf gameplan show` prints it.
- **Reply chips.** When the companion asks a question with a few likely answers, it offers
  them as chips above the input: click one to answer, or tick several and click
  **Send these**. You can always type instead.
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
