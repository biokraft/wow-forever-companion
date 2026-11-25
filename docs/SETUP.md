# Setting up Forever Companion

This guide walks you through the whole setup, step by step. The short version is in the
[README](../README.md): two lines in a terminal. Read on if you have never installed Node,
if setup asks something you are not sure about, or if something does not work.

Windows (beta): the automated tests run on Windows, but nobody has tried this setup on a
real Windows PC yet. If something goes wrong there, please [report it](#report-a-problem).
On Windows, type `node bin\wowf` where this guide says `node bin/wowf`, and use full paths
such as `C:\Games\wow-companion` where it says `~`.

## 1. Install Node.js

Forever Companion runs on Node.js 22 or newer.

**macOS**

1. Go to [nodejs.org](https://nodejs.org) and download the LTS installer for macOS.
2. Open the downloaded `.pkg` file and click through the installer.
3. Open **Terminal** (in Applications, Utilities) and type `node --version`. It should
   print `v22` or a higher number.

If you use Homebrew, `brew install node` works too.

**Windows (beta)**

1. Go to [nodejs.org](https://nodejs.org) and download the LTS installer for Windows (`.msi`).
2. Run it and keep the default options.
3. Open a **new** PowerShell window (Start menu, type "PowerShell") and type
   `node --version`. It should print `v22` or a higher number.

## 2. Get Forever Companion

You can use git, or download a ZIP. With git, updating later is one command.

**With git**

- macOS: type `git --version` in Terminal. If git is missing, macOS offers to install the
  command line tools; accept, and wait until it finishes.
- Windows: install git from [git-scm.com](https://git-scm.com) with the default options,
  then open a new PowerShell window.

Then, in the folder where you want Forever Companion to live (your home folder is fine):

```bash
git clone https://github.com/biokraft/wow-forever-companion.git
cd wow-forever-companion
```

**Without git**

On the [GitHub page](https://github.com/biokraft/wow-forever-companion), click **Code**, then
**Download ZIP**. Unpack it where you want it to live, then open a terminal in that folder:

- macOS: in Terminal type `cd ` (with a space), drag the unpacked folder onto the Terminal
  window and press Return.
- Windows: open the unpacked folder in Explorer, click the address bar, type `powershell`
  and press Enter.

## 3. Run setup

In the wow-forever-companion folder, run:

```bash
node bin/wowf setup
```

Setup goes through the steps below. Each step checks first, so you can run setup again at
any time: steps that are already done say "already" and are skipped. Each step's result
starts with `done`, `already`, `skipped` or `FAILED`.

**Node.** Setup checks your Node version. Below 22 it stops and shows the download link.

**Game folder.** Setup looks for WoW: Forever in the usual places:
`/Applications/World of Warcraft/_forever_` on macOS, and on Windows the folder Battle.net
recorded, `C:\Program Files (x86)\World of Warcraft\_forever_` and
`C:\Program Files\World of Warcraft\_forever_`. If the game is somewhere else, setup asks
for the path. Paste the path of the `_forever_` folder (the one that holds `Interface` or
`WTF`). On macOS you can drag the folder onto the Terminal window instead of typing it.

**Main character.** Setup lists the characters it finds and asks which one is your main.
The companion answers for this character. Characters appear only after you have logged in
with them once. If you have never logged in, setup skips this step: log in once, then run
setup again to pick your main.

**Data folder.** Setup asks where to keep your progress data. Press Enter for the default,
`~/wow-companion` (a folder named `wow-companion` in your home folder). Pick a new, empty
folder, not your home folder itself. Setup creates:

- `AGENTS.md`: notes about you that the companion reads every time (see step 5).
- `characters/`: your character data, copied from the game by `wowf sync`.
- `plans/`, `knowledge/`, `drafts/`: plans, research notes and drafts the companion writes.

If git is installed, the folder keeps a history of every sync.

**Addon.** Setup copies the Forever Companion addon into the game's `Interface/AddOns`
folder. If WoW is running, restart it afterwards: the game loads addons only at start. If
the copy fails, close WoW and run setup again.

**Chat overlay.** Setup asks "Install the chat overlay? It downloads about 250 MB." The
overlay is the chat window that floats over the game. Answer yes unless you want to use the
companion only from a terminal agent (see Advanced in the README). The download can take a
few minutes.

**AI login.** The overlay talks to an AI through Pi, a free AI app that runs on your
computer. If Pi is missing, setup offers to install it
(`npm install -g @earendil-works/pi-coding-agent`). Then, if Pi has no AI login yet, setup
reminds you that AI providers require their users to be 18 or older and shows this menu:

| Choice | What you need |
|---|---|
| OpenAI API key | an API key from your OpenAI platform account; you pay OpenAI per use |
| Anthropic API key | an API key from your Anthropic console account; you pay Anthropic per use |
| Google Gemini API key (paid tier) | a Gemini API key from a Google project with billing turned on |
| OpenRouter | an OpenRouter account; you sign in in your browser and pick from many models |
| Sign in with ChatGPT (official flow) | your ChatGPT account; OpenAI's own sign-in page opens in your browser |
| Skip (I will set up Pi myself) | nothing now; run setup again later |

After you choose, setup hands the terminal to Pi. Pi asks for your key or opens the sign-in
page. What you type goes to Pi only; Forever Companion never sees or stores your key.

**Start at login (macOS).** Setup asks whether the overlay should start when you log in to
your Mac. It stays hidden until WoW runs. The default is no. You can change it later with
`node bin/wowf overlay autostart on` or `off`.

**Finish.** Setup prints the steps for the game (next section) and how to start the overlay.

### Options for scripted runs

| Option | Effect |
|---|---|
| `--yes` | never asks; takes the defaults. Installs the overlay unless `--no-overlay` is given. Never installs Pi and never starts an AI login: it tells you to run `node bin/wowf setup` yourself for that step |
| `--game-dir <path>` | the `_forever_` folder, when setup cannot find it |
| `--data-dir <path>` | the data folder (default `~/wow-companion`) |
| `--main <folder>` | your main character's folder name, as `node bin/wowf detect` lists it |
| `--no-overlay` | skip the chat overlay (and so the AI login and start at login) |

## 4. First steps in the game

1. Quit WoW fully and start it again. The game loads new addons only at start.
2. On the character screen, click **AddOns** and tick **Forever Companion**.
3. Log in and type `/fc sync`. This saves your character data for the companion and
   reloads the interface.
4. Start the overlay: `node bin/wowf overlay` in the wow-forever-companion folder (skip this if
   it starts at login). It starts hidden.
5. Click the round **FC** button over the game, or press **Alt+Space**, and ask "what should
   I do next?". **Esc** closes the chat (on macOS it also hands the keyboard straight back to the game).

The first time you log in with the addon, an in-game guide opens. Reopen it with the **?**
on the plan panel or `/fc help`.

The companion sees new gear, bags, talents and skills when the game saves them: on
`/fc sync`, logout or quit. Put `/fc sync` on an action-bar macro.

On macOS, the first time you tick **look** in the chat, macOS asks for *Screen Recording*
permission for the overlay (shown as Electron). Allow it in System Settings, Privacy &
Security, then try again.

## 5. Tell the companion about you

Open `AGENTS.md` in your data folder (by default `~/wow-companion/AGENTS.md`) in any text
editor and fill in the "About me" part: your main character, your goals, your talent plan,
your professions, and anything you do not want suggested. The companion reads it before
every answer.

## 6. Updating

```bash
node bin/wowf update
```

This gets the newest version with git, updates the overlay's packages when they changed,
and copies the new addon into the game. If you changed files in the forever-companion
folder, it lists them and stops without changing anything. Afterwards, type `/reload` in
the game, and if the overlay was running, run `node bin/wowf overlay` again to restart it.

If you downloaded a ZIP, `wowf update` explains what to do: download the newest ZIP from
the [releases page](https://github.com/biokraft/wow-forever-companion/releases), unpack it in
place of the old folder, and run `node bin/wowf setup`. Your settings and your data folder
live elsewhere and are kept.

Once a day the overlay and `node bin/wowf doctor` ask GitHub whether a newer version is out
and show one line when it is. The request carries nothing about you. To turn it off, add
`"updateCheck": false` to the config file (`~/.config/forever-companion/config.json`, on
Windows `%APPDATA%\forever-companion\config.json`).

## 7. Live state (macOS, optional)

Live state lets the companion see your level, XP, rested XP, money, position and quest
progress as you play, without a `/fc sync`. It is off unless you turn it on.

When it is on, the addon draws a thin coded line of near-black pixels along the top edge of
the game window, and the overlay reads it from a picture of the WoW window about every 10
seconds (more often for a moment while it collects quest pages, and once before each
question). The picture is deleted at once. The line is hidden while you are in combat.

**The risk:** an outside program reads a coded line that the addon draws. It never controls
the game. Blizzard has not approved or ruled on this technique; use it at your own risk.

- Turn it on with `/fc bridge on` in the game, or in the settings of the in-game guide.
- Turn it off with `/fc bridge off`.
- It needs the overlay running and *Screen Recording* permission for it.
- Gear, bags, talents and skills still need `/fc sync`.
- Windows has no live state.

## 8. Troubleshooting

Run:

```bash
node bin/wowf doctor
```

It prints one line per check, each starting with `ok` or `FIX`, and says what to run for
anything that needs fixing. Right after setup, two lines are normal until you have played:
"Snapshot: none yet" (log in and type `/fc sync`) and, if you skipped the AI login, the AI
line. The report shows your home folder as `~` and contains no character names, so it is
safe to paste into a bug report.

| Problem | What to do |
|---|---|
| `node` is not found, or the version is below 22 | install Node again (step 1), then open a new terminal window |
| "WoW: Forever was not found" | run setup again and paste the `_forever_` folder's path, or pass `--game-dir` |
| No characters listed | log in to the game once with your main, then run setup again |
| Forever Companion is missing in the AddOns list | quit WoW fully and start it again |
| "No synced data" | log in, type `/fc sync`, then run `node bin/wowf sync` |
| The overlay did not install, or Electron did not download | check your internet connection and run setup again |
| The overlay says Pi has no AI login | run `node bin/wowf setup` and pick a login |
| Quest lookups unavailable | install Questie |
| The game lost its mouse cursor | click into WoW once; the overlay never takes focus by itself |
| `wowf update` lists changed files | undo your changes to those files (for example `git stash`), then update again |

### Report a problem

In the overlay, click **☰** and then **Report a problem** at the bottom of the chat list. A
GitHub bug form opens in your browser, filled in with the version, your operating system and
the backend (nothing else). Paste the output of `node bin/wowf doctor` into it. You need a
GitHub account to submit it. Without the overlay, open an issue on
[GitHub](https://github.com/biokraft/wow-forever-companion/issues).
