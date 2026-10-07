# Sets reference

A set is a named combination of mod modes. Switch with `/ultra set <name>`. The choice is saved per project in `$.store`. Override any mod in the control pane; the set shows as `essentials*` when customised. `/ultra reset` drops overrides.

## essentials (default)

For everyday work. Balanced: visible context, receipts when tools run, asks before risky commands and test weakening, secrets on, notifications with chime, compact warns and offers, loops nudges, pins if file exists, tidy off.

| Mod | Mode | Notes |
|-----|------|-------|
| hud | full | All segments |
| receipts | tools | Receipt when turn used a tool |
| guard | ask | Asks before risky commands |
| secrets | on | Blocks secret reads, redacts output |
| tests | ask | Asks before skip/focus/assertion drop |
| notify | on, chime | 30s threshold, soft sound |
| compact | warn+offer | Warn at 70%, offer at 85% |
| loops | nudge | Adds context line on 3rd same failure |
| pins | if file | Adds system prompt section when pins.md exists |
| tidy | off | No restriction on new docs |

## strict

For team repos and production code. Receipts always, strict risk table (adds force-with-lease, protected push, publish, deploy), strict secrets (refuses bare env/printenv), tidy asks.

| Mod | Mode | Notes |
|-----|------|-------|
| hud | full | |
| receipts | always | Every main-loop turn |
| guard | ask, strict table | Extra risk ids: git-push-force-with-lease, git-push-protected, npm-publish, gh-release, deploy-prod |
| secrets | strict | Also refuses `env`, `printenv`, `set`, `export -p` with no args |
| tests | ask | |
| notify | on, no chime | |
| compact | warn+offer | |
| loops | nudge | |
| pins | if file | |
| tidy | ask | Asks before new docs outside allowlist |

## flow

For fewest interruptions. Compact HUD (context + limits only), receipts only on issues, tests off, no chime, compact warn only, loops warn only.

| Mod | Mode | Notes |
|-----|------|-------|
| hud | compact | Context + limits only |
| receipts | issues | Only when something failed or claim unverified |
| guard | ask | |
| secrets | on | |
| tests | off | No guard on test edits |
| notify | on, no chime | |
| compact | warn | Warn at 70%, no offer button |
| loops | warn | Toast only, no context nudge |
| pins | if file | |
| tidy | off | |

## marathon

For long unattended runs. Guard denies with notify, tests deny, compact auto at 88%, tidy denies.

| Mod | Mode | Notes |
|-----|------|-------|
| hud | full | |
| receipts | tools | |
| guard | deny + notify | Refuses risky commands, explains, sends notification |
| secrets | on | |
| tests | deny | Refuses test weakening with fixed text |
| notify | on, no chime | |
| compact | auto | Warn at 70%, offer at 85%, auto compact at 88% |
| loops | nudge | |
| pins | if file | |
| tidy | deny | Refuses new docs outside allowlist |

## quiet

Safety only, nothing drawn. HUD off, receipts off, tests off, notify off, compact off, loops off.

| Mod | Mode | Notes |
|-----|------|-------|
| hud | off | No band drawn |
| receipts | off | No receipt lines |
| guard | ask | Still asks on risky commands |
| secrets | on | Still blocks and redacts |
| tests | off | |
| notify | off | No notifications |
| compact | off | No warnings, no button |
| loops | off | No loop detection |
| pins | if file | |
| tidy | off | |

## Per-project memory

The active set and any overrides are saved in `$.store` under `project:<root>` where `<root>` is `$.session.root()`. The `userConfig.set` (default `essentials`) is the default for every other project.

When you open the control pane (`/ultra`) and flip a mod toggle, the set becomes customised and shows as `<set>*` (e.g. `essentials*`). The overrides are saved per project. `/ultra reset` drops the overrides and restores the set's defaults.