# Adding mod capabilities

Add the method to the exact `UltraApi` type in `plugin/hooks/core/api.ts`, then add a literal forwarding closure to the same-file `createApi` helper in `plugin/hooks/register.tsx`. Keep overloads and generics from the engine declarations. Raw engine `$` cannot cross imports; mods receive only this typed facade.

Add a state value type and key under `PluginState.ultramod` in `plugin/types/index.d.ts`, an atom with literal plugin/key strings in `core/state.ts`, and literal get/set branches in `createApi`. Use `read` and `update` with the facade; drawings only read. Session state resets on clear, resume and fork. Only project set/toggle preferences persist through `$.store`.

## Hooks and steps

Every engine hook lives in `register.tsx`, declared at the top of the file and registered on its own line as `on('event', hook)` or `on('event', { matcher }, hook)`. A hook passes `$` whole to `createApi` and never hands `next` to another file. It returns `next(e)`, a rewrite through `next({ ...e, ... })` where the event allows one (session.append), or an object it writes itself: `{ deny: refusal }` on tool.call, `{ text }` for `/ultra`. Ultra Mod has no permission hook (`tool.check`) and never answers allow.

A mod in `plugin/hooks/mods/` is an `UltraMod` object of plain steps, each `{ when?, run(api, e) }`, that `core/runtime.ts` runs in mod order and that return values, never engine answers:

- `check` (tool.call before the call): refusal text, or `null` to let the call through. A failing check refuses the call.
- `watch` (tool.call around the call): a function that gets the result and returns it, unchanged or with context lines; or `null`.
- `turnComplete`: a line to show under the answer, or `null`.
- `append` (session.append): the row's content rewritten, or `null`.
- `compose` (prompt.compose): a section to add, or `null`.
- `sessionStart`, `sessionRestart`, `turnStart`, `sessionEnd`, `notification`: work only, no answer.

A new kind of step needs a function in `core/runtime.ts`, one hook in `register.tsx`, a case in `plugin/tests/drive.ts` that mirrors that hook, and a line in `plugin/README.md` saying what the hook decides and when.

Run `npm run check` after the change. Add behavior tests through `claude-code/testing`, covering failure paths and both terminal and desktop for drawings. Shared subcommands return `null` to defer arguments to the next owner.
