# Wiki source

This directory contains the **GitHub Wiki** source for [seanebones-lang/sniper](https://github.com/seanebones-lang/sniper).

The wiki mirrors and expands on `docs/` and `README.md`, with navigation via `_Sidebar.md`.

## Pages

| File | Wiki title |
|------|------------|
| `Home.md` | Home |
| `Getting-Started.md` | Getting Started |
| `Project-Status.md` | Project Status |
| `Architecture.md` | Architecture |
| `Strategies.md` | Strategies |
| `Risk-Management.md` | Risk Management |
| `Execution-Layer.md` | Execution Layer |
| `Research-and-Backtesting.md` | Research & Backtesting |
| `Operations.md` | Operations |
| `API-Reference.md` | API Reference |
| `Environment-Variables.md` | Environment Variables |
| `UI-Guide.md` | UI Guide |
| `Screenshots.md` | Screenshots |
| `Contributing.md` | Contributing |
| `Known-Issues-and-Roadmap.md` | Known Issues & Roadmap |

Special files: `_Sidebar.md`, `_Footer.md`

## Publish to GitHub Wiki

### First time (initialize wiki)

1. On GitHub: **Settings → Features → Wikis** — ensure Wikis are enabled
2. Create the first page manually on GitHub (any title) **or** run the sync script below

### Sync script

From repo root:

```bash
./wiki/sync-to-github.sh
```

This clones `https://github.com/seanebones-lang/sniper.wiki.git`, copies all `.md` files, commits, and pushes.

Requires `git` credentials with push access to the repo.

### Manual sync

```bash
git clone https://github.com/seanebones-lang/sniper.wiki.git /tmp/sniper.wiki
cp wiki/*.md /tmp/sniper.wiki/
cd /tmp/sniper.wiki
git add -A
git commit -m "Sync wiki from main repo"
git push
```

## Keeping in sync

When updating documentation:

1. Update authoritative source in `docs/` or `wiki/` as appropriate
2. `docs/STATUS.md` is the source of truth for capability matrix — update `wiki/Project-Status.md` to match
3. Run `./wiki/sync-to-github.sh` after merging doc changes to `main`

## Wiki vs repo docs

| Location | Purpose |
|----------|---------|
| `docs/` | In-repo docs; linked from README; versioned with code |
| `wiki/` | GitHub Wiki source; better navigation for reviewers |
| `README.md` | Entry point; links to both |

Both should stay aligned on factual claims. [Project Status](Project-Status) wins on capability disagreements.
