# FAQ

## General

### What is Ultra Mod?
A mod pack for Claude Code that adds a context HUD, receipts for every turn, guards for risky commands, secret protection, test integrity, notifications, auto-compaction, loop breaking, pinned rules, and documentation tidying. All in one plugin, switchable by set.

### How do I install it?
See the README. Requires Claude Code 2.1.287 or later.

### Does it work in VS Code, `claude -p`, or the SDK?
Hooks run everywhere a plugin loads. Drawing (HUD, pane) shows only in the terminal and the Desktop app. VS Code chat, `claude -p`, and the SDK run hooks without drawing.

### Is it sandboxed?
No. Mods run with your permissions. `claude plugin validate` lists every hook and `$` call. See docs/security.md.

### Does it send data anywhere?
No network calls. No telemetry. No runtime dependencies. The validator confirms `env writes: nothing`.

## Sets and mods

### How do I switch sets?
`/ultra set <name>`: essentials, strict, flow, marathon, quiet. Saved per project.

### Can I customise a set?
Yes. Open `/ultra` and flip any mod toggle. The set shows as `essentials*` (customised). Overrides are saved per project. `/ultra reset` drops them.

### What does "if file" mean for pins?
The pins mod only adds a system prompt section when `.claude/pins.md` (project) or `~/.claude/pins.md` (user) exists. No file, no tokens.

### Why is tidy off in essentials?
It only asks before creating new documentation files outside the allowlist (README, CHANGELOG, CONTRIBUTING, LICENSE, docs/, .claude/, .github/, AGENTS.md, CLAUDE.md). Most users don't need it daily. Turn it on in strict or marathon.

## Guard and undo

### What commands does guard catch?
See docs/mods.md for the full risk table. Essentials catches recursive rm outside safe dirs, git reset --hard, git clean -f, git checkout/restore discard, git push --force, git branch -D, git stash drop, git filter-branch/repo, SQL drop/truncate/delete without where, docker prune, kubectl delete, terraform destroy, chmod -R 777, mkfs, dd to devices, redirect to disk devices, curl|wget piped to shell, fork bombs.

### What does the snapshot save?
For destructive git or rm commands inside a git work tree: the work tree (including untracked files) via a temporary index, committed to `refs/worktree/ultramod/snapshots/<iso-time>`. The real index and work tree are never touched. Up to 20 snapshots kept.

### How do I restore?
`/ultra undo` lists snapshots. `/ultra undo <n>` restores after a confirm. Files created after the snapshot are kept.

### Can I allow a risky command for this session?
`/ultra allow <risk id>`, e.g. `/ultra allow git-push-force`.

## Secrets

### What files are blocked?
.env, .env.*, *.pem, *.key, id_rsa*, id_ed25519*, *.p12, *.pfx, *.jks, *.keystore, .npmrc, .pypirc, .netrc, .git-credentials, .aws/credentials, .docker/config.json, .kube/config, *credentials*.json, *secret*.json/yml/yaml. Allowlist: .env.example, .env.sample, .env.template, .env.dist, *.pub.

### What about Bash?
Blocks cat, head, tail, less, more, bat, grep, rg, awk, sed, cut, base64, xxd, cp to stdout when they would print a secret file. In strict mode, also refuses bare `env` and `printenv`.

### What gets redacted in output?
Anthropic sk-ant-, OpenAI sk-proj-/sk-, GitHub ghp_/gho_/ghs_/ghu_/github_pat_, GitLab glpat-, Slack xox[abposr]-, AWS AKIA/ASIA, Google AIza, Stripe sk_live_/rk_live_, npm npm_, Hugging Face hf_, private key blocks, and password/secret/token/api_key= assignments with high-entropy values (≥20 chars, ≥3.5 bits/char, 3 of 4 classes, not a placeholder).

### Can I allow a secret path for this session?
`/ultra allow <path>`, e.g. `/ultra allow .env.production`.

## Receipts

### When does a receipt appear?
Mode `tools` (default): when the turn used a tool. `always`: every main-loop turn. `issues`: only when a command failed or a claim is unverified. `off`: never.

### What is the claim check?
If the answer says "all tests pass", "tests are passing", "build succeeds", "type check passes", or "lint passes" and there is no passing run of a matching command after the last edit in that turn, the receipt appends `unverified: says tests pass, no passing test run after the last edit`. It never blocks.

### What commands count as test/build?
npm/pnpm/yarn/bun test, vitest, jest, pytest, go test, cargo test, mvn/gradle test, dotnet test, make test, rspec, phpunit, deno test; tsc, build scripts, cargo build, go build.

## Compact

### When does it warn/offer/auto?
Essentials: warn toast at 70% (once), offer button at 85%. Marathon: also auto at 88%. Flow: warn at 70% only. Quiet: off.

### What goes into the compaction instructions?
From the last 20 receipts: files changed (up to 30), failed commands with last error line, unverified claims, and the closing line "Keep the current task, the decisions made and the next steps." Capped at 2,000 characters.

## Notify

### When do I get a notification?
When a main-loop turn takes longer than `notifyAfterSeconds` (default 30) and ends, or when Claude waits for you (guard question, tests question, classic.Notification).

### Which notifier is used?
Detected once per session: `notify-send` (Linux), `osascript` (macOS), `powershell.exe` (Windows), fallback `$.ui.toast`. Run `/ultra doctor` to see which one is active.

### Can I disable the chime?
Yes. In the control pane, or set `sound: false` in userConfig.

## Loops

### What triggers a nudge?
Same Bash command fails with the same first error line 3 times, or same Edit misses `old_string` twice in a row on one file. In `nudge` mode (default), adds a context line for Claude. In `warn` mode, only a toast.

### Does it reset?
Counts are per session (module state). `/ultra reset` does not clear them; a new session does.

## Pins

### Where do pins live?
`.claude/pins.md` (project) and `~/.claude/pins.md` (user). Bullet or plain non-empty lines; headings and comments skipped.

### How many lines?
Max 30 lines, 3,000 characters. Truncated with a note.

### How do I add one?
`/ultra pin <text>` appends to the project file.

## Tidy

### What does it block?
New `.md`, `.markdown`, `.txt` files outside the allowlist. In ask mode, prompts. In deny mode, refuses with fixed text.

### What is the allowlist?
README*, CHANGELOG*, CONTRIBUTING*, LICENSE*, docs/**, .claude/**, .github/**, AGENTS.md, CLAUDE.md.

## Troubleshooting

### The HUD doesn't appear.
Check `/ultra doctor`: hud must be enabled and set to `full` or `compact`. Drawing only works in terminal and Desktop app. At narrow widths, segments drop from the end.

### Receipts don't show.
Check the receipts mode in the control pane. `tools` only shows when a tool was used. `issues` only on failures or unverified claims.

### Guard didn't catch a command.
Check the risk table in docs/mods.md. The patterns are precise. If a command looks like it should match but doesn't, it may be a false negative; open an issue.

### Secrets didn't block a file.
Check the path patterns in docs/mods.md. The allowlist (.env.example etc.) is case-insensitive. Basename and known parent folders (.aws/credentials, .docker/config.json, .kube/config) are matched.

### Notifications don't appear.
Run `/ultra doctor` to see the detected notifier. On Linux, `notify-send` must be installed. On macOS, `osascript`. On Windows, PowerShell. Fallback is a toast.

### Compact button doesn't appear.
Check compact mode and `offerAt` threshold. The button only appears when context percent ≥ `offerAt` (85 in essentials) and the HUD is in `full` mode (not `compact`).

### Pins don't apply.
Check that `.claude/pins.md` or `~/.claude/pins.md` exists and has bullet or plain lines. Run `/ultra pins` to see what Ultra Mod reads. The section is added at `prompt.compose` with `scope: 'session'`.

## Uninstall

```bash
npx ultramod uninstall
# or
claude plugin uninstall ultramod@ultramod
```

Removes the plugin and marketplace entry. Your per-project set choices in `$.store` remain until you clear them.