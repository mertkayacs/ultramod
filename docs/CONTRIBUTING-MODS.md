# Adding mod capabilities

Add the method to the exact `UltraApi` type in `plugin/hooks/core/api.ts`, then add a literal forwarding closure to the same-file `createApi` helper in `plugin/hooks/register.tsx`. Keep overloads and generics from the engine declarations. Raw engine `$` cannot cross imports; mods receive only this typed facade.

Add a state value type and key under `PluginState.ultramod` in `plugin/types/index.d.ts`, an atom with literal plugin/key strings in `core/state.ts`, and literal get/set branches in `createApi`. Use `read` and `update` with the facade; drawings only read. Session state resets on clear, resume and fork. Only project set/toggle preferences persist through `$.store`.

Add a nonstreaming event to `ModEvent` and one literal registration in `register.tsx`. The dispatcher preserves registry order and skips disabled mods. Actual refusal handlers use `gating: true`; their events need a fail-closed `.catch`. Observers fail open. A failed `tool.check` guard denies even after reading its verdict.

Run `npm run check` after the change. Add behavior tests through `claude-code/testing`, covering failure paths and both terminal and desktop for drawings. Shared subcommands return `null` to defer arguments to the next owner.
