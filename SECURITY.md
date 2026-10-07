# Security policy

## Reporting a vulnerability

Report security vulnerabilities privately via GitHub Security Advisories:

1. Go to the repository on GitHub
2. Click the **Security** tab
3. Click **Report a vulnerability**
4. Fill in the details

Do not open a public issue for security vulnerabilities.

## What to include

- Description of the vulnerability
- Steps to reproduce
- Affected versions (if known)
- Any mitigation you have found

## Response

We will acknowledge receipt within 72 hours and aim to provide a fix within 30 days for validated vulnerabilities.

## Scope

This policy covers the Ultra Mod plugin (`plugin/`) and the npm installer (`bin/ultramod.mjs`). It does not cover Claude Code itself or the Anthropic platform.

## Verified facts

- Zero network calls (validator confirms `env writes: nothing`)
- No telemetry
- No runtime dependencies
- Guards fail closed (`.catch` returns `{ deny }`)
- Everything else fails open (a broken HUD never blocks a tool call)
- `claude plugin validate ./plugin` lists every hook and `$` call

See docs/security.md for the full capability table.