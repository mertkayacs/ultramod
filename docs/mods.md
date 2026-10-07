# Mods reference

Each mod is a small, deterministic hook. You can flip any mod on or off in the control pane (`/ultra`). The tables below show the exact deny texts, HUD strings, and receipt lines copied from the code.

## hud: band above the prompt

One row, width-adaptive. Segments drop from the end when narrow.

**Segments (priority order):**

1. Context: 10-cell bar plus `62% 124k/200k`. Colour by threshold: under 60 normal, 60–80 warning, 80+ error.
2. Limits: `5h 41% resets 2h13m` and `7d 18% resets 3d4h` (time until `resetsAt`; the short form drops `resets <time>`). Hidden when `rateLimits` is empty.
3. Turn: while a turn runs, `1m12s 3 edits 2 cmds`. Idle, the last turn's time.
4. Cost: `$1.84` session total.
5. Model: short model name from `$.session.model()`.
6. Set badge: `ultra:essentials` (dim).

**Modes:** `full` (all segments), `compact` (context + limits only), `off`.

**HUD example (160 columns):**

```
ctx ██████░░░░ 62% 124k/200k · 5h 41% resets 2h13m · 7d 18% resets 3d4h · 1m12s 3 edits 2 cmds · $1.84 · sonnet-4 · ultra:essentials
```

**HUD example (80 columns, compact):**

```
ctx ██████░░░░ 62% 124k/200k · 5h 41% · 7d 18%
```

**Behaviour:** Stays quiet when `e.props.hasSurvey`. Redraws every second only while a turn runs. Composes with other mods via `Box column [ourRow, await next(e)]`. The compact mod may add a `[Compact now]` button (hotkey `c`) to this row.

---

## receipts: line under each answer

Collects per main-loop turn (ignores `agentId` events, counts subagent spawns instead): files edited or written (Edit, Write, MultiEdit, NotebookEdit; successful only), shell commands with failures, test and build commands detected by pattern (npm/pnpm/yarn/bun test, vitest, jest, pytest, go test, cargo test, mvn/gradle test, dotnet test, make test, rspec, phpunit, deno test; tsc, build scripts, cargo build, go build), each with pass/fail and its order relative to the last edit.

At `turn.complete` (main loop, not aborted) returns `{ text }` such as:

```
receipt · 3 files · 5 cmds (1 failed) · tests passed · 2m14s · +$0.42
```

**Claim check:** If `e.answer` claims tests or a build pass (English patterns: "all tests pass", "tests are passing", "build succeeds", "type check passes", "lint passes"; precise, no generic "done") and there is no passing run of a matching command after the last edit in this turn, appends:

```
unverified: says tests pass, no passing test run after the last edit
```

Never blocks, never loops.

**Modes:** `tools` (default: a receipt when the turn used a tool), `always`, `issues` (only when something failed or a claim is unverified), `off`.

Keeps the last 20 receipts in `$.state` for the pane and for `compact`.

**Receipt examples:**

```
receipt · 2 files · 3 cmds · tests passed · 45s · +$0.12
receipt · 1 file · 2 cmds (1 failed) · build failed · 1m03s · -$0.05 · unverified: says tests pass, no passing test run after the last edit
receipt · 4 files · tests passed · type check passed · 2m07s · +$0.31
```

---

## guard: risky commands

`tool.call` on Bash. Holds a command that matches the risk table and asks with `$.ui.ask`:

```
Run \`git reset --hard\`? It discards uncommitted changes. A work tree snapshot is saved first, so /ultra undo can restore it.
```

Options: `Run it` / `Allow for session` / `Refuse`. In `claude -p`, on dismiss, or on any error, refuses with a `deny` text Claude can act on. `.catch` fails closed.

**Risk table (essentials):**

| ID | Pattern | Reason | Snapshot |
|----|---------|--------|----------|
| rm-recursive | `rm -r`/`-rf`/`--recursive` on paths outside the safe list (node_modules, dist, build, .next, coverage, target, __pycache__, .cache, /tmp) | recursively deletes `<path>` | yes |
| git-reset-hard | `git reset --hard` | discards uncommitted changes | yes |
| git-clean | `git clean -f` (not dry-run) | deletes untracked files | yes |
| git-checkout-discard | `git checkout -- .` / `git checkout .` | discards changes in the whole tree | yes |
| git-restore-discard | `git restore .` / `git restore --staged --worktree .` | discards changes in the whole tree | yes |
| git-push-force | `git push --force` / `-f` (not `--force-with-lease`) | overwrites remote history | no |
| git-branch-force-delete | `git branch -D` | force deletes a branch | no |
| git-stash-drop | `git stash drop` / `clear` | deletes stashed work | yes |
| git-history-rewrite | `git filter-branch` / `git filter-repo` | rewrites git history | no |
| sql-drop | `drop database\|schema\|table` | drops a database object | no |
| sql-truncate | `truncate table` | empties a table | no |
| sql-delete-all | `delete from` without `where` | deletes every row of a table | no |
| docker-prune | `docker system prune` / `docker volume rm\|prune` | prunes docker objects | no |
| kubectl-delete | `kubectl delete` | deletes a cluster object | no |
| terraform-destroy | `terraform destroy` / `tofu destroy` | destroys infrastructure | no |
| chmod-777-recursive | `chmod -R 777` / symbolic world-writable recursive | opens everything to all users | no |
| mkfs | `mkfs*` | formats a filesystem | no |
| dd-device | `dd of=/dev/` (not null/zero/random) | writes to `<dev>` | no |
| device-redirect | `>` / `>>` onto `/dev/sd*`, `/dev/nvme*` | writes to a disk device | no |
| pipe-to-shell | `curl\|wget ... \| sh\|bash` | pipes a download into a shell | no |
| fork-bomb | `:(){ :|:& };:` pattern | exponential process bomb | no |

**Strict adds:**

| ID | Pattern | Reason |
|----|---------|--------|
| git-push-force-with-lease | `git push --force-with-lease` | force pushes with lease |
| git-push-protected | `git push` to `main` or `master` | pushes to main or master |
| npm-publish | `npm publish` / `pnpm publish` / `yarn publish` / `bun publish` | publishes a package |
| gh-release | `gh release create` | creates a release |
| deploy-prod | `vercel --prod` / `firebase deploy` | deploys to production |

**Deny texts:**

- User picks `Refuse` or dismisses: `The user declined \`<cmd>\`. It <reason>. Ask them before running it again, or use a safer command such as \`git stash\`.`
- Marathon mode (deny): `Not running \`<cmd>\`: it <reason>. This project runs Ultra Mod's marathon set, which refuses risky commands; ask the user.`

**Notifications:** A guard question and a marathon denial each raise the notify mod's `<project folder> needs you: ...` notification (`guard: run \`<cmd>\`?` or `guard: refused \`<cmd>\``), sent through the shared notifier in `core/notifier.ts` with the same rate limit and chime. They stay silent while the notify mod is off.

**Undo net:** When the command is a destructive git or rm command inside a git work tree and the user picks `Run it`, first saves a snapshot of the work tree (untracked files included) without touching the index or work tree (temporary index via `GIT_INDEX_FILE`, `git add -A`, `write-tree`, `commit-tree`, then `update-ref refs/ultramod/snapshots/<iso-time>`). The question tells the user a snapshot will be saved.

`/ultra undo` lists snapshots (newest first, up to 20). `/ultra undo <n>` restores one into the work tree after a confirm (`git restore --source=<sha> --worktree -- .`), never deleting newer files.

`/ultra allow <risk id>` allows one risk id for the rest of the session.

---

## secrets: secret files and redaction

Blocks reads of secret files by Read, Edit, Write, MultiEdit, NotebookEdit, Grep and Glob with a path argument, and Bash commands that print them (cat, head, tail, less, more, bat, grep, rg, awk, sed, cut, base64, xxd, cp to stdout):

- `.env` and `.env.*` (allow `.env.example`, `.env.sample`, `.env.template`, `.env.dist`)
- `*.pem`, `*.key` (not `*.pub`)
- `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `id_dsa*` (not `.pub`)
- `*.p12`, `*.pfx`, `*.jks`, `*.keystore`
- `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`
- `.aws/credentials`, `.docker/config.json`, `.kube/config`
- `*credentials*.json`, `*secret*.{json,yml,yaml}` (configurable allowlist)

Bash `env` and `printenv` with no arguments are refused in strict, allowed in essentials.

**Deny texts:**

- File tool: `<path> is a secret file. Ask the user for the value it needs, or read .env.example instead, or have the user run /ultra allow <path>.`
- Bash (strict env dump): `This prints the whole environment, which can contain secrets. Ask the user for the specific value it needs.`
- Bash (secret file): `This would print the secret file <secret>. Ask the user for the value it needs, or read .env.example instead, or have the user run /ultra allow <secret>.`

**Redaction:** A `session.append` hook rewrites tool_result text content before it is stored and sent, replacing high-precision secret patterns with `[redacted:<kind>]`:

- Anthropic `sk-ant-`, OpenAI `sk-proj-` and legacy `sk-` (non-ant, non-proj)
- GitHub `ghp_`, `gho_`, `ghs_`, `ghu_`, `github_pat_`
- GitLab `glpat-`
- Slack `xox[abposr]-`
- AWS `AKIA`/`ASIA` ids
- Google `AIza`
- Stripe `sk_live_`/`rk_live_`
- npm `npm_`
- Hugging Face `hf_`
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----` … `-----END ... PRIVATE KEY-----`)
- `password=`/`secret=`/`token=`/`api_key=` assignments only when the value is ≥20 chars, high entropy (≥3.5 bits/char), 3 of 4 character classes, and not a placeholder

`.catch` keeps the original row (fail open, a broken redactor must not lose output) and logs it.

`/ultra allow <path>` allows one path for the session.

---

## tests: test integrity

Edits to test files (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, `test/`, `test_*.py`, `*_test.py`, `*_test.go`, `*Test.java`, `*Tests.cs`, `*_spec.rb`) that:

- Add a skip or focus marker: `.skip(`, `xit(`, `xdescribe(`, `xtest(`, `.only(`, `.todo(`, `@pytest.mark.skip`, `@pytest.mark.xfail`, `@unittest.skip`, `t.Skip(`, `#[ignore]`, `@Disabled`, `@Ignore`, `pending(`
- Remove assertions (fewer `expect(`, `assert`, `should` after the edit than before in the edited region)
- Delete or empty a test file (Write with empty content, Bash `rm` on test paths, `git rm`)

**Mode `ask` (default):** Asks the user.

**Mode `deny`:** Refuses with:

```
<reason>. Fix the code under test; do not skip or weaken tests unless the user asks.
```

Example: `src/utils.test.ts adds .skip and removes 2 assertions. Fix the code under test; do not skip or weaken tests unless the user asks.`

---

## notify: desktop notifications

Desktop notification when a main-loop turn that took longer than `notifyAfterSeconds` (default 30) ends, and when Claude waits for the user (`classic.Notification`, guard and tests questions). A guard question or a marathon denial sent while you are away notifies through the same sender.

**Title:** `Claude Code`

**Body:** `<project folder> finished in 2m14s` or `<project folder> needs you: <short reason>`

**Notifiers (detected once per session):** Linux `notify-send`, macOS `osascript`, Windows PowerShell toast, fallback `$.ui.toast`. Optional soft chime via `$.audio.play` with bundled asset (on in essentials). Never more than one notification per 10 seconds.

---

## compact: context autopilot

Reads `$.session.usage().context.percent` after each turn.

- At `warnAt` (70): a toast once per session: `Context is at 70%. Compacting now would free room for the next task.`
- At `offerAt` (85): the HUD shows `[Compact now]` button (hotkey `c`). Toast: `Context is at 85%. A Compact now button appears above the prompt at 85%.`
- With `autoAt` set (off in essentials, 88 in marathon): compacts between turns.

**Compaction instructions** (built from the session's receipts, capped at 2,000 chars):

```
Files changed:
- src/main.ts
- tests/main.test.ts

Commands that failed:
- npm test: Command failed with exit code 1

Unverified claims:
- says tests pass, no passing test run after the last edit

Keep the current task, the decisions made and the next steps.
```

**Modes:** `warn+offer` (essentials), `warn` (flow), `auto` (marathon), `off` (quiet).

---

## loops: loop breaker

Normalizes each Bash command (collapse whitespace). When the same command fails with the same first error line for the 3rd time in a session, shows a toast and, in `nudge` mode (default), adds one `context` line to that tool result for Claude:

```
This exact command has now failed 3 times with the same error. Stop retrying it. Read the error, check your assumptions, or ask the user.
```

Same for an Edit whose `old_string` was not found twice in a row on one file:

```
old_string was not found twice in a row in this file. Read the file again before editing.
```

Each nudge fires once per signature.

**Modes:** `nudge` (default), `warn` (toast only).

---

## pins: rules Claude cannot forget

If `.claude/pins.md` (project) or `~/.claude/pins.md` (user) exists, adds one system prompt section via `prompt.compose` with `scope: 'session'`:

```
Pinned rules from the user. Follow them in every reply:
- Use TypeScript strict mode
- Prefer functional style
- No console.log in production

(the list was truncated; edit pins.md for the rest)
```

Max 30 lines, 3,000 characters, truncated with a note. No file, no section, no tokens.

`/ultra pin <text>` appends a line to the project file. `/ultra pins` lists them. Re-read on file change via `$.fs.stat` mtime check at each `prompt.compose`.

---

## tidy: documentation sprawl

Write of a new `.md`, `.markdown` or `.txt` file (the path does not exist yet) outside an allowlist asks the user (strict) or refuses.

**Allowlist:** `README*`, `CHANGELOG*`, `CONTRIBUTING*`, `LICENSE*`, `docs/**`, `.claude/**`, `.github/**`, `AGENTS.md`, `CLAUDE.md`.

**Deny texts:**

- Ask mode: `Ultra Mod: create the new documentation file <rel>?` (options: Allow / Refuse). On refuse: `The new documentation file <rel> was refused. Put this summary in your reply instead of a new file unless the user asked for a file.`
- Deny mode: `Writing <rel> would add a new documentation file. Put this summary in your reply instead of a new file unless the user asked for a file.`