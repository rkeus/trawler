# Trawler

Desktop app that mirrors a website template — static or JavaScript-rendered — into a local folder, keeping the server's folder structure. It detects the template's architecture automatically and offers an Analyze (dry-run) step before downloading.

## Legal

Use Trawler only for templates you hold a license for, free/open templates, and your own sites. Mirroring a paid template's demo without a license infringes the author's copyright.

## Development

    npm install
    npm test
    npm run typecheck

Design spec: `docs/superpowers/specs/2026-11-16-trawler-design.md`

## Command line (headless)

    npm start -- --trawler-cli --url https://example.com/template/ --out ./mirror
    npm start -- --trawler-cli --kind analyze --url https://example.com/template/

`npm start` builds the main process and launches Electron via `scripts/start.mjs`. That launcher removes `ELECTRON_RUN_AS_NODE`, which terminals inside VS Code set and which would make Electron run as plain Node. If you call `electron .` directly, unset that variable first.

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

## Tests

    npm test                # unit + Node integration
    npm run test:electron   # builds the main process and runs real Electron end-to-end tests
