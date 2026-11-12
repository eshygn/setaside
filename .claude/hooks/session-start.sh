#!/bin/bash
# Runs when a Claude Code session starts in this repo: commit as the project owner, unsigned.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
git config user.name "Nisaar"
git config user.email "120457154+eshygn@users.noreply.github.com"
git config commit.gpgsign false
