<h1 align="center">Ultra Mod</h1>

<p align="center"><b>The all-in-one mod pack for Claude Code.</b> Ten mods in one install: your usage limits and context window above the prompt, a guard with undo for <code>rm -rf</code> and <code>git reset --hard</code>, <code>.env</code> files kept away from the model, and a receipt under every answer that shows what really ran.</p>

<p align="center">
  <a href="https://github.com/mertkayacs/ultramod/actions/workflows/ci.yml"><img src="https://github.com/mertkayacs/ultramod/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/ultramod"><img src="https://img.shields.io/npm/v/ultramod.svg" alt="npm"></a>
  <a href="https://ultramod.mertkayacs.com"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fultramod.mertkayacs.com%2Fdownloads.json" alt="downloads on all platforms"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F6B66.svg" alt="MIT"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/trailer-hero.gif" alt="Ultra Mod in Claude Code: limits and context above the prompt, a receipt under the answer, the guard holding git reset --hard and /ultra undo bringing the work back" width="900"></p>

## Install

You need Claude Code 2.1.287 or later (the first release with mods).

Ultra Mod installs from its own marketplace on GitHub. Inside Claude Code, one command adds the marketplace and installs the plugin:

```text
/plugin install ultramod --marketplace mertkayacs/ultramod
```

From your shell, the same in one line:

```bash
claude plugin install ultramod --marketplace mertkayacs/ultramod
```

Or in two steps, which also works on older 2.1.28x releases:

```bash
claude plugin marketplace add mertkayacs/ultramod
claude plugin install ultramod@ultramod
```

The npm installer checks your Claude Code version and runs those steps for you:

```bash
npx ultramod
```

Open Claude Code and type `/ultra`. The defaults work as they are; `/plugin configure ultramod@ultramod` changes the default set, the notification delay and the sound.

**`Plugin "ultramod" not found in any configured marketplace`?** Claude Code searches only the marketplaces you have added, and Ultra Mod is not in Anthropic's built-in directory yet. Add the marketplace with one of the commands above and install again.

## Why Ultra Mod

Most Claude Code setups grow the same pile of extras: a status line script for usage limits, a hook or two against `rm -rf`, something to keep `.env` out of reach, and the habit of scrolling back to check whether the tests really ran. Ultra Mod puts all of that in one plugin, built on the mods API that Claude Code shipped in 2.1.287. It never calls a model itself, and you can switch any mod off from the `/ultra` pane.

## What it does

| Mod | What you get | On by default |
| --- | --- | --- |
| **hud** | One line above the prompt: context bar, 5-hour and 7-day limits with reset times, turn timer, cost, model | yes |
| **receipts** | A line under each answer with what really happened: files changed, commands run, tests passed or failed, time, cost. It flags "tests pass" claims when no passing test ran after the last edit. A test piped into another command or followed by `;` or `\|\|` does not count, because the exit code can hide a failure | yes |
| **guard** | Holds `rm -rf`, `git reset --hard`, force pushes, `DROP TABLE`, `terraform destroy` and similar until you say yes. Before a destructive git or rm command in a git work tree it tries to save a snapshot, so `/ultra undo` has something to restore. Snapshots are best effort: a failed one is logged and does not block the command | yes |
| **secrets** | Refuses reads of `.env`, keys and credential files, and redacts tokens (GitHub, Anthropic, OpenAI, AWS, Stripe and more) from tool output before Claude sees them | yes |
| **tests** | Asks before Claude skips a test, adds `.only`, deletes a test file or removes assertions | yes |
| **notify** | A desktop notification when a long turn ends or Claude is waiting for you | yes |
| **compact** | Warns at 70% context, offers a one-key compaction at 85%, and keeps the files, failures and open claims in the summary | yes |
| **loops** | Spots the same command failing three times with the same error and tells Claude to stop and rethink | yes |
| **pins** | Keeps the rules in `.claude/pins.md` in the system prompt, so they survive long sessions and compaction | when the file exists |
| **tidy** | Asks before Claude writes new summary or notes files you did not ask for | strict set |

Ultra Mod calls no model itself, and `claude plugin details ultramod` reports about 0 always-on tokens. It still adds some text to what Claude reads: the lines of `.claude/pins.md` (at most 30 lines and 3,000 characters) go into the system prompt of every request while the file exists, and a refusal or a loop nudge is a short message in the conversation. Compaction runs the normal `/compact`, from the Compact now button or, in the marathon set, by itself at 88%.

## See it

One real session, start to finish:

<p align="center"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/demo.gif" alt="Claude Code with Ultra Mod: the HUD above the prompt, a receipt under the answer, the guard holding git reset --hard, /ultra undo restoring the work, a refused .env read and the control pane" width="900"></p>

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/clips/receipt.gif" alt="The HUD above the prompt and a receipt under the answer: 1 cmd, tests passed, 6s, cost"><br><b>HUD and receipts.</b> Limits with reset times above the prompt, and what really ran under every answer.</td>
    <td width="50%"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/clips/guard-undo.gif" alt="The guard holds git reset --hard, the user approves, and /ultra undo restores the discarded work"><br><b>Guard and undo.</b> <code>git reset --hard</code> waits for your yes, and <code>/ultra undo</code> brings the work back from the snapshot taken first.</td>
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
