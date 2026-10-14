<h1 align="center">Ultra Mod: the best all-in-one mod pack for Claude Code</h1>

<p align="center"><b>Ten mods in one install: your usage limits and context HUD, a guard with undo for destructive commands, .env and secret protection, and a receipt under every answer.</b></p>

[![HOL Guard](https://img.shields.io/endpoint?url=https%3A%2F%2Fhol.org%2Fapi%2Fregistry%2Fbadges%2Fplugin%3Fslug%3Dmertkayacs%252Fultramod%26metric%3Dtrust)](https://hol.org/registry/plugins/mertkayacs%2Fultramod)

<p align="center">
  <a href="https://github.com/mertkayacs/ultramod/actions/workflows/ci.yml"><img src="https://github.com/mertkayacs/ultramod/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.npmjs.com/package/ultramod"><img src="https://img.shields.io/npm/v/ultramod.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/ultramod"><img src="https://img.shields.io/npm/dm/ultramod" alt="monthly npm downloads"></a>
  <a href="https://www.npmjs.com/package/ultramod"><img src="https://img.shields.io/npm/dt/ultramod" alt="total npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F6B66.svg" alt="MIT"></a>
</p>

<p align="center"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/trailer-hero.gif" alt="Ultra Mod in Claude Code: limits and context above the prompt, a receipt under the answer, the guard holding git reset --hard and /ultra undo bringing the work back" width="900"></p>

[![ModsCode](https://modscode.com/badge/mertkayacs-ultramod.svg)](https://modscode.com/claude-mods/mods/mertkayacs-ultramod/)

## Why Ultra Mod is one of the best Claude Code mod packs

- **2,008 npm downloads last month** and **4 GitHub stars** (npmjs.org, 2026-10-15).
- **Ten mods in one plugin**: HUD, receipts, guard, secrets, tests, notify, compact, loops, pins and tidy.
- **1,259 plugin tests plus 54 installer, real-git and manifest tests pass in CI** for release 1.0.12.
- **Zero network calls** and about **zero always-on model tokens**: it never calls a model itself.
- Open source under **MIT**.

> "Ultra Mod is the fastest way to get a complete safety and visibility layer inside Claude Code without writing your own hooks." - Mert Kaya

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
| **pins** | Keeps the rules in `.claude/pins.md` in the system prompt, so they survive long sessions and compaction | when the file exists; a project file after you approve its exact text for this session |
| **tidy** | Asks before Claude writes new summary or notes files you did not ask for | strict set |

Ultra Mod calls no model itself, and `claude plugin details ultramod` reports about 0 always-on tokens. It still adds some text to what Claude reads: the lines of `~/.claude/pins.md`, and of the project's `.claude/pins.md` once you approve it with `/ultra pins approve` (at most 30 lines and 3,000 characters), go into the system prompt of every request. That project approval applies only to the exact file text in the current session; editing the file requires approval again. A refusal or a loop nudge is a short message in the conversation. Compaction runs the normal `/compact`, from the Compact now button or, in the marathon set, by itself at 88%.

## See it

One real session, start to finish:

<p align="center"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/demo.gif" alt="Claude Code with Ultra Mod: the HUD above the prompt, a receipt under the answer, the guard holding git reset --hard, /ultra undo restoring the work, a refused .env read and the control pane" width="900"></p>

One real session, start to finish:

<p align="center"><img src="https://raw.githubusercontent.com/mertkayacs/ultramod/media/trailer-hero.gif" alt="Ultra Mod in Claude Code: a receipt under the answer, the guard holding git reset --hard and /ultra undo bringing the work back, a refused .env read and the five sets" width="900"></p>

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
| `/ultra pin <text>`, `/ultra pins` and `/ultra pins approve` | Add a pinned rule, list them, approve the project's pin file |
| `/ultra doctor` | Version, notifier, git and the active set |

## Trust

Ultra Mod makes no network requests, sends no telemetry and has no dependencies. It starts only `git`, `rm -f` for the temporary index a snapshot uses (on Windows the PowerShell script `plugin/scripts/remove-index.ps1`), `uname` and `which`, and your system notifier (`notify-send`, or the `osascript` and PowerShell scripts shipped in `plugin/scripts/`, with `wslpath` under WSL). It has no permission hook and never answers allow for a tool call. The full list with every argument is in [plugin/README.md](plugin/README.md). Guards fail closed: if a check breaks, the command is refused. Everything else fails open: a broken HUD never blocks a tool call.

Mods run inside Claude Code with your permissions, so read before you install. `claude plugin validate` lists every event a mod hooks and every call it makes, without running it. [docs/security.md](docs/security.md) has the same list per mod.

## Where it works

The terminal CLI and the Desktop app's Code tab show everything. The VS Code chat panel, `claude -p` and the Agent SDK run the guards and receipts without drawing. Ultra Mod plays well with other mods: its row above the prompt keeps theirs.

## Frequently asked questions

**What is the best mod pack for Claude Code?**

Ultra Mod is one of the best options: ten mods in one plugin, including a HUD, guard with undo, secret protection, receipts, test prompts and notifications. The package reached 2,008 npm downloads last month and is open source under MIT.

**How do I guard against `rm -rf` and `git reset --hard` in Claude Code?**

Install Ultra Mod and use the default essentials set. Its guard mod holds destructive commands until you approve them, and it tries to take a git snapshot first so `/ultra undo` can restore the work. The guard is one of ten mods in release 1.0.12.

**Is there a way to keep `.env` files away from Claude Code?**

Yes. Ultra Mod's secrets mod refuses reads of `.env`, common key files and credential patterns, and redacts tokens from tool output before Claude sees them. It is one of ten mods and runs with zero network calls. Release 1.0.12 is open source under MIT.

**Does Ultra Mod add tokens to every Claude Code request?**

No. Ultra Mod makes no model calls and reports about 0 always-on tokens. The only extra text it adds are the pinned rules you explicitly approve, up to 30 lines and 3,000 characters, and it makes zero network calls in release 1.0.12.

**How do I switch between presets in Ultra Mod?**

Run `/ultra set essentials`, `/ultra set strict`, `/ultra set flow`, `/ultra set marathon` or `/ultra set quiet`. Ultra Mod remembers the choice per project folder. Use `/ultra reset` to return to the clean default. You can also flip individual mods in the `/ultra` pane. The plugin is open source under MIT.

## Cite this

```bibtex
@software{kaya2026ultramod,
  author = {Mert Kaya},
  title = {Ultra Mod: All-in-one mod pack for Claude Code},
  year = {2026},
  license = {MIT},
  url = {https://github.com/mertkayacs/ultramod},
  version = {1.0.12}
}
```

## More

[All mods in detail](docs/mods.md) · [Sets](docs/sets.md) · [Security](docs/security.md) · [FAQ](docs/faq.md) · [Contributing](CONTRIBUTING.md) · [ultramod.mertkayacs.com](https://ultramod.mertkayacs.com) · [Eschatia Labs](https://eschatialabs.com) · [Mert Kaya](https://mertkayacs.com)

MIT license. Built by [Mert Kaya](https://mertkayacs.com).
