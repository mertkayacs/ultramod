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

## What each mod hooks, decides and changes

Every mod is a function hook in this plugin's own folder. `hooks/register.tsx` registers each event once with `on(event, hook)` and hands it to the mods in `hooks/mods/` (the order is set in `hooks/mods/index.ts`). A hook either passes the event on unchanged or answers it as described here. No mod answers a permission check; Claude Code's own permission prompts work as you set them. No hook changes Claude Code's permission settings, its default permission mode, Remote Control, agents or settings files.

- **guard** (`tool.call` on Bash, `tool.check`): reads the command Claude wants to run. For a risky command (recursive `rm` outside build folders, `git reset --hard`, `git clean`, force pushes, `DROP TABLE` or `DELETE` without `WHERE`, `terraform destroy`, `kubectl delete` and similar) it asks you first, or refuses it in the marathon set. Every other command passes on unchanged.
- **secrets** (`tool.call` on Read, Edit, Write, MultiEdit, NotebookEdit, Grep, Glob and Bash; `session.append`): refuses reads of `.env`, private keys and credential files, and shell commands that would print them. Before a tool result is stored in the conversation, it replaces known token formats (GitHub, Anthropic, OpenAI, AWS, Stripe and others) with a marker such as `[redacted:github]`. That replacement is the only change it makes to what Claude sees.
- **tests** (`tool.call` on Edit, MultiEdit, Write, NotebookEdit and Bash): asks you before an edit skips a test, adds `.only`, deletes a test file or removes assertions. Everything else passes on unchanged.
- **tidy** (`tool.call` on Write, strict set only): asks you before Claude writes a new summary or notes file outside an allowlist.
- **pins** (`prompt.compose`): adds the lines of `.claude/pins.md` (at most 30 lines and 3,000 characters) to the system prompt while that file exists.
- **loops** (`tool.call` on Bash and Edit): after the same command fails three times with the same error, adds one short message telling Claude to stop and rethink. It never blocks a call.
- **compact** (`classic.SessionStart`, `turn.complete`, `ui.render`): shows a context warning above the prompt and a Compact now button; in the marathon set it runs Claude Code's own `/compact` at 88%.
- **receipts** (`session.start`, `session.end`, `classic.SessionStart`, `turn.start`, `tool.call`, `turn.complete`): counts files changed, commands run and tests passed, and prints one line under each answer. It changes nothing.
- **hud** (`ui.render`): draws one line above the prompt. It changes nothing.
- **notify** (`turn.complete`, `classic.Notification`): shows a desktop notification when a long turn ends or Claude waits for you.

## Programs it runs, and why

- `git`, for snapshots and `/ultra undo` in the repository you work in: `rev-parse`, `add -A` and `write-tree` on a temporary index, `commit-tree`, `update-ref`, `for-each-ref`, `ls-files`, `ls-tree`, `read-tree`, `checkout-index`, and `git --version` for `/ultra doctor`. It never pushes, fetches or changes your branch, index or history.
- `rm -f` (Linux, macOS) or `cmd /c del /f /q` (Windows), with one fixed path: the snapshot's temporary index file under `.git`.
- `uname -s` and `which`, to find the desktop notifier.
- `notify-send "Claude Code" <message>` on Linux, `osascript scripts/notify.applescript "Claude Code" <message>` on macOS, and `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\notify.ps1 -BodyBase64 <message>` on Windows; under WSL, `wslpath -w` first converts the script path. Both scripts ship in this plugin's `scripts/` folder. The message is the project folder name and a short reason, such as "my-app needs you: guard: git reset --hard".

## Files it writes

- `.claude/pins.md` in the current project, only when you run `/ultra pin <text>`. This is an instructions file: pins adds its lines to the system prompt. Ultra Mod writes no other build, start-up, settings or instructions file.
- Git refs under `refs/worktree/ultramod/snapshots/` and a temporary index file `.git/ultramod-index` (removed right after), inside the repository you work in, when guard saves a snapshot.
- Its own state (the chosen set, session allowances, receipt history) in Claude Code's plugin storage.

## What it reads from your machine

Environment variables `OS` and `WSL_DISTRO_NAME` (to pick the notifier), `HOME` and `USERPROFILE` (to find `~/.claude/pins.md`). These are not credentials, and none of them leave your computer. It reads test files to compare an edit with the file it changes, and checks whether a file exists before tidy asks about it.

## Network

None. Ultra Mod contacts no host, sends no telemetry and calls no model. Nothing it reads leaves your computer.

Source, issues and the full documentation: https://github.com/mertkayacs/ultramod. License: MIT.
