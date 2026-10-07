<h1 align="center">Ultra Mod</h1>

<p align="center">A mod pack for Claude Code. See context, limits and cost at a glance, stop the commands you would regret, keep secrets out of the model, and get a receipt for every turn.</p>

<p align="center">
  <a href="https://github.com/mertkayacs/ultramod/actions/workflows/ci.yml"><img src="https://github.com/mertkayacs/ultramod/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/ultramod"><img src="https://img.shields.io/npm/v/ultramod.svg" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F6B66.svg" alt="MIT"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/demo.gif" alt="Claude Code with Ultra Mod: the HUD above the prompt, a receipt under the answer, the guard holding git reset --hard, /ultra undo restoring the work, a refused .env read and the control pane" width="900"></p>

## Install

You need Claude Code 2.1.287 or later (the first release with mods).

In your shell:

```bash
claude plugin marketplace add mertkayacs/ultramod
claude plugin install ultramod@ultramod
```

Or let the installer check your version and run those two lines for you:

```bash
npx ultramod
```

Open Claude Code and type `/ultra`. The defaults work as they are; `/plugin configure ultramod@ultramod` changes the default set, the notification delay and the sound.

## What it does

| Mod | What you get | On by default |
| --- | --- | --- |
| **hud** | One line above the prompt: context bar, 5-hour and 7-day limits with reset times, turn timer, cost, model | yes |
| **receipts** | A line under each answer with what really happened: files changed, commands run, tests passed or failed, time, cost. It flags "tests pass" claims when no passing test ran after the last edit | yes |
| **guard** | Holds `rm -rf`, `git reset --hard`, force pushes, `DROP TABLE`, `terraform destroy` and similar until you say yes. Before a destructive git or rm command it snapshots your work, so `/ultra undo` can bring it back | yes |
| **secrets** | Refuses reads of `.env`, keys and credential files, and redacts tokens (GitHub, Anthropic, OpenAI, AWS, Stripe and more) from tool output before Claude sees them | yes |
| **tests** | Asks before Claude skips a test, adds `.only`, deletes a test file or removes assertions | yes |
| **notify** | A desktop notification when a long turn ends or Claude is waiting for you | yes |
| **compact** | Warns at 70% context, offers a one-key compaction at 85%, and keeps the files, failures and open claims in the summary | yes |
| **loops** | Spots the same command failing three times with the same error and tells Claude to stop and rethink | yes |
| **pins** | Keeps the rules in `.claude/pins.md` in the system prompt, so they survive long sessions and compaction | when the file exists |
| **tidy** | Asks before Claude writes new summary or notes files you did not ask for | strict set |

Ultra Mod spends no model tokens on its own. `claude plugin details ultramod` reports about 0 always-on tokens. Pins adds your pinned lines to the system prompt, and compaction runs the normal `/compact` when you ask for it.

## See it

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/clips/receipt.gif" alt="The HUD above the prompt and a receipt under the answer: 1 cmd, tests passed, 6s, cost"><br><b>HUD and receipts.</b> Limits with reset times above the prompt, and what really ran under every answer.</td>
    <td width="50%"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/clips/guard-undo.gif" alt="The guard holds git reset --hard, the user approves, and /ultra undo restores the discarded work"><br><b>Guard and undo.</b> <code>git reset --hard</code> waits for your yes, and <code>/ultra undo</code> brings the work back.</td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/clips/secrets.gif" alt="Claude tries to read .env through grep and Ultra Mod refuses it with instructions"><br><b>Secrets.</b> A read of <code>.env</code> is refused, and Claude is told what to do instead.</td>
    <td width="50%"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/clips/sets.gif" alt="The /ultra control pane switches the set from essentials to strict"><br><b>Sets.</b> The <code>/ultra</code> pane switches the whole pack, here from essentials to strict.</td>
  </tr>
</table>

## Sets

A set is a combination of mods tuned for one way of working. Switch with `/ultra set <name>`; Ultra Mod remembers the choice for each project folder.

- **essentials**: the default. Everything above except tidy.
- **strict**: for team repos and production code. Also asks before pushes to main, `npm publish` and production deploys, refuses environment dumps, and asks before new summary files.
- **flow**: fewest interruptions. A compact HUD, receipts only when something failed, no test prompts.
- **marathon**: for long unattended runs. Risky commands are refused instead of asked, you get a notification, and compaction runs by itself at 88%.
- **quiet**: safety only. Guard and secrets stay on, nothing is drawn.

Flip any single mod in the `/ultra` pane. A changed set shows as `essentials*`; `/ultra reset` puts it back.

## Commands

| Command | |
| --- | --- |
| `/ultra` | Control pane: sets, mods, last receipts, snapshots |
| `/ultra set <name>` | Switch set for this project |
| `/ultra undo [n]` | List snapshots, or restore one |
| `/ultra allow <risk or path>` | Allow one guarded command type or one secret file for this session |
| `/ultra pin <text>` and `/ultra pins` | Add a pinned rule, list them |
| `/ultra doctor` | Version, notifier, git and the active set |

## Trust

Ultra Mod makes no network requests, sends no telemetry and has no dependencies. It starts only `git`, your system notifier (`notify-send`, `osascript` or PowerShell), `uname` and `which`. Guards fail closed: if a check breaks, the command is refused. Everything else fails open: a broken HUD never blocks a tool call.

Mods run inside Claude Code with your permissions, so read before you install. `claude plugin validate` lists every event a mod hooks and every call it makes, without running it. [docs/security.md](docs/security.md) has the same list per mod.

## Where it works

The terminal CLI and the Desktop app's Code tab show everything. The VS Code chat panel, `claude -p` and the Agent SDK run the guards and receipts without drawing. Ultra Mod plays well with other mods: its row above the prompt keeps theirs.

## Uninstall

```bash
npx ultramod uninstall
```

or `claude plugin uninstall ultramod@ultramod`.

## More

[All mods in detail](docs/mods.md) · [Sets](docs/sets.md) · [Security](docs/security.md) · [FAQ](docs/faq.md) · [Contributing](CONTRIBUTING.md) · [ultramod.mertkayacs.com](https://ultramod.mertkayacs.com)

MIT license. Built by [Mert Kaya](https://mertkayacs.com).
