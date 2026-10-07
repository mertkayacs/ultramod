# npx ultramod

Zero dependency installer for the Ultra Mod Claude Code plugin. Node 18 or newer,
Linux, macOS and Windows.

    npx ultramod                          install (the default command)
    npx ultramod install --dry-run        print the plan, run nothing
    npx ultramod uninstall                remove the plugin
    npx ultramod uninstall --keep-marketplace
    npx ultramod doctor                   check claude, marketplace, plugin, settings
    npx ultramod --help
    npx ultramod --version

`install` requires `claude` on PATH and version 2.1.287 or newer, prints each
command before running it, then executes `claude plugin marketplace add
mertkayacs/ultramod` (or `marketplace update ultramod` when it is already
configured) followed by `claude plugin install ultramod@ultramod`.

Every command is spawned as an argv array with `shell: false`. The one exception
is Windows, where `claude.cmd` is a batch file that Node refuses to execute
directly, so the fixed argument list is quoted and handed to `cmd.exe`. No
command string is ever assembled from input.

Tests: `node --test test/installer.test.mjs` or `npm run installer:test`. On Node
20 and older `node --test test/` also works; from Node 21 a bare directory
argument is treated as a file path. The tests never call the real `claude`, they
put a stub binary first on PATH.
