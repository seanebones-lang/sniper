#!/usr/bin/env bash
# Sync wiki/*.md to GitHub Wiki repository.
# Usage: ./wiki/sync-to-github.sh
set -euo pipefail

REPO="${GITHUB_REPO:-seanebones-lang/sniper}"
WIKI_URL="https://github.com/${REPO}.wiki.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "→ Cloning wiki from ${WIKI_URL}..."
if git clone "$WIKI_URL" "$WORK_DIR" 2>/dev/null; then
  echo "  Wiki repo exists."
else
  echo "  Wiki repo not found — initializing..."
  mkdir -p "$WORK_DIR"
  cd "$WORK_DIR"
  git init
  git remote add origin "$WIKI_URL"
  cd - >/dev/null
fi

echo "→ Copying markdown files..."
cp "$SCRIPT_DIR"/*.md "$WORK_DIR/"
# Exclude wiki/README.md (internal instructions, not a wiki page)
rm -f "$WORK_DIR/README.md"

cd "$WORK_DIR"
git add -A

if git diff --staged --quiet; then
  echo "✓ Wiki is already up to date."
  exit 0
fi

git commit -m "Sync wiki from main repo ($(date -u +%Y-%m-%d))"
echo "→ Pushing to ${WIKI_URL}..."
if ! git push -u origin HEAD:master 2>/dev/null && ! git push -u origin HEAD:main 2>/dev/null; then
  echo ""
  echo "✗ Push failed. The GitHub Wiki git repo may not exist yet."
  echo "  1. Go to https://github.com/${REPO}/wiki"
  echo "  2. Click 'Create the first page' and save any content"
  echo "  3. Re-run: ./wiki/sync-to-github.sh"
  exit 1
fi

echo "✓ Wiki synced. View at: https://github.com/${REPO}/wiki"
