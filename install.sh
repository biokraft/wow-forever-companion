#!/bin/sh
# Forever Companion installer for macOS and Linux. Paste this line into a terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/biokraft/wow-forever-companion/main/install.sh | sh
#
# It checks for Node.js, puts Forever Companion into ~/wow-forever-companion and starts
# setup, which asks the rest. Running it again updates what is there.
#
#   FC_DIR=/some/folder   install into another folder
#   FC_NO_GIT=1           download the files even when git is installed
#   ... | sh -s -- --yes  options after `--` go to setup (see docs/SETUP.md)
#
# Everything runs inside main, so a download that stops half-way runs nothing.
set -eu

REPO_URL=https://github.com/biokraft/wow-forever-companion
NODE_MIN=22

say() { printf '%s\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# The script itself arrives on stdin (curl | sh), so questions are read from the terminal.
can_ask() { [ -t 0 ] || (: </dev/tty) 2>/dev/null; }
confirm() {
  can_ask || return 1
  printf '%s [Y/n] ' "$1"
  if [ -t 0 ]; then read -r answer; else read -r answer </dev/tty; fi
  case "$answer" in ''|y|Y|yes|Yes) return 0 ;; *) return 1 ;; esac
}

node_ok() {
  have node || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$major" -ge "$NODE_MIN" ] 2>/dev/null
}

need_node() {
  if node_ok; then return; fi
  if have node; then say "Node.js $(node --version 2>/dev/null) is too old: Forever Companion needs $NODE_MIN or newer."
  else say "Node.js is not installed: Forever Companion needs version $NODE_MIN or newer."
  fi
  if have brew && confirm 'Install it with Homebrew now?'; then
    brew install node || brew upgrade node
    hash -r 2>/dev/null || true
    if node_ok; then return; fi
  fi
  fail "Install Node.js: open https://nodejs.org, download the LTS installer and click through it.
Then open a new terminal window and paste the install line again."
}

# On a Mac without Apple's command line tools, /usr/bin/git only opens an install dialog.
git_usable() {
  [ -z "${FC_NO_GIT:-}" ] || return 1
  have git || return 1
  if [ "$(uname -s)" = Darwin ] && [ "$(command -v git)" = /usr/bin/git ]; then
    xcode-select -p >/dev/null 2>&1 || return 1
  fi
}

download_code() {
  have curl || fail 'curl is missing, so the files cannot be downloaded.'
  have tar || fail 'tar is missing, so the download cannot be unpacked.'
  tmp=$(mktemp -d)
  if curl -fsSL -o "$tmp/forever-companion.tar.gz" "$REPO_URL/archive/refs/heads/main.tar.gz" \
    && mkdir -p "$DIR" \
    && tar -xzf "$tmp/forever-companion.tar.gz" -C "$DIR" --strip-components 1; then
    rm -rf "$tmp"
  else
    # The folder was missing or empty before (get_code checked), so nothing of the player's goes.
    rm -rf "$tmp" "$DIR"
    fail "The download from GitHub failed. Check your internet connection and paste the install line again."
  fi
}

get_code() {
  if [ -f "$DIR/bin/wowf" ]; then
    say "Forever Companion is already in $DIR. Updating it..."
    (cd "$DIR" && node bin/wowf update) || say 'The update did not finish (see above). Going on with the version that is there.'
  elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    fail "$DIR exists and holds something else. Move it away, or set FC_DIR to another folder
and paste the install line again."
  elif git_usable; then
    say "Getting Forever Companion with git into $DIR..."
    git clone "$REPO_URL.git" "$DIR"
  else
    say "Downloading Forever Companion into $DIR..."
    download_code
  fi
}

wants_yes() {
  for arg in "$@"; do [ "$arg" = --yes ] && return 0; done
  return 1
}

run_setup() {
  cd "$DIR"
  if [ -t 0 ] || wants_yes "$@"; then
    node bin/wowf setup "$@"
  elif can_ask; then
    node bin/wowf setup "$@" </dev/tty
  else
    say "Forever Companion is in $DIR. Setup asks a few questions, so run it in a terminal:
  cd \"$DIR\" && node bin/wowf setup"
  fi
}

main() {
  DIR=${FC_DIR:-$HOME/wow-forever-companion}
  need_node
  get_code
  run_setup "$@"
}

main "$@"
