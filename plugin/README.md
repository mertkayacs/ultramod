# Ultra Mod

The all-in-one mod pack for Claude Code. Ten mods in one plugin: your usage limits and context window above the prompt, a guard with undo for `rm -rf` and `git reset --hard`, `.env` files and secrets kept away from the model, and a receipt under every answer that shows what really ran.

Needs Claude Code 2.1.287 or later. Type `/ultra` to open the control pane.

## The mods

- **hud**: one line above the prompt with the context bar, the 5-hour and 7-day limits with reset times, the turn timer, cost and model.
- **receipts**: a line under each answer with the files changed, commands run, tests passed or failed, time and cost. It flags a "tests pass" claim when no passing test ran after the last edit.
- **guard**: holds `rm -rf`, `git reset --hard`, force pushes, `DROP TABLE`, `terraform destroy` and similar until you say yes. In a git work tree it first tries to save a snapshot, and `/ultra undo` restores it.
- **secrets**: refuses reads of `.env`, private keys and credential files, and masks known token formats in tool output before Claude sees it.
- **tests**: asks before Claude skips a test, adds `.only`, deletes a test file or removes assertions.
- **notify**: a desktop notification when a long turn ends or Claude is waiting for you.
- **compact**: warns at 70% context and offers a one-key compaction at 85%.
- **loops**: notices the same command failing three times and tells Claude to stop and rethink.
- **pins**: keeps the rules in `.claude/pins.md` in the system prompt for the whole session.
- **tidy**: asks before Claude writes summary or notes files you did not ask for (strict set).

Five sets switch everything at once: essentials (default), strict, flow, marathon and quiet. `/ultra set strict` saves the choice for the current project.

## What it runs and what it reads

Ultra Mod makes no network requests, sends no telemetry and calls no model. It starts only these programs on your machine: `git` (snapshots and `/ultra undo`, stored under `refs/worktree/ultramod/snapshots/` in your repository), `rm -f` (or `cmd /c del` on Windows) to remove the temporary index a snapshot uses, the system notifier (`notify-send`, `osascript` or PowerShell), `uname` and `which`. It reads tool calls and tool output inside the Claude Code session to decide what to hold or mask, reads `.claude/pins.md` when that file exists, and keeps its own state in Claude Code's plugin storage. Nothing leaves your computer.

Source, issues and the full documentation: https://github.com/mertkayacs/ultramod. License: MIT.
