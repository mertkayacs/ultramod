# Contributing

We welcome contributions. This is a short guide; the full mod-authoring docs are at [docs/CONTRIBUTING-MODS.md](docs/CONTRIBUTING-MODS.md).

## Quick start

```bash
git clone https://github.com/mertkayacs/ultramod
cd ultramod
npm install
npm run check
```

## What to know

- Mods are TypeScript modules in `plugin/hooks/mods/`; each exports an `UltraMod` object of plain steps
- Every engine hook is registered once, in `plugin/hooks/register.tsx`, and calls the mods' steps
- Shared code lives in `plugin/hooks/core/` and `plugin/hooks/lib/`
- Tests use `claude plugin test` (Claude Code's test runner)
- `npm run check` runs validate, test, and typecheck

## Code style

- Strict TypeScript, `noUncheckedIndexedAccess`
- No `import()`: import files with `import` declarations
- No DOM, no Node in hooks
- Fail closed for checks (a failing check refuses the call), fail open for everything else
- Every behaviour has a test covering main path, false positives, and failure path
- Drawings work on both terminal and desktop surfaces

## Pull requests

1. Fork and create a branch
2. Make your change with tests
3. Run `npm run check`
4. Open a PR

## License

By contributing, you agree that your contributions will be licensed under the MIT License.