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

- Mods are TypeScript hooks in `plugin/hooks/mods/`
- Each mod exports a `register` function
- Shared code lives in `plugin/hooks/core/` and `plugin/hooks/lib/`
- Tests use `claude plugin test` (Claude Code's test runner)
- `npm run check` runs validate, test, and typecheck

## Code style

- Strict TypeScript, `noUncheckedIndexedAccess`
- No `import()`: import files with `import` declarations
- No DOM, no Node in hooks
- Fail closed for guards (`.catch` returns `{ deny }`), fail open for observers
- Every behaviour has a test covering main path, false positives, and failure path
- Drawings work on both terminal and desktop surfaces

## Pull requests

1. Fork and create a branch
2. Make your change with tests
3. Run `npm run check`
4. Open a PR

## License

By contributing, you agree that your contributions will be licensed under the MIT License.