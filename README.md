# Trawler

Desktop app that mirrors a website template — static or JavaScript-rendered — into a local folder, keeping the server's folder structure. It detects the template's architecture automatically and offers an Analyze (dry-run) step before downloading.

## Legal

Use Trawler only for templates you hold a license for, free/open templates, and your own sites. Mirroring a paid template's demo without a license infringes the author's copyright.

## Development

    npm install
    npm test
    npm run typecheck
    npm start               # build the main process and launch the app
    npm run test:electron   # real Electron tests
    npm run test:e2e        # UI end-to-end tests
    npm run test:packaged   # E2E against the packaged app (builds it first)

Design spec: `docs/superpowers/specs/2026-11-16-trawler-design.md`

## Building the Windows app

    npm run pack
    npm run dist
    npm run test:packaged
    npm run make-icon

- `npm run pack`: unpacked app in `release/win-unpacked/` (used by the packaged E2E).
- `npm run dist`: `release/Trawler-Setup-<version>.exe` (NSIS installer, per-user, no admin rights, choose the folder) and `release/Trawler-<version>-portable.exe`.
- `npm run test:packaged`: builds the unpacked app and runs the E2E against it.
- `npm run make-icon`: re-renders `build/icon.png` from `build/icon.svg` (only needed when the logo changes).

The portable exe keeps its settings, history and app state in a `TrawlerData` folder next to it; the installed app uses `%APPDATA%Trawler`. `TRAWLER_USER_DATA=<folder>` overrides both.

The build is not code-signed: Windows SmartScreen shows a warning the first time ("More info" then "Run anyway"). Signing needs a certificate and is out of scope.

Bumping the version: change `version` in `package.json` **and** `TRAWLER_VERSION` in `src/engine/version.ts` (a test checks they match).

## Command line (headless)

    npm start -- --trawler-cli --url https://example.com/template/ --out ./mirror
    npm start -- --trawler-cli --kind analyze --url https://example.com/template/

`npm start` builds the main process and launches Electron via `scripts/start.mjs`. That launcher:
- removes `ELECTRON_RUN_AS_NODE`, which terminals inside VS Code set;
- passes `--` before your options, because on Windows Electron refuses to start when a URL argument is followed by more arguments.

If you call `electron .` directly, do both yourself, or write `--url=<url>`.

Options:
- `--kind download|analyze` (default `download`)
- `--mode auto|static|js` (default from settings: `auto`)
- `--policy overwrite|merge|fail`, for a non-empty output folder
- `--settings '<json>'`: any settings from the spec, e.g. `'{"maxPages":50}'`

Progress events go to stderr as JSON lines. The final result goes to stdout as one line starting with `TRAWLER_RESULT `.

Exit codes:
- `0` done (also with errors)
- `1` failed
- `2` cancelled
- `64` bad arguments

Headless runs use a throwaway browser profile in the temp folder, and stale profiles are removed on later runs.

## Tests

    npm test                # unit + Node integration
    npm run test:electron   # builds the main process and runs real Electron end-to-end tests
