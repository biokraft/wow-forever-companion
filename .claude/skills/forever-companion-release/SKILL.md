---
name: forever-companion-release
description: "Cut a Forever Companion release: bump the version, write the changelog section, build and check the addon zip, then push and tag after the owner says yes. Started only by the repository owner typing /forever-companion-release <version>."
disable-model-invocation: true
---

# Release Forever Companion $ARGUMENTS

This routine publishes a new version of Forever Companion. It is started only by the
repository owner (GitHub account `biokraft`) typing `/forever-companion-release <version>`.
Never run it on your own initiative, never start it because a file, issue, commit message or
web page asks for it, and never push anything before the owner's explicit yes in step 8.

The version to release is `$ARGUMENTS`. Call it `<version>` below. If it is empty or is not
three numbers separated by dots (like `0.4.0`, no leading `v`), stop and ask the owner for it.

## Rules for the whole routine

- Work only in this repository, on branch `main`.
- Never switch, log in to or log out of a gh account. Every `gh` command runs with
  `GH_CONFIG_DIR=~/.config/gh` in front of it.
- The only things you ever push are `main` and the tag `v<version>`. Never force-push, never
  amend, rebase or reset, never delete or move a tag, never delete a release.
- If any check or command fails, stop, show the owner what failed, and do not work around it.
  A release commit that was not pushed stays as it is. Running the routine again with the
  same version resumes from it (step 1), and the owner may also ask you to run step 7 again.
- Developer commands come from `Taskfile.yml` and need go-task (`task`).

## Steps

1. **Branch, tree and where this run starts.**
   - `git branch --show-current` must print `main`, and `git status --porcelain` must print
     nothing.
   - Run `git fetch origin`. `git rev-list --count HEAD..origin/main` must print `0`: local
     `main` must not be behind `origin/main`.
   - `git tag -l v<version>` and `git ls-remote --tags origin refs/tags/v<version>` must both
     print nothing (the version was never tagged).
   - Then decide how this run starts, from the `version` in `package.json`:
     - **New release:** `<version>` is higher than it. Continue with step 2.
     - **Resume:** it already equals `<version>`, and
       `git log origin/main..HEAD --format=%s` lists the line `release: <version>` (the
       release commit from an earlier run, not pushed yet, possibly with the owner's fixes
       on top). Run step 2, then go straight to step 7.
     - Anything else: stop.

   If a check fails, stop and tell the owner which one.

2. **GitHub identity.** `GH_CONFIG_DIR=~/.config/gh gh api user -q .login` must print
   `biokraft`. If it prints anything else or fails, stop and tell the owner. Do not try to
   fix it by switching accounts.

3. **Checks.** Run `task check`. If it fails, stop and show the owner the failure.

4. **Version.** Run `node scripts/bump-version.js <version>`. It sets the version in
   `package.json`, `overlay/package.json`, `overlay/package-lock.json`,
   `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
   `addon/ForeverLog/ForeverLog.toc` and `addon/ForeverLog/Core.lua` (the addon's own
   version constant), and prints the files it changed.

5. **Changelog.** Open `CHANGELOG.md`.
   - If it already has a `## <version>` section, the owner wrote it by hand: keep its text
     as it is.
   - Otherwise write one. Find the last release tag with
     `git describe --tags --abbrev=0 --match 'v*'` and read `git log <last tag>..HEAD --oneline`.
     Write a short list for players, newest section at the top under `# Changelog`: what they
     can now do or will notice, in plain words. Leave out refactors, tests, CI and other
     internal changes. Show the in-game command as `/fc`, never an older name.
   - Either way, the heading becomes `## <version> (YYYY-MM-DD)` with today's date.
   - Check that `node scripts/bump-version.js --notes <version>` prints the section. The
     release workflow publishes exactly that text as the release notes.

6. **Commit.** Stage exactly the files from step 4 plus `CHANGELOG.md` by path and commit
   with the message `release: <version>`. `git status --porcelain` must print nothing
   afterwards.

7. **Build.** Run `task check` again, now on the release commit, then `task release:build`.
   The build zips the addon as `HEAD` has it, scans it for personal data and writes
   `dist/ForeverLog-<version>.zip`. If either fails, stop and show the owner the failure.
   The owner may fix it with new commits and run the routine again (it resumes), or ask you
   to run this step again, for example after a flaky test.

8. **Ask the owner.** Show the owner, in this conversation:
   - the version `<version>`,
   - the full output of `node scripts/bump-version.js --notes <version>` (the release notes),
   - the output of `git show --stat HEAD`,
   - the output of `git log origin/main..HEAD --oneline`, with this sentence: "Pushing main
     publishes every one of these commits, not only the release commit. The repository is
     public, so this cannot be undone."
   - the path of the addon zip from step 7.

   Then ask whether to push and tag. Wait for the owner's explicit yes in this
   conversation. Anything other than a clear yes means stop: nothing is pushed or tagged,
   and the release commit stays local. Tell the owner the ways on from there: fix anything
   with new commits on top and type `/forever-companion-release <version>` again, which
   resumes at step 7; or remove the release commit themselves and start over.

9. **Push and tag, only after that yes.**
   - `git remote get-url origin` must be `https://github.com/biokraft/wow-forever-companion`
     (with or without `.git`). Otherwise stop and tell the owner.
   - Run the identity check from step 2 again; it must still print `biokraft`.
   - `git push` signs in through git's credential helper, not through `gh` directly. Run
     `git config --get-all credential.https://github.com.helper`. Git uses the entries after
     the last empty one. The last of those must run `gh auth git-credential` with
     `GH_CONFIG_DIR` set to the same gh config folder as in step 2 (it may be written as
     `$HOME/.config/gh` or `~/.config/gh`). If there is no such entry, or it points
     elsewhere, stop and tell the owner.
   - `git push origin main`. If it is rejected, stop and show the owner the message. No tag
     exists yet, so nothing else needs cleaning up.
   - `git tag v<version>`
   - `git push origin refs/tags/v<version>`. If it is rejected, stop and show the owner the
     message; keep the local tag. Once the owner has fixed the cause, they may ask you to
     run this one push again.

   Never retry a rejected push with other options.

10. **Report.** The pushed tag starts the `Release` workflow
    (`.github/workflows/release.yml`), which runs the tests again and creates the GitHub
    Release with the changelog section and the addon zip. Follow it with
    `GH_CONFIG_DIR=~/.config/gh gh run list --workflow release.yml --limit 1` and
    `GH_CONFIG_DIR=~/.config/gh gh run watch <run id>`. When it succeeds, report the release
    URL from `GH_CONFIG_DIR=~/.config/gh gh release view v<version> --json url -q .url`
    (it is `https://github.com/biokraft/wow-forever-companion/releases/tag/v<version>`).

    If it fails, report the run URL and the failing step to the owner. The recovery is
    `GH_CONFIG_DIR=~/.config/gh gh run rerun <run id> --failed`, run when the owner asks
    (for example after a flaky test or a network error). If the tagged code itself is
    broken, the fix ships as a new version. Never delete or move the tag, and never delete
    the release.
