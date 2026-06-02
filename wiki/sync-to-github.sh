#!/usr/bin/env bash
#
# Sync wiki/ content to the GitHub Wiki repository.
#
# Usage:
#   ./wiki/sync-to-github.sh
#
# This script assumes you have push access to the wiki repo:
#   git@github.com:seanebones-lang/sniper.wiki.git
#
# It is recommended to run this from the root of the main repo.

set -e

WIKI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$WIKI_DIR/.." && pwd)"
WIKI_REPO_URL="git@github.com:seanebones-lang/sniper.wiki.git"
TEMP_WIKI_DIR="/tmp/sniper-wiki-$$"

echo "=== Sniper Wiki Sync ==="

if [ ! -d "$WIKI_DIR" ]; then
  echo "Error: wiki/ directory not found."
  exit 1
fi

echo "Cloning wiki repository..."
rm -rf "$TEMP_WIKI_DIR"
git clone "$WIKI_REPO_URL" "$TEMP_WIKI_DIR"

echo "Copying wiki content..."
cp -r "$WIKI_DIR"/*.md "$TEMP_WIKI_DIR"/ 2>/dev/null || true

cd "$TEMP_WIKI_DIR"

if [ -z "$(git status --porcelain)" ]; then
  echo "No changes to sync."
  rm -rf "$TEMP_WIKI_DIR"
  exit 0
fi

echo "Committing changes..."
git add -A
git commit -m "Sync wiki from main repo ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

echo "Pushing to GitHub Wiki..."
git push origin master || git push origin main

echo "Sync complete."
rm -rf "$TEMP_WIKI_DIR"