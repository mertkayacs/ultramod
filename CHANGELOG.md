# Changelog

## 1.0.0 (2026-10-07)

Initial release.

### Mods
- hud: context bar, limits, turn time, cost, model, set badge
- receipts: files, commands, tests, cost, claim check
- guard: risky command prompts with undo snapshots
- secrets: blocks secret reads, redacts output
- tests: guards skip/focus markers and assertion drops
- notify: desktop notifications for long turns and waits
- compact: warn at 70%, offer at 85%, auto at 88% (marathon)
- loops: stops retry loops (3rd same failure, 2nd edit miss)
- pins: adds .claude/pins.md to system prompt (session scope)
- tidy: asks before new docs outside allowlist

### Sets
- essentials (default): balanced everyday work
- strict: team repos, production code
- flow: fewest interruptions
- marathon: long unattended runs
- quiet: safety only, nothing drawn

### Commands
- `/ultra`: control pane
- `/ultra set <name>`: switch set
- `/ultra sets`: list sets
- `/ultra undo [n]`: snapshots
- `/ultra allow <risk id|path>`: session allow
- `/ultra pin <text>`: add pin
- `/ultra pins`: list pins
- `/ultra reset`: drop overrides
- `/ultra doctor`: diagnostics
- `/ultra help`: this help

### Installer
- `npx ultramod`: checks version, adds marketplace, installs
- `npx ultramod uninstall`: removes plugin
- `npx ultramod doctor`: diagnostics

### Quality
- `claude plugin validate` passes
- `claude plugin test` passes (terminal + desktop)
- TypeScript strict, noUncheckedIndexedAccess
- CI on pinned Claude Code version