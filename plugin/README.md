# Ultra Mod

The best all-in-one mod pack for Claude Code. Ten mods in one plugin: your usage limits and context window above the prompt, a guard with undo for `rm -rf` and `git reset --hard`, `.env` files and secrets kept away from the model, and a receipt under every answer that shows what really ran.

Needs Claude Code 2.1.287 or later. Install it from its marketplace on GitHub, inside Claude Code:

```text
/plugin install ultramod --marketplace mertkayacs/ultramod
```

Type `/ultra` to open the control pane.

## The mods

- **hud**: one line above the prompt with the context bar, the 5-hour and 7-day limits with reset times, the turn timer, cost and model.
- **receipts**: a line under each answer with the files changed, commands run, tests passed or failed, time and cost. It flags a "tests pass" claim when no passing test ran after the last edit.
- **guard**: holds `rm -rf`, `git reset --hard`, force pushes, `DROP TABLE`, `terraform destroy` and similar until you say yes. In a git work tree it first tries to save a snapshot, and `/ultra undo` restores it.
- **secrets**: refuses reads of `.env`, private keys and credential files, and masks known token formats in tool output before Claude sees it.
- **tests**: asks before Claude skips a test, adds `.only`, deletes a test file or removes assertions.
- **notify**: a desktop notification when a long turn ends or Claude is waiting for you.
- **compact**: warns at 70% context and offers a one-key compaction at 85%.
- **loops**: notices the same command failing three times and tells Claude to stop and rethink.
- **pins**: keeps the rules in `~/.claude/pins.md`, and in the project's `.claude/pins.md` once you approve it, in the system prompt for the whole session.
- **tidy**: asks before Claude writes summary or notes files you did not ask for (strict set).

Five sets switch everything at once: essentials (default), strict, flow, marathon and quiet. `/ultra set strict` saves the choice for the current project.

## What each hook decides, and when

All hooks are declared and registered in `hooks/register.tsx`, one `on(...)` line each. The mods in `hooks/mods/` only compute values (a refusal text, a line, a masked row); the hook in `register.tsx` turns that value into its answer. A mod that is off in the current set is skipped.

| Hook | When it runs | What it decides |
|---|---|---|
| `session.start` | a session starts | nothing: starts the HUD over, reads the project's set and registers `/ultra`, then passes the event on unchanged |
| `classic.SessionStart` | a conversation is cleared, resumed or forked | nothing: the same as above, and clears this session's receipts and context warnings, then passes the event on unchanged |
| `turn.start` | a turn starts | nothing: starts the turn timer and the receipt, then passes the event on unchanged |
| `turn.complete` | a turn ends | whether a receipt line goes under the answer (receipts), whether to show a context warning (compact), whether to send a "finished" notification (notify) |
| `session.end` | a session ends | nothing: stops the HUD timer, then passes the event on unchanged |
| `command.run` on `/ultra` | you type `/ultra ...` | what `/ultra` prints; this hook answers only `/ultra`, the command this plugin registers, and no other command |
| `ui.render` on the band above the prompt and on the Ultra Mod pane | Claude Code draws those two places | what the HUD row and the pane show; everything the plugins beneath draw is kept |
| `tool.call` on Bash, Read, Edit, MultiEdit, Write, NotebookEdit, Grep and Glob | before one of those tool calls runs | whether to refuse the call. guard asks you about a risky shell command (or refuses it in the marathon set), secrets refuses a read of a secret file, tests asks before an edit weakens a test, tidy asks before a new notes file (strict set). The hook returns `next(e)` to let the call run, or `{ deny: reason }` to refuse it. If the check itself fails, the call is refused |
| `tool.call` on every tool | around a call the check let through | nothing about the call itself, which always runs: it counts the call for the receipt and the HUD, and adds one line for Claude after the same failure repeats (loops) |
| `session.append` | a tool result is about to be stored in the conversation | whether the result holds a known token format to mask (secrets) |
| `prompt.compose` | Claude Code builds the system prompt | whether `.claude/pins.md` has rules to add (pins) |
| `classic.Notification` | Claude Code says it is waiting for you | whether to send a desktop notification (notify), then passes the event on unchanged |

Ultra Mod has no permission hook: it registers no `tool.check` hook, answers no permission check and never answers allow. Claude Code's own permission prompt can still follow an Ultra Mod question about the same call. No hook changes Claude Code's permission settings, its default permission mode, Remote Control, agents, configuration or any settings file. The plugin adds one slash command, `/ultra`, and no tools and no agents.

## What the hooks change

- A refused tool call: Claude reads the refusal reason, for example "The user declined `git reset --hard`. It discards uncommitted changes."
- loops: after the same Bash command fails three times with the same error, or Edit misses `old_string` twice on one file, one sentence is added to that tool result for Claude: stop retrying and rethink. In the flow set it shows a toast instead.
- secrets: in a tool result about to be stored, known token formats (GitHub, Anthropic, OpenAI, AWS, Stripe and others) become a marker such as `[redacted:github]`. The same masking runs on refusal text and added lines that other plugins beneath return for a tool call. Your own prompt and Claude's reply are stored as typed.
- receipts: one line under the answer, after any line a plugin beneath already added.
- pins: one section with the lines of `.claude/pins.md` added after the other system prompt sections.
- hud and compact: rows drawn above the prompt, above what other plugins draw there. compact can add a Compact now button.
- `/ultra`: the control pane and the text `/ultra` prints.

## What it sends, and where

Nothing leaves your computer. Ultra Mod contacts no host, opens no network connection, sends no telemetry and calls no model.

The only text it hands to another program is the desktop notification, which goes to the notifier on your own computer: the project folder name and a short reason, such as "my-app needs you: guard: run `git reset --hard`?" or "my-app finished in 2m10s". A command quoted there has known token formats masked first and is cut at 120 characters. It goes out through Claude Code's `$.process.run` call, which starts one program on your computer with the arguments listed below, waits for it to exit and returns its exit code and output; that program shows the notification and exits. A soft chime plays through Claude Code's `$.audio.play` when notification sounds are on.

The one exception you choose yourself: in the marathon set, compact asks Claude Code to compact the conversation at 88% context through `$.session.compact`. That is Claude Code's own `/compact`, which sends the conversation to your model as `/compact` always does.

## Hosts it contacts

None.

## Commands it runs, and why

Every program starts through `$.process.run` with an argument list; no shell reads any of it.

- `git`, in the repository you work in, for guard's snapshots and `/ultra undo`:
  - `git rev-parse --is-inside-work-tree`, `git rev-parse --show-toplevel`, `git rev-parse --git-path ultramod-index-<id>`, `git rev-parse --verify HEAD`: find the repository, its root and the current commit.
  - `git rev-parse --show-prefix`, only for a risky command whose paths climb above the session directory (`git -C .. reset --hard`): find where the session sits in the work tree, so a path that stays inside the repository still gets a snapshot.
  - `git add -A` and `git write-tree`, with `GIT_INDEX_FILE` set to a temporary index of its own, `ultramod-index-<id>`: record the work tree as it is, without touching your own index.
  - `git commit-tree <tree> [-p <HEAD>] -m "ultramod snapshot: <command>"` with the author and committer "Ultra Mod <ultramod@localhost>", then `git update-ref refs/worktree/ultramod/snapshots/<time> <commit>`: keep the snapshot as a ref. `git for-each-ref` lists them and `git update-ref -d` drops the oldest past 20.
  - `/ultra undo <n>`, after you confirm: `git rev-parse --git-path ultramod-restore-index-<id>`, `git add -A`, `git ls-files`, `git ls-tree -r --name-only --full-tree <snapshot>`, `git read-tree <snapshot>` and `git checkout-index --all --force`, all on a temporary index of its own, `ultramod-restore-index-<id>`, write the snapshot's files back into the work tree.
  - `git --version`, for `/ultra doctor`.
  - It never pushes, fetches, commits on a branch, or changes your branch, your index or your history.
- `rm -f <git dir>/ultramod-index` (or `ultramod-restore-index`) on Linux and macOS: remove the temporary index right after use. On Windows the same file is removed by the script this plugin ships, `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <plugin>\scripts\remove-index.ps1 -Path <git dir>\ultramod-index`, which removes those two file names and nothing else.
- `uname -s` and `which notify-send` or `which osascript`: find the desktop notifier.
- The notifier, when a long turn ends, when Claude Code waits for you, or while guard or tests holds a call for your answer:
  - Linux: `notify-send "Claude Code" <message>`
  - macOS: `osascript <plugin>/scripts/notify.applescript "Claude Code" <message>`
  - Windows and WSL: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <plugin>\scripts\notify.ps1 -BodyBase64 <message as base64>`; under WSL, `wslpath -w <plugin>/scripts/notify.ps1` converts the script path first.

The three scripts ship in this plugin's `scripts/` folder. They take their text as arguments and never run it.

## Files it writes

- `.claude/pins.md` at the root of the current project, only when you run `/ultra pin <text>`, which appends one line. This is an instructions file: pins adds its lines to the system prompt, for a project file only after you approve it with `/ultra pins approve`. Ultra Mod writes no other instructions file and no build, start-up or settings file.
- Git refs under `refs/worktree/ultramod/snapshots/` in the repository you work in, when guard saves a snapshot before a risky command it lets through.
- The temporary index files `ultramod-index` and `ultramod-restore-index` in that repository's git directory, removed right after use.
- The files of a snapshot, written back into your work tree, only when you run `/ultra undo <n>` and confirm.
- Its own state (the chosen set, this session's allowances, receipt history, the HUD's turn counters) in Claude Code's plugin storage.

## What it reads on your machine

- Environment variables: `OS` and `WSL_DISTRO_NAME`, to tell Windows and WSL apart from Linux and macOS for the notifier and the temporary index cleanup; `HOME`, or `USERPROFILE` where `HOME` is unset, to find your personal pins file `~/.claude/pins.md`. These are locations and platform names. Ultra Mod reads no credential, token or key from your machine, and it needs none, so it has no sensitive `user_config` option.
- Files: `.claude/pins.md` in the project and `~/.claude/pins.md`, when they exist; a test file before an edit to it, to compare the two (tests); whether a file exists before tidy asks about a new notes file.
- Tool calls and tool results inside the Claude Code session, to decide what to hold, count or mask.

None of what it reads from files goes into a command it runs. The contents of `pins.md` go only into the system prompt; a test file is only compared with the edit, and only the kind of change found (such as "adds .skip(" or "removes 2 assertions") with the file's path appears in the question, the refusal and the notification. The values passed to `$.process.run` are the fixed commands listed above, plus these computed values: paths and refs inside your repository (the git directory, the snapshot's tree and commit ids, the snapshot ref name), the snapshot message "ultramod snapshot: <command>" with known token formats masked, the plugin's own script paths, and the notification text described under "What it sends, and where".

Its options (`/plugin` settings) are the default set, the notification threshold in seconds and whether notifications play a sound.

Source, issues and the full documentation: https://github.com/mertkayacs/ultramod. License: MIT.
