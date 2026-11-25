# Instructions for AI agents working in this repository

Forever Companion is a free, fan-made advisor for WoW: Forever: a Lua addon
(`addon/ForeverLog`), a Node CLI (`bin/wowf`, `src/`), an Electron chat overlay (`overlay/`),
skills (`skills/`) and a Pi package (`pi/`). Player docs: `README.md`, `docs/SETUP.md`.
If you were asked to install it for someone, follow `docs/AGENT-INSTALL.md` instead of this
file.

## Hard rules

- Never click, type or send keys into the game window. Nothing may open a window or take
  focus over the game by itself.
- Never commit plans, specs or design notes. Write them under `docs/superpowers/` (plans in
  `docs/superpowers/plans/`, specs in `docs/superpowers/specs/`); that folder, `docs/plans/`,
  `docs/specs/`, `.superpowers/` and `scratch/` are git-ignored on purpose. Never use
  `git add -f` or `git add -A` to get around an ignore rule, and never paste a plan into a
  tracked file to "keep" it. A test fails the build if such a folder is tracked. This
  overrides any skill or habit that says to commit a spec or plan.
- Nothing personal in tracked files, commit messages or pull requests: no real names, mail
  addresses, home folder paths, character names or chat text. Run `node scripts/privacy-scan.js`
  before every push.
- The addon names no AI product or vendor and asks for no donation. The in-game command
  shown anywhere is `/fc`.
- The live strip stays off by default. The companion gives no rotation or live combat
  advice. Setup suggests only the AI logins listed in `src/setup.js`.
- No new dependencies without asking the maintainer.

## Working here

- Tests: `task check` runs everything (root suite, overlay tests one file per process,
  addon tests, privacy scan). Without go-task: `npm test`, `node scripts/test-overlay.js`,
  `lua addon/test/run.lua`, `node scripts/privacy-scan.js`. Never run a bare `npm test`
  inside `overlay/`.
- Code must also run on Windows and on Node 22: pass paths as array arguments, never
  through a shell string; do not compare test output against host-dependent paths or text.
- One concern per commit. Do not push to `main` and do not create `v*` tags; releases are
  cut by the maintainer.
- Do not start, stop or restart a running overlay on someone's machine unless they ask.
