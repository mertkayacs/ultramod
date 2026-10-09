# Changelog

## 1.0.6 (2026-10-09)

Fixes for the second review round on the claude-code-templates listing (cubic, 15 findings against 1.0.1). Each fix has a test that fails on 1.0.5.

### Security
- guard: env options no longer hide the command after them: `env -0 rm -rf /`, `env -v`, `env --debug`, `env -u X`, `env -S 'rm -rf /'` and `env -S '-i' rm -rf /` (env splits the value into more arguments) are all checked; `env -S` nested more than eight levels deep is asked about as `unchecked`
- guard: `bash /dev/stdin <<EOF`, `sh /dev/fd/0` and `source /dev/stdin` read the heredoc like `bash -s`, so its body is checked
- guard: SQL is also read word by word as the shell passes it, with `$'...'` escapes decoded and PostgreSQL's comment rule (`--` needs no blank after it), so `psql -c $'DROP--x\nTABLE users'` and `$'DROP\tTABLE users'` are held
- guard: SQL piped into a carrier behind a remote runner (`echo 'DROP TABLE users' | docker exec -i db psql`, `kubectl exec`, `ssh`) is checked
- guard: a command that sets `GIT_DIR` or `GIT_WORK_TREE` after an env option (`env -u X GIT_DIR=..`), or starts in another directory (`env -C`, `sudo -D`), is not promised a snapshot of the session's repository
- secrets: a glob is also read as the names it spells, so `cat client-cert.pem*` and `cat *.pem` are refused; `cp` of a secret glob to stdout counts as a read
- secrets: `command env -0` and other wrapped or optioned env dumps count as dumps in strict mode; `env -i`, which prints only the pairs it is given, does not
- guard: the approval dialog masks known token formats in the full command

### Fixes
- guard: `git clean -x` and `-X` are no longer promised an undo, since a snapshot does not hold ignored files
- guard: from a subdirectory, `git -C .. reset --hard` inside the same work tree gets its snapshot (it was treated as another repository)
- undo: a path that starts with a space is checked for conflicts before a restore (git's NUL-separated output is no longer trimmed)
- receipts: `! npm test` and `cat <(npm test)` no longer count as passing tests
- compact: a compaction another hook vetoes counts as failed, so auto mode tries again on the next turn

## 1.0.5 (2026-10-09)

Plugin directory release: the hooks module is rebuilt so the directory's analyzer can read every hook. Behaviour is the same unless noted.

### Changes
- hooks: every hook is a named function at the top of `hooks/register.tsx`, registered on its own line as `on("event", hook)`. The engine's `$` goes only to `createApi`, and `next` never leaves the hook that received it. Mods are now plain steps (`check`, `watch`, `turnComplete`, `append`, `compose` and the lifecycle steps) that return values, run by `core/runtime.ts`; the middleware dispatcher is gone
- tool.call: two registrations. The check hook, on the eight tools guard, secrets, tests and tidy read, answers only `next(e)` or `{ deny }` and refuses when it fails; the watch hook on every tool counts the call and adds the loops line
- no permission hook and no prompt hook: the unused `tool.check` and `prompt.submit` registrations are removed
- guard: on Windows the snapshot's temporary index is removed by a shipped script, `scripts/remove-index.ps1`, which removes only Ultra Mod's two index files, instead of an inline `cmd /c del`
- facade: no accessors and no `.then` chains; the one file write is `fs.writePins`, which writes only `<project root>/.claude/pins.md`; unused forwards (`$.ui.status`, `$.ui.close`, `$.ui.invalidate`, `$.session.id`, `$.store.delete`, `$.store.keys`) and the unused `TERM_PROGRAM` read are gone
- notify and compact run their turn-end work before the turn's result is passed on instead of after; the receipt still goes under the answer
- `/ultra doctor` reports the real version (it said 1.0.0)
- plugin README: what each hook decides and when, what the hooks change, what goes to the notifier, the exact commands it runs, the files it writes and the environment variables it reads, plus the install line
- listing: new description and keywords

## 1.0.4 (2026-10-09)

### Changes
- guard, tests: neither mod answers a permission check any more. They used to turn the engine's `ask` into `allow` for a call you had approved in their own dialog; now Claude Code's own prompt can follow the Ultra Mod dialog
- notify: the macOS and Windows notifiers run shipped scripts (`scripts/notify.applescript`, `scripts/notify.ps1`) instead of inline `osascript -e` and `powershell -Command` programs; under WSL the script path goes through `wslpath -w`
- directory: a listing icon (`.claude-plugin/icon.png`) and a plugin README that says what each hook decides, which programs run and why, which files are written, and that nothing leaves the machine

## 1.0.3 (2026-10-09)

### Fixes
- install: the plugin manifest no longer uses the `options` key on the default-set setting, which some Claude Code releases reject with `userConfig.set: Unrecognized key: "options"`; the allowed set names are listed in the description and still checked by the plugin
- docs: install with one command (`/plugin install ultramod --marketplace mertkayacs/ultramod`), and what to do about `Plugin "ultramod" not found in any configured marketplace`

## 1.0.2 (2026-10-09)

### Fixes
- undo: the snapshot commit carries its own author, so snapshots work on a machine with no git `user.name` or `user.email` (a fresh CI image or laptop); before, the guard logged "git commit-tree failed" and `/ultra undo` had nothing to restore
- tests: fake keys in the redaction tests are split into string parts, so plugin registries and secret scanners no longer read them as leaked secrets

## 1.0.1 (2026-10-09)

Hardening release. Reviewers on two listing PRs filed 74 findings against 1.0.0; each one is fixed with a test or answered with evidence.

### Security
- guard: `..` in rm paths is resolved, so `rm -rf node_modules/../../*` is no longer treated as a safe root
- guard: wrapped commands are checked (`sudo sh -c`, `bash -lc`, `env`, `timeout`, `nice`, `eval`, quoted shells like `| "sh"`)
- guard: SQL sent through `docker exec`, `kubectl exec`, `ssh` and similar wrappers is classified
- guard: a command after a heredoc on the same line is no longer hidden inside it
- guard: `kubectl` global flags that take values (`--server`, `--token`, `-s`) no longer hide the verb
- guard: commands quoted back to the model, notifications, logs and snapshot messages are redacted
- secrets: `node --env-file=.env -e ...` and similar runner reads of a protected env file are refused
- secrets: `printenv --null` and `env -0` count as environment dumps in strict mode
- secrets: a later hook's deny text or context is redacted before it reaches the model
- secrets: redaction runs in linear time (1 MB of adversarial text in under 50 ms)
- tidy: `docs/../notes.md` and wildcard look-alike folders no longer slip past the allowlist
- notify: notification text travels as data on every platform, so a folder name cannot inject script
- guard: a second, adversarial review round: shell keywords (`if`, `for`, `{ }`, `!`), quoted heredoc delimiters, `bash -c "$(curl ..)"`, `bash <(curl ..)`, here-strings into a shell, backtick pairing, brace expansion and `$IFS` tricks, `git push -fu`, SQL with comments, subshells after a pipe, and nesting deeper than the guard reads (now asked about as `unchecked`)
- secrets: input redirects (`< .env cat`), globs (`cat .env*`), private keys cut off before their END line, and `AWS_SECRET_ACCESS_KEY` values

### Fixes
- undo: restoring a snapshot keeps tracked files created after it (real git test)
- undo: snapshot refs taken in the same second no longer overwrite each other
- undo: snapshots work from a subdirectory, a restore never deletes a file that took the place of a snapshot folder (it names the conflict instead), and snapshots now belong to one worktree (`refs/worktree/ultramod/snapshots/`; snapshots made by 1.0.0 are no longer listed)
- guard: `/ultra allow server.pem` reaches the secrets mod instead of being stored as a risk id
- receipts: a test piped into another command or followed by `;` or `||` does not count as a pass
- receipts: `npx vitest@3`, `pnpm vitest`, `bun vitest` and `npm run-script test` count as test runs
- tests: new test files, notebook cells, `.skip.each`/`.only.each` and git global options are checked
- notify: the "needs you" notification arrives while the question is still open
- compact: no repeated auto-compaction while context stays high; `/clear` drops old receipts
- loops, pins, HUD, pane and doctor: smaller fixes listed in the review triage

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