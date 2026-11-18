# Building and running Trawler

## Run from source

    npm install
    npm start               # build the main process and launch the app

`npm start` builds the main process and launches Electron through `scripts/start.mjs`. That launcher:
- removes `ELECTRON_RUN_AS_NODE`, which terminals inside VS Code set;
- passes `--` before your options, because on Windows Electron refuses to start when a URL argument is followed by more arguments.

If you call `electron .` directly, do both yourself, or write `--url=<url>`.

## Tests

    npm test                # unit + Node integration
    npm run typecheck
    npm run test:electron   # builds the main process and runs real Electron tests
    npm run test:e2e        # UI end-to-end tests
    npm run test:packaged   # E2E against the packaged app (builds it first)

## Windows app

    npm run pack
    npm run dist
    npm run make-icon

- `npm run pack`: unpacked app in `release/win-unpacked/` (used by the packaged E2E).
- `npm run dist`: `release/Trawler-Setup-<version>.exe` (NSIS installer; per-user by default, choosing "all users" in the installer asks for administrator rights; you choose the folder) and `release/Trawler-<version>-portable.exe`.
- `npm run make-icon`: re-renders `build/icon.png` and the installer images (`build/installer-sidebar.bmp`, `build/installer-header.bmp`) from the SVGs in `build/`. Only needed when the logo or the installer art changes.

The portable exe keeps its settings, history and app state in a `TrawlerData` folder next to it; the installed app uses `%APPDATA%\Trawler`. `TRAWLER_USER_DATA=<folder>` overrides both.

The build is not code-signed: Windows SmartScreen shows a warning the first time ("More info" then "Run anyway"). Signing needs a certificate.

The installer checks for a running app with `tasklist` (`build/installer.nsh`), not the stock PowerShell/WMI query, which can freeze the installer for minutes on some machines.

Bumping the version: change `version` in `package.json` **and** `TRAWLER_VERSION` in `src/engine/version.ts` (a test checks they match).

## Command line (headless)

    npm start -- --trawler-cli --url https://example.com/template/ --out ./mirror
    npm start -- --trawler-cli --kind analyze --url https://example.com/template/

Options:
- `--kind download|analyze` (default `download`)
- `--mode auto|static|js` (default from settings: `auto`)
- `--policy overwrite|merge|fail`, for a non-empty output folder
- `--settings '<json>'`: any settings from the design, e.g. `'{"maxPages":50}'`

Progress events go to stderr as JSON lines. The final result goes to stdout as one line starting with `TRAWLER_RESULT `.

Exit codes:
- `0` done (also with errors)
- `1` failed
- `2` cancelled
- `64` bad arguments

Headless runs use a throwaway browser profile in the temp folder, and stale profiles are removed on later runs.
