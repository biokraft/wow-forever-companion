# Installing Forever Companion for your user (instructions for AI agents)

You are an AI coding agent, and your user (a WoW: Forever player) asked you to install
Forever Companion for them. Follow these steps in order. They take a few minutes. The
player-facing guide is [SETUP.md](SETUP.md); the overview is the [README](../README.md).

## Rules

- You must never click or type into the game window, and never send keys to it. The player
  does everything inside the game.
- You must never handle AI keys or logins: do not ask for an API key, do not read one from a
  file, do not run `pi auth login`, and do not install Pi. With `--yes`, setup skips the AI
  login and prints the command the player runs themselves.
- Stop and ask the player instead of guessing. If a command fails and its message does not
  say what to do, show the player the message and ask.
- Never re-run setup with flags that differ from the player's answers. When a line says to
  run setup again, re-run the exact same `--yes` command from step 5, or ask the player.
  Re-run it at most once, then ask the player.
- Change nothing outside these four places:
  1. the clone of this repository (including `overlay/node_modules`, which setup fills),
  2. the player's data folder,
  3. the game's AddOns folder (`<_forever_ folder>/Interface/AddOns`, written by setup),
  4. the config folder: `~/.config/forever-companion` on macOS and Linux,
     `%APPDATA%\forever-companion` on Windows.

  The package-manager and Electron download caches are the only other things the overlay
  install touches.
- Never touch `characters/` in the data folder; `wowf sync` owns it.
- Do not turn on live state and do not turn on start at login. Both are the player's
  choice; tell them how (step 7).
- Do not start the overlay yourself. It opens a window over the game; the player starts it.

## Step 1: check Node.js

Run `node --version`. It must print `v22` or higher. If Node is missing or older, stop and
tell the player to install the LTS version from https://nodejs.org (SETUP.md, step 1, has
the details), then to tell you when it is done.

## Step 2: get the repository

First check for git, without running it. On macOS, do not run `git` before this check:
without the command line tools, `/usr/bin/git` opens an install dialog that can land over
the game.

- macOS: run `xcode-select -p`. It succeeds when the command line tools are installed, and
  then git works. If it fails, run `command -v git`: a path outside `/usr/bin` (for example
  Homebrew's `/opt/homebrew/bin/git`) is a working git. Otherwise git is missing.
- Windows and Linux: `git --version`.

If git is missing, do not install it yourself. Ask the player to install it (SETUP.md,
step 2) or to download the ZIP from the GitHub page and tell you where they unpacked it. Do
not download the code from anywhere else.

Ask the player where the wow-forever-companion folder should go if they have not said; their
home folder is a good default. Then:

```bash
git clone https://github.com/biokraft/wow-forever-companion.git
cd wow-forever-companion
```

On Windows, write `node bin\wowf` instead of `node bin/wowf` in every command below.

## Step 3: look for the game

```bash
node bin/wowf detect
```

- `Game folder: <path>` followed by a list of character folders: the game was found.
- `WoW: Forever not found. Looked in: ...`: you need the game folder from the player.
- A game folder with no characters listed: the player has never logged in. That is fine;
  setup skips the main character, and the player runs `node bin/wowf setup` again after
  their first login.

## Step 4: ask the player

Ask these in one message, with your suggested answer for each:

1. **Game folder** (only if `wowf detect` did not find it): the full path of the
   `_forever_` folder inside their World of Warcraft folder.
2. **Main character**: which of the listed character folders is their main. Skip this if
   none are listed.
3. **Data folder**: where to keep their progress data. Suggest a folder named
   `wow-companion` in their home folder, and pass it as a full path. It must not be their
   home folder itself.
4. **Chat overlay**: install the chat window that floats over the game? It downloads about
   250 MB. Without it, they can only ask from a terminal agent.

Wait for the answers. Do not pick for them.

## Step 5: run setup with the answers

```bash
node bin/wowf setup --yes --game-dir "<game folder>" --main "<character folder>" --data-dir "<data folder>"
```

- Leave out `--game-dir` if `wowf detect` found the game, and `--main` if no characters
  were listed.
- Add `--no-overlay` if the player said no to the overlay.
- Quote paths: they can contain spaces.

`wowf setup --yes` never prompts. It checks Node, saves the config, creates the data folder,
copies the addon into the game and, without `--no-overlay`, installs the overlay. It never
installs Pi, never starts an AI login and leaves start at login off. Each step prints one
line starting with `done`, `already`, `skipped` or `FAILED`. It exits with 0 when no step
failed and 1 otherwise. On a `FAILED` line, follow what the line says or ask the player.
Running setup again is safe.

## Step 6: check the result

```bash
node bin/wowf doctor
```

Each line starts with `ok` or `FIX`. Right after setup these are expected and need no fix
from you:

- `Snapshot: none yet`: the player has not typed `/fc sync` in the game yet.
- An `AI:` line saying Pi is missing or has no model: the player sets up the AI login
  (step 7).
- `Overlay: not installed`, when the player said no to the overlay. Leave it; do not install
  the overlay against their answer.

Any other `FIX` line: follow its advice if it only involves the four places above, or show
it to the player. When it says to run setup, re-run the exact same `--yes` command from
step 5 (with the same flags, `--no-overlay` included) at most once, then ask the player.

## Step 7: tell the player what is left

Relay these steps to the player in your own words:

1. **AI login** (only if the overlay was installed and `wowf doctor` showed a `FIX` line
   for AI): in the wow-forever-companion folder, run `node bin/wowf setup` themselves. It
   offers to install Pi, the AI app the overlay talks to, and lets them pick a login. AI
   providers require their users to be 18 or older.
2. **In the game:** quit WoW fully and start it again; on the character screen, click
   **AddOns** and tick **Forever Companion**; log in and type `/fc sync`.
3. **Overlay:** start it with `node bin/wowf overlay` in the wow-forever-companion folder, then
   click the round **FC** button or press **Alt+Space** and ask "what should I do next?".
   **Esc** returns to the game. On macOS, `node bin/wowf overlay autostart on` starts it at
   every login if they want that.
4. **About me:** offer to fill in the "About me" part of `AGENTS.md` in the data folder
   with their main character, who they play with, when they play and how they like
   answers. Write only what the player tells you. Goals, build and professions go in the
   game plan: they set it up in the overlay (**Plan**, then **Start my game plan**), or you
   run the `wow-gameplan` skill if they ask you to.
5. **Live state** (macOS only, off by default): `/fc bridge on` in the game lets the
   companion see level, XP and quest progress as they play. Tell them the risk in these
   words: an outside program reads a coded line that the addon draws; it never controls the
   game; Blizzard has not approved or ruled on this technique; use it at your own risk.
6. **Updating later:** `node bin/wowf update` in the wow-forever-companion folder.
