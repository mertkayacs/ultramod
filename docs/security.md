# Security reference

`claude plugin validate ./plugin` reports every event a mod hooks and every `$` call it makes. The tables below are derived from that output and the code behind it (the facade forwards every call, so the validator attributes them to `register.tsx`). Mods never make network requests.

Every hook is declared and registered in `plugin/hooks/register.tsx`; the mods compute plain values that those hooks turn into answers. The tool.call check hook answers only `next(e)` or a fixed `{ deny }`; the watch hook returns what `next(e)` returned, with at most one context line from loops added and known token formats masked in refusal and context text. There is no permission hook (`tool.check`), no prompt hook (`prompt.submit`), and no hook ever answers allow.

## Hooks by mod

| Mod | Hooks (event) | Gating |
|-----|---------------|--------|
| hud | `ui.render` (AbovePrompt), `tool.call` (watch: Edit, Write, MultiEdit, NotebookEdit, Bash) | no |
| receipts | `session.start`, `session.end`, `classic.SessionStart`, `turn.start`, `tool.call` (watch), `turn.complete` | no |
| guard | `tool.call` (check: Bash) | yes (`.catch` fails closed) |
| secrets | `tool.call` (check: Read, Edit, Write, MultiEdit, NotebookEdit, Grep, Glob, Bash; watch: all tools), `session.append` | check fails closed; watch and session.append fail open |
| tests | `tool.call` (check: Edit, MultiEdit, Write, NotebookEdit, Bash) | yes (fails closed) |
| notify | `turn.complete`, `classic.Notification` | no |
| compact | `classic.SessionStart`, `turn.complete`, `ui.render` (AbovePrompt band) | no |
| loops | `tool.call` (watch: Bash, Edit) | no |
| pins | `prompt.compose` | no |
| tidy | `tool.call` (check: Write) | yes (fails closed) |

`tool.call` is registered twice: first the checks, on a matcher that names the eight tools they read, with a `.catch` that refuses a call it had not let through; then the watch hook on every tool, which fails open.

## `$` calls by mod

Every mod reads its settings through the shared sets engine (`$.state.get` on `ultramod.set`). Guard and tests send their "needs you" notifications through the shared notifier in `core/notifier.ts`, the same platform detection, rate limit and chime the notify mod uses.

| Mod | Calls |
|-----|-------|
| hud | `$.state.get` (set, turn), `$.state.set` (turn), `$.clock.now`, `$.clock.every`, `$.session.usage`, `$.session.model`, `$.ui.resolve` |
| receipts | `$.state.get` (set, receipts), `$.state.set` (receipts), `$.session.usage`, `$.clock.now` |
| guard | `$.state.get` (set, allow), `$.state.set` (allow), `$.ui.ask`, `$.ui.log`, `$.ui.toast`, `$.process.run` (git, `rm -f` or, on Windows, `powershell.exe -File scripts\\remove-index.ps1` for the snapshot's temporary index, and the notifier's uname, which, notify-send, osascript, wslpath, powershell.exe), `$.clock.now`, `$.clock.after`, `$.session.cwd`, `$.session.root`, `$.env.get` (OS, WSL_DISTRO_NAME), `$.plugin.root`, `$.audio.play` |
| secrets | `$.state.get` (set, allow), `$.state.set` (allow), `$.ui.log` |
| tests | `$.state.get` (set), `$.fs.read`, `$.fs.exists`, `$.ui.ask`, plus the notifier calls (`$.clock.after`, `$.clock.now`, `$.env.get`, `$.process.run`, `$.ui.toast`, `$.audio.play`, `$.session.root`) |
| notify | `$.state.get` (set), `$.env.get` (OS, WSL_DISTRO_NAME), `$.process.run` (uname, which, notify-send, osascript, wslpath, powershell.exe), `$.plugin.root`, `$.ui.toast`, `$.audio.play`, `$.clock.now`, `$.clock.after`, `$.session.root` |
| compact | `$.state.get` (set, receipts, compact), `$.state.set` (compact), `$.session.usage`, `$.session.compact`, `$.clock.after`, `$.ui.toast`, `$.ui.log`, `$.ui.resolve` |
| loops | `$.state.get` (set), `$.ui.toast` |
| pins | `$.state.get` (set), `$.fs.stat`, `$.fs.read`, `$.fs.write` (via `/ultra pin`), `$.env.get` (HOME, USERPROFILE), `$.session.root` |
| tidy | `$.state.get` (set), `$.fs.exists`, `$.session.root`, `$.ui.ask` |

The core outside the mods also calls `$.store.get`/`$.store.set` (the per-project set choice), `$.command.register` (`/ultra`), `$.session.version` (`/ultra doctor`) and `$.ui.open` (`/ultra`) through the facade in `register.tsx`. The facade forwards nothing else. Its one file write, `fs.writePins`, writes `<project root>/.claude/pins.md` and no other path.

## Disk reads/writes by mod

| Mod | Reads | Writes |
|-----|-------|--------|
| hud | none (uses `$.state`) | none (uses `$.state`) |
| receipts | none (uses `$.state`) | none (uses `$.state`) |
| guard | `.git` (via `git` commands) | `refs/worktree/ultramod/snapshots/*` (git refs), temporary git index file under `.git` |
| secrets | none (blocks reads before they happen) | none |
| tests | test files (via `$.fs.read`) | none |
| notify | none | none |
| compact | none (uses `$.state`) | none (uses `$.state`) |
| loops | none (module state) | none (module state) |
| pins | `.claude/pins.md` (project), `~/.claude/pins.md` (user) | `.claude/pins.md` (project, via `/ultra pin`) |
| tidy | file existence (via `$.fs.exists`) | none |

## Processes started by mod

| Mod | Processes |
|-----|-----------|
| hud | none |
| receipts | none |
| guard | `git` (rev-parse, add, write-tree, commit-tree, update-ref, for-each-ref, ls-tree, ls-files, read-tree, checkout-index), `rm -f` or, on Windows, `powershell.exe -File scripts\\remove-index.ps1` (temporary index cleanup; the script removes only `ultramod-index` and `ultramod-restore-index`), and the notifier commands below when a dialog waits or is refused |
| secrets | none |
| tests | the notifier commands below when a dialog waits |
| notify | `uname -s` and `which` (detection), then `notify-send` (Linux), `osascript scripts/notify.applescript` (macOS) or `powershell.exe -File scripts/notify.ps1` (Windows; `wslpath -w` converts the script path under WSL) |
| compact | none |
| loops | none |
| pins | none |
| tidy | none |

## Network requests

**None.** No mod makes network requests. The validator confirms `env writes: nothing` and no `$` call performs network I/O.

## Fail modes

| Mod | Fail mode | Notes |
|-----|-----------|-------|
| hud | Fail open | A broken band draws nothing of its own; the plugins beneath still draw. |
| receipts | Fail open | A failure in collection adds no line; the turn proceeds. |
| guard | Fail closed | A failing check refuses the call; the hook's `.catch` refuses too if the hook itself fails. |
| secrets | `tool.call` check: fail closed. Watch and `session.append`: fail open (the original row is kept). | A broken redactor must not lose output. |
| tests | Fail closed | A failing check refuses the call. |
| notify | Fail open | Notification errors are caught; turn result unchanged. |
| compact | Fail open | Compaction errors are logged; turn result unchanged. |
| loops | Fail open | Observer errors caught; tool result unchanged. |
| pins | Fail open | Errors in compose return the composed result without pins. |
| tidy | Fail closed | A failing check refuses the call. |

## Validator output (summary)

```
Validating plugin manifest: ./plugin/.claude-plugin/plugin.json

  ❯ types ./types/index.d.ts declares on $: nothing (no EngineInterface member)
  ❯ types ./types/index.d.ts declares state: ultramod.set, ultramod.turn, ultramod.receipts, ultramod.allow, ultramod.compact

Validating hooks: ./plugin/hooks/hooks.json

  ❯ ./register.tsx hooks: session.start, classic.SessionStart, turn.start, turn.complete, session.end, command.run{command=ultra}, ui.render{component=AbovePrompt|Pane}, tool.call{tool=Bash|Read|Edit|MultiEdit|Write|NotebookEdit|Grep|Glob}, tool.call, session.append, prompt.compose, classic.Notification
  ❯ ./register.tsx gating hook without .catch: classic.SessionStart
  ❯ ./register.tsx gating hook without .catch: command.run{command=ultra}
  ❯ ./register.tsx gating hook with .catch: tool.call{tool=Bash|Read|Edit|MultiEdit|Write|NotebookEdit|Grep|Glob}
  ❯ ./register.tsx gating hook without .catch: tool.call
  ❯ ./register.tsx gating hook without .catch: session.append
  ❯ ./register.tsx gating hook without .catch: classic.Notification
  ❯ ./register.tsx calls: $.audio.play (via createApi), $.clock.after (via createApi), $.clock.every (via createApi), $.clock.now (via createApi), $.command.register (via createApi), $.env.get (via createApi), $.fs.exists (via createApi), $.fs.read (via createApi), $.fs.stat (via createApi), $.fs.write (via createApi), $.process.run (via createApi), $.session.compact (via createApi), $.session.cwd (via createApi), $.session.model (via createApi), $.session.root (via createApi), $.session.usage (via createApi), $.session.version (via createApi), $.state.get (via createApi), $.state.set (via createApi), $.store.get (via createApi), $.store.set (via createApi), $.ui.ask (via createApi), $.ui.log (via createApi), $.ui.open (via createApi), $.ui.resolve, $.ui.toast (via createApi)
  ❯ ./register.tsx env writes: nothing
  ❯ ./register.tsx env reads: HOME, OS, USERPROFILE, WSL_DISTRO_NAME
  ❯ ./register.tsx state writes: ultramod.allow, ultramod.compact, ultramod.receipts, ultramod.set, ultramod.turn
  ❯ ./register.tsx state reads: ultramod.allow, ultramod.compact, ultramod.receipts, ultramod.set, ultramod.turn

✔ Validation passed
```

Run `claude plugin validate ./plugin` yourself to see the full list.

## Known limits

The guard reads shell text; it does not run it. These forms still pass without a question in 1.0.1:

- commands run by another program: `xargs rm -rf`, `find . -exec rm -rf {} +`, `ssh host 'rm -rf ..'`, `docker exec c rm -rf ..`, `su -c '..'`
- wrappers it does not unwrap yet: `stdbuf`, `flock`, `chronic` and similar
- a command name held in a variable (`$CMD -rf src`)

Secrets does not expand braces (`cat .env{,.bak}`) and does not read the pattern argument of the Grep and Glob tools. Snapshots leave out tracked files that also match `.gitignore`. Treat all three mods as a second pair of eyes; Claude Code's own permission rules still apply.
