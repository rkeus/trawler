# Trawler — Design Spec

- **Date:** 2026-11-16
- **Status:** Implemented
- **One-liner:** Desktop app that mirrors a website template (static or JS-rendered) into a local folder. It keeps the server's folder structure and detects the template's architecture automatically.

---

## 1. Goals and non-goals

### Goals
- Paste a template URL, pick an output folder, and get a working local copy: all HTML, CSS, JS, images, fonts and data files in the same directory structure as on the server.
- **Detect automatically** whether the template is static, hybrid or JS-rendered (SPA), and pick the right download strategy.
- **Crawl** all pages of a multi-page template within a defined scope.
- Offer an **Analyze** (dry-run) step that reports the architecture, pages, assets, external hosts and warnings without writing anything to disk.
- Make every behavior configurable, with a safe default for each.
- Verify the result after download: load the local copy and report missing files.

### Non-goals
- Retrieving server-side source code (PHP, APIs). Only what the server sends is captured.
- Recovering unminified sources. Bundles are saved as built.
- Simulating user interaction (clicks, hovers, form submits) to discover assets. Auto-scroll is the only interaction.
- A page-selection UI before download. Analyze shows pages read-only; selection may come later.
- Bypassing authentication, paywalls or license checks.

### Legal note (shown in README and on first run)
Trawler is intended for templates the user owns a license for, free/open templates, and the user's own sites. Mirroring a paid template's demo without a license infringes the author's copyright.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Shell | Electron |
| Language | TypeScript (strict) |
| Build | `esbuild` for the main process and the preload; Vite for the React renderer |
| Packaging | `electron-builder`: NSIS installer (per-user) and portable `.exe`, Windows x64, unsigned |
| UI | React (renderer process) |
| HTML parsing | `parse5` (via `cheerio` for querying) |
| CSS parsing | `postcss` + `postcss-value-parser` |
| Networking | Electron `session` + `net.fetch` (Chromium network stack) |
| JS-mode capture | Hidden `BrowserWindow` + Chrome DevTools Protocol via `webContents.debugger` |
| Unit/integration tests | Vitest |
| E2E tests | `playwright-core` `_electron`, driven from Vitest (dev dependency only, not shipped) |

**Why no Playwright/Puppeteer at runtime:** Electron already ships Chromium. A second browser would add about 150 MB and complicate packaging for no capability gain.

**Why `net.fetch` through a session:** static fetches and the hidden render window share one Chromium TLS stack and one cookie jar. A bot-protection cookie (e.g. Cloudflare) earned by the hidden window is reused by static fetches. Plain Node `fetch` or curl can also fail TLS handshakes on some CDNs where Chromium succeeds.

---

## 3. Architecture

All work runs in the **main process**. The renderer is a thin UI that sends commands and receives events over a typed IPC contract.

```
renderer (React UI)
   │  IPC: commands (analyze, download, cancel, preview, openFolder…)
   │  IPC: events   (phase, progress, log, detection, result, error)
   ▼
main
   job ──► detector ──► fetcher / js-capture
    │        crawler ──► parse-html / parse-css
    │        url-mapper ──► rewriter ──► writer
    └──────► verifier ──► preview-server
```

### Repository layout

Pure, Electron-free modules live in `src/core/` (url, css, html, crawl, detect) so they can be tested in plain Node; Electron-bound modules live in `src/main/`.

```
trawler/
  src/
    core/             url/ css/ html/ crawl/ detect/  (pure)
    main/
      job/            orchestrator
      detector/
      fetcher/
      js-capture/
      parse-html/
      parse-css/
      crawler/
      url-mapper/
      rewriter/
      writer/
      verifier/
      preview-server/
      store/          settings.json, history.json
      ipc/
    renderer/         React UI
    shared/           types, IPC contract, settings schema + defaults
  test/
    fixtures/         fixture sites (static, external-host, spa)
    unit/
    integration/
    e2e/
  docs/
```

### Modules

Every module except `job`, `js-capture`, `verifier` and `preview-server` is a pure function or pure class. None of the pure ones needs Electron, so they are testable in plain Node.

| Module | Responsibility | Input → Output |
|---|---|---|
| `job` | Orchestrates analyze and download runs: state machine, progress events, cancellation, analyze-cache reuse. | `JobRequest` → event stream + `JobResult` |
| `detector` | Fetches the seed raw and renders it in a hidden window, then computes signals and a score. | URL → `Detection { verdict, score, framework[], signals[] }` |
| `fetcher` | HTTP over the job session: concurrency limit, retries with backoff, timeout, `Retry-After`, adaptive concurrency, bot-challenge fallback. | URL → `Resource { url, finalUrl, status, headers, body }` |
| `js-capture` | Hidden `BrowserWindow`, CDP `Network.*`: records every response and its body, auto-scrolls, waits for network idle, returns the rendered DOM and the original served HTML. | URL → `Capture { html, renderedDom, resources[] }` |
| `parse-html` | Extracts asset refs and page links from HTML. | HTML + base URL → `{ assets: Ref[], pages: Ref[] }` |
| `parse-css` | Extracts `url()`, `@import`, `image-set()`, `@font-face src`. | CSS + base URL → `Ref[]` |
| `crawler` | BFS page queue: scope filter, depth and page limits, dedupe, URL normalization, `robots.txt`, exclude patterns, extra seeds. | seeds + settings → page URLs (stream) |
| `url-mapper` | Maps a URL to a local relative path. Handles Windows path rules, query strings, missing extensions, external hosts and collisions. | URL + content-type → local path |
| `rewriter` | Rewrites refs in HTML and CSS to paths relative to the referring file. Optionally rewrites absolute same-origin URLs in JS. | file + URL→path map → file |
| `writer` | Writes files to the output folder, applies the non-empty-folder policy, writes `_trawler/manifest.json` and `_trawler/report.json`. | files → disk |
| `verifier` | Serves the output, loads every downloaded page in a hidden window and counts failed requests (4xx, 5xx, blocked). | output folder → `VerifyReport` |
| `preview-server` | Static HTTP server on `127.0.0.1` and a free port. Serves the output **under the original base path** with an SPA fallback. | folder + basePath → URL |
| `store` | Persists settings and history in Electron `userData`. | — |

---

### Desktop app runtime

- **One job at a time.** The job manager rejects a second job while one runs. The UI shows a single job.
- **Reusable sessions.** Every job uses the same two in-memory sessions, one for crawling and one for verification. They are emptied before each job: cookies, cache, storage, auth cache, host cache, open connections. Electron never frees a partition, so one partition per job would grow memory for the app's whole life. The CLI still creates fresh sessions per run.
- **Stores in `userData`:**
  - `settings.json` holds only the values that differ from the defaults.
  - `history.json` is the Recent list, newest first, at most `historySize` entries.
  - `app-state.json` records whether the legal note was accepted, and the last output folder.
  - A damaged file is moved aside as `<name>.corrupt-<time>` and the app starts with defaults.
  - Writes go through a temporary file and a rename.
  - `TRAWLER_USER_DATA` overrides the profile folder (tests, portable use).
- **IPC.**
  - The contract is typed in `src/shared/ipc.ts`.
  - The sandboxed preload exposes it as `window.trawler`.
  - Every command reply is wrapped as `{ ok, value | error }`, so the UI gets plain error messages.
  - Job events and the finished result are pushed on `job:event` and `job:finished`.
  - `currentJob` returns the running job's phase, counters and detection, so a reloaded UI can catch up.
- **Quitting** cancels a running job, which writes its partial manifest, and stops the preview before the app exits.
- **App-level settings** (`historySize`, `analysisCacheTtlMs`, `analysisCacheMaxBytes`, `shutdownTimeoutMs`, `sessionResetTimeoutMs`) always come from the saved settings. Per-job changes, such as recommended settings or Repeat with a history entry's settings, cannot change them.
- **Closing the window quits the app.** Hidden capture windows do not keep it running. Quitting waits at most `shutdownTimeoutMs` for the running job to cancel and clean up, then exits anyway. After shutdown starts, no new job is accepted. Launching Trawler again while it shuts down starts it again once the shutdown is done.
- **Analysis cache lifetime.** It counts from the end of the analysis. The cached bodies are freed as soon as they expire, are replaced by a new analysis, or have been used by a download.
- **Error codes.** Every failed reply carries a code: `busy`, `invalid`, `untrusted`, `unknown-command` or `failed`. The preload hands replies to the page as values (custom Error properties do not survive Electron's context bridge); the renderer's API wrapper rejects with an `ApiError` that has the code.
- **Progress is coalesced.** At most one progress event per 100 ms reaches the UI, always the latest counters; any other event and the end of the job flush the pending one first, so order is kept.
- **The last finished job** stays available until the next job starts (`lastFinishedJob`), so a UI that reloads just as a job ends still shows the result.
- **Theme and accent** (`theme`: system, dark or light; `palette`: ember, slate, moss, sand, clay or ink) live in `app-state.json`. Defaults: dark, Ember.
- **Writes retry and memory follows the disk.** The final rename of a store write is retried a few times on EPERM, EBUSY or EACCES (antivirus and indexers hold files briefly). A store changes its memory only after its write succeeded, so the UI never shows a value that is not saved.
- **Network folders** (UNC and device paths) are not supported. The folder dialog refuses them at once, and every command rejects them.
- **Emptying the sessions has a time limit** (sessionResetTimeoutMs). When it passes, the job starts anyway and the app writes a line to stderr. A clean-up that outlived the limit is waited for (again within the limit) before the next job's clean-up starts.
- **Startup problems are visible.** A damaged store file that was moved aside shows as a notice on the Start screen (AppInfo.startupWarnings). If the app cannot start at all, it shows an error dialog before it exits.
- **Packaged builds.** The app is packed into `app.asar` (`out/` + `package.json`; the main bundle inlines its libraries, no `node_modules` ships). The profile lives in `%APPDATA%\Trawler`; the portable build uses a `TrawlerData` folder next to the `.exe`; `TRAWLER_USER_DATA` overrides both.
- **Windows logoff or shutdown** (session-end) runs the same shutdown as quitting: the running job is cancelled and writes its partial manifest. Windows may end the process before that finishes, so this is best effort.

## 4. Data flow

### 4.0 Input
`JobRequest { seedUrl, outputDir, settings, kind: 'analyze' | 'download' }`

### 4.1 Scope
- **Base path** = directory of the seed URL. Example: `https://x.com/html/index.html` → host `x.com`, base `/html/`.
- A page is in scope when it has the same host (scheme-insensitive: `http` and `https` count as the same site, so an `http→https` redirect does not empty the scope) and its path starts with the base path.
- Assets are **not** scope-limited by path. A page under `/html/` may use `/assets/x.css`. Same-host assets outside the base path are still downloaded (see 4.5 for placement).

### 4.2 Detection (mode `auto`)
1. Fetch the seed raw with `fetcher`.
2. Render the seed with `js-capture`: wait for network idle (`networkIdleMs`, default 1000 ms), hard cap `renderTimeoutMs` (default 15 s).
3. Compute signals:

| Signal | Meaning |
|---|---|
| `textRatio` | visible text length raw / rendered |
| `elementRatio` | element count raw / rendered |
| `emptyMount` | `#root`, `#app`, `#__next`, `#__nuxt`, `[ng-app]` present and empty in raw HTML |
| `frameworkMarkers` | `__NEXT_DATA__`, `__NUXT__`, `ng-version`, `data-v-*`, `data-reactroot`, `data-server-rendered`, Vite/Webpack chunk patterns |
| `dataRequests` | count of XHR/fetch responses with JSON content during render |
| `moduleScripts` | `<script type="module">` count |

4. Compute a weighted score in `[0,1]` and map it to a verdict: `static` (< 0.3), `hybrid` (0.3–0.6), `js` (> 0.6). Thresholds and weights live in settings (advanced) with these defaults.
5. **Hybrid runs in JS mode** because it captures a superset of what static mode gets.
6. Framework detection also records UI kits it recognizes (Bootstrap, Tailwind, etc.) for display only.
7. The start-page render made for detection is reused by a JS-mode crawl, so the start page is rendered once. Detection also runs during Analyze when the mode is fixed, for the report only. If detection fails, the job continues in static mode (or JS mode, if set) with a warning.

With mode `static` or `js` set manually, detection still runs during Analyze for the report but does not change the mode.

### 4.3 Page crawl (BFS)
- **Static mode:** fetch page HTML → `parse-html` → asset refs + page links.
- **JS mode:** each page is rendered by the capturer, with at most `renderConcurrency` windows at once.
  - Resources the browser loaded (scripts, chunks, JSON, fonts, images) are adopted directly, without a second request.
  - Asset refs and page links come from both the served document and the rendered DOM. That covers JS-inserted images and SPA routes. Refs not loaded during rendering are fetched normally.
  - The document is stored as served when the raw bytes are available; this is always the case for the start page. Otherwise the decoded text is stored as UTF-8, and the page is made to declare it: its first charset declaration is rewritten to utf-8, or a <meta charset="utf-8"> is inserted after <head> (never before the doctype).
  - A link that serves a file (non-HTML content type) is kept as an asset, as in static mode.
  - Captured bodies above `memoryBodyLimitBytes` are not adopted. The crawl fetches them with streaming if they are referenced.
  - When analyzing in JS mode, only the first `analyzeRenderPages` pages are rendered. The rest are fetched statically.
  - Render tasks use their own pool (renderConcurrency) and do not hold fetch slots. A reused start-page render counts toward analyzeRenderPages.
- **Link filter:**
  - in scope (4.1)
  - looks like a page: no extension, or `.html`, `.htm`, `.php`, `.asp`, `.aspx`
  - not `mailto:`, `tel:`, `javascript:`, `data:`, or a fragment-only link
  - not matching an exclude pattern
  - allowed by `robots.txt` (if enabled)
  - depth ≤ `maxDepth`, total pages ≤ `maxPages`
- **Normalization:** lowercase the host, strip the fragment, drop default ports, resolve `..`, keep the query string (pages with different queries are different pages).
- Redirects: the final URL is used for mapping. The original URL is recorded as an alias in the manifest.
- A page link that redirects outside the scope is skipped (it stays an online link) and counted in one warning, not as an error. An asset that redirects to an external host is skipped when `downloadExternal` is off.
- `extraSeeds` follow the normal rules (scope, robots, excludes); only their depth is 0.
- Depth is recorded from the first link that discovers a page. Under concurrency this is close to, but not strictly, breadth-first.

**Capturer contract (implemented by the desktop runtime):**
- rejects promptly when its signal aborts
- throws a FetchError for load failures
- delivers text bodies as UTF-8 with a `charset=utf-8` content type
- leaves out resource bodies above `memoryBodyLimitBytes` by setting `body` to undefined (an empty Buffer means a real empty body); prefers raw document bytes (e.g. from the CDP Fetch domain) when it can get them
- reports the document's content type, and its raw bytes when it has them
- reports `requestUrl` for redirected resources
- Desktop implementation (`src/main/capturer.ts`):
  - **Window:** one hidden `BrowserWindow` per capture.
  - **Recording:** DevTools protocol `Network` events through `NetworkRecorder`; bodies come from `Network.getResponseBody`.
  - **Document bytes:** document HTML arrives decoded (no raw bytes), so non-start pages follow the UTF-8 declaration rule. The start page keeps its raw bytes from the static seed fetch.
  - **Load sequence:** auto-scroll, then wait for network idle; the whole capture is capped by `renderTimeoutMs`.
  - **Requests:** they go through `net.request` in the job session and follow redirects manually, because `session.fetch` does not report the final URL.
  - **Main document:** it is the first Document *requested* after `Network.enable`, so an early iframe cannot replace it. If the navigation turns into a download, the document's content type is still reported and the crawl keeps the link as a file.
  - **Dialogs:** `alert`, `confirm` and `prompt` are disabled before page scripts run; any dialog that still opens is accepted through the DevTools protocol.
  - **Network idle:** long-lived connections (EventSource, WebSocket) do not count against it.
  - Header values with raw UTF-8 bytes (e.g. `Content-Disposition` filenames) are kept byte-for-byte.
  - Capture windows bypass service workers.
  - A rendered page whose body cannot be read (it redirected itself with JavaScript) is stored with the bytes the server sent.

### 4.4 Assets
- Deduplicate by normalized URL.
- Run CSS through `parse-css` recursively, which discovers fonts, background images and nested `@import`s.
- HTML ref sources:
  - `link[href]` (stylesheet, icon, apple-touch-icon, manifest, preload)
  - `script[src]`
  - `img[src|srcset]`, `source[src|srcset]`
  - `video[src|poster]`, `audio[src]`, `track[src]`, `object[data]`, `embed[src]`
  - `iframe[src]` (in scope only, treated as a page)
  - `meta[content]` for og:image
  - inline `style` `url()`, `<style>` blocks
  - `data-src`, `data-srcset`, `data-bg`, `data-background`, `data-image`, `data-lazy`
  - SVG `use[href]`
- Vendor directory names come from the host, sanitized like any path segment: `[::1]:8080` → `[__1]_8080`, `nul.example.com` → `nul_.example.com`, and a trailing dot is stripped.
- **External hosts:**
  - `downloadExternal = true` (default): download to `vendor/<host>/<path>`.
  - `downloadExternal = false`: leave absolute URLs untouched.

### 4.5 Mapping and rewriting
Mapping and rewriting run after all downloads finish, because the full URL→path map must exist first.

**Core principle:** mirror the server structure 1:1. Relative URLs inside JS (e.g. `fetch('data/x.json')`) then keep working without touching JS.

**Local root:**
- The local root is the **common ancestor** of all same-host files. Typically this is the base path (`/html/`).
- If same-host assets live above it (e.g. `/assets/`), the root moves up to cover them.
- The chosen root path is stored in the manifest as `basePath` for the preview server.

**Path mapping (`url-mapper`):**
- `/dir/` → `dir/index.html`
- extensionless path: `text/html` → `<segment>/index.html` (e.g. `/about` → `about/index.html`); other types get an extension from content-type (`image/png` → `.png`, `application/json` → `.json`, …)
- a query string is dropped: `style.css?v=2` → `style.css`
  - first URL claiming a path wins; any later *different URL* mapping to the same path (query variant or case-only difference) gets `style.__q-<hash6>.css`
- same-host files outside the local root (should not happen once the root is computed) go to `_outside/<path>`
- Windows path rules:
  - forbidden characters `: * ? " < > |` are replaced with `_`
  - reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`) get a `_` suffix
  - trailing dots and spaces are stripped
  - `.`/`..` segments and decoded `/` or `\` become `_` (no path traversal)
  - a segment over 100 characters is truncated and gets a hash
  - a relative path over 180 characters, or one whose parent directory is already taken by a file, moves to `_misc/<hash10>/<basename>`
  - case-insensitive collisions get a hash suffix (same rule as query collisions)

**Rewriting (`rewriter`):**
- HTML and CSS refs are rewritten to paths relative to the referring file.
- `srcset` is rewritten per candidate.
- Root-absolute (`/assets/x.css`) and absolute same-origin (`https://x.com/assets/x.css`) refs become relative.
- A ref whose download failed **keeps its original absolute URL**, so it still works online, and it is listed in the report.
- **Lazy-load attributes** (`data-src`, `data-bg`, …) are rewritten only when they point to a downloaded file. They are never absolutized, because they often hold non-URL values (colors, numbers).
- **`<base href>`:** only the first `base[href]` counts, as in browsers.
  - If its directory maps to a local directory, the tag is kept with a relative `href` (`./`, `../`), and all refs are rewritten relative to that directory. This keeps Angular's router working.
  - Otherwise (e.g. a cross-origin base), the `href` is removed and refs become page-relative.
- **Content type wins over a misleading extension:**
  - HTML at `release-1.2` → `release-1.2/index.html`
  - CSS from `load-styles.php` → `load-styles.css`
  - JS from `app.min` → `app.min.js`
- **CSS escapes** (`\(`, `\28 `) are decoded before resolving. Rewritten values are always written as double-quoted, escaped CSS strings.
- **Redirects:** the finalizer maps the final URL, then registers the original URL as an alias of it.
- **Mapping order:** "first claim wins", so the finalizer maps URLs in a sorted order to keep names stable across runs.

**Known limitations (accepted):**
- Comments inside a rewritten CSS declaration value are dropped.
- Case-only path collisions keep the first-seen casing on disk but suffix the later file. The mirror works on Windows and may need care on case-sensitive servers.
- These are not rewritten: `meta[http-equiv=refresh]`, `form[action]`, `[background]` attributes, `html[manifest]`, SVG `feImage`.
- A Vite-built static template (raw HTML equals rendered) scores about 0.35, which is hybrid and therefore JS mode. That is safe, just slower.
- JS files are not rewritten by default. The optional `rewriteJsAbsoluteUrls` setting replaces absolute same-origin string literals only.
- A site path that maps to `_trawler/…` would clash with Trawler's own folder (very unlikely; not handled).
- UTF-16 encoded HTML/CSS is treated as binary-safe latin1; rewriting may corrupt it (rare).
- Under `overwrite`, an old *directory* where the new mirror needs a *file* is not cleared; that file fails to be placed (rare).
- Resources loaded only by JavaScript whose bodies exceed `memoryBodyLimitBytes` are not saved unless also referenced in HTML/CSS.
- In JS mode, an extensionless or server-script link to a PDF takes up to `renderTimeoutMs` before it is recognized as a file (the PDF viewer delays the document response); the file is still saved correctly.

### 4.6 Writing
- Output folder policy when the folder is not empty: `ask` (default) → the UI asks: overwrite / merge / cancel. Other values: `overwrite`, `merge`, `fail`.
  - `overwrite` deletes only the files listed in a previous Trawler manifest in that folder that the new mirror did not reuse. It does this **only after the new download succeeded** (status `done` or `done_with_errors`). It never deletes unknown files. A failed or cancelled run deletes nothing, and the previous files stay tracked in the new manifest.
  - `merge` keeps everything (new files replace same-named ones) and keeps the previous mirror's files tracked in the new manifest.
  - The start URL is loaded **before** the output folder is touched.
  - `fail` refuses a non-empty folder.
  - The engine never resolves `ask` itself. Unresolved, it fails with "The output folder is not empty".
  - Previous files that cannot be removed under `overwrite` (locked, or now a directory) produce a warning and stay tracked. They never fail the job.
- While fetching, bodies are stored content-addressed in `<output>/_trawler/blobs/<sha1>`. The local root and final paths are only known once everything is fetched, so final placement (move, plus rewrite for HTML/CSS) happens in the finalize step. Blobs are deleted after a successful finalize.
- `_trawler/manifest.json`:

```json
{
  "trawlerVersion": "x.y.z",
  "seedUrl": "...",
  "basePath": "/html/",
  "startedAt": "...", "finishedAt": "...",
  "mode": "static|js", "detection": { },
  "settings": { },
  "status": "done|done_with_errors|cancelled|failed",
  "files": [ { "url": "...", "aliases": [], "path": "...", "status": 200,
               "contentType": "...", "bytes": 0, "kind": "page|css|js|image|font|data|other" } ],
  "errors": [ { "url": "...", "referrers": [], "reason": "..." } ]
}
```

- `_trawler/report.json` holds the verification result (4.8) and the warnings.

### 4.7 Analyze (dry-run)
- Runs detection plus the page crawl. It fetches **only HTML and CSS**: no images, fonts or JS in static mode. In JS mode it renders up to `analyzeRenderPages` pages (default 5) and estimates the rest.
- Writes nothing to disk.
- Produces an `AnalysisReport`:
  - verdict, score, frameworks and signals, each with a human-readable explanation
  - page count and list
  - asset counts by kind
  - external hosts with counts
  - warnings: bot protection, `robots.txt` disallows, iframes, map or embed widgets, page limit reached, resources likely loaded on interaction
  - recommended settings, e.g. "JS mode, renderTimeout 20 s"
- The pages and stylesheets an analysis fetched stay in memory, up to `analysisCacheMaxBytes`. The next download of the same start URL reuses them once, so they are not fetched twice. Conditions: the same user agent, and a start within `analysisCacheTtlMs`. Bodies spilled to disk are not kept. A new analysis replaces the cache, and a download frees it. In JS mode pages are still rendered again; only static fetches are reused.

### 4.8 Verification (`verifyAfterDownload`, default on)
- Start `preview-server` on the output folder.
- Load each downloaded page in a hidden window, with up to `renderConcurrency` pages at once. Record failed same-origin GET requests: beacons, CSP reports and POSTs are ignored. A same-origin redirect counts as missing.
- Report example: `111/111 pages OK, 0 missing files`, or a list of `{ page, missingUrl, status }`.

### 4.9 Preview
- `preview-server` serves the folder at `http://127.0.0.1:<port><basePath>`, so root-absolute URLs in JS keep working.
- Unknown paths without an extension fall back to the nearest `index.html` (SPA routing).
- Binds to `127.0.0.1` only. It stops when the app quits or on **Stop preview**.

---

## 5. UI

One window with a custom title bar (the UI draws it; Windows keeps its own window buttons), a narrow rail for the screens and a status bar. The look is a compact dark glass tool: soft tinted buttons and switches, thin transparent scrollbars, one accent color. Ember is the default accent; Settings > Appearance offers the theme (system, dark, light) and five more accents. The logo is a long fishing hook through `</>` brackets. The approved mockups are in `docs/mockups/`.

### A. Start screen
- URL input
- **Choose folder** (native dialog), with the chosen path shown
- Mode: `Auto` / `Static` / `JS`
- Toggle: **Download external (CDN) assets locally**
- Collapsible **Advanced** panel (section 6)
- Buttons: **Analyze** (primary) and **Download now**
- **Recent** list: the last 20 jobs (URL, folder, date, mode, counts, status), each with **Repeat**, **Open folder** and **Preview**
- First run: a short legal note with **Got it**, and a three-step welcome (Paste a link, Analyze, Download) that stays while Recent is empty.

### B. Analysis result
- Architecture badge (`STATIC` / `HYBRID` / `JS`) with framework names
- Signal list with explanations
- Pages: count + searchable read-only list
- Assets by kind, external hosts
- Warnings
- Recommended settings, editable inline
- Download settings: mode, external assets, depth, pages, concurrency and delay, editable, the recommended ones marked
- Output folder chosen on this screen
- Pages already fetched are reused by the download
- **Download with these settings**

### C. Progress
- Phase stepper: `Detecting → Crawling → Assets → Rewriting → Verifying → Done`
- Detection badge with a hover tooltip showing the signals
- Counters: pages x/y, assets, MB, errors
- Live log (virtualized) and an **Errors** tab
- **Cancel**: stops the job, keeps what was downloaded and writes a partial manifest

### D. Done
- Summary: mode, pages, assets, size, errors, verification result
- **Open folder**, **Run preview**, **Open report**
- Errors and missing files listed (the report has all)

### E. Settings
- Every setting in section 6 grouped as Download, JS mode, Application and Detection (advanced); Appearance (theme and accent) applies at once; Save sends only the changed values, Reset to defaults.

---

## 6. Settings

Every setting has a default. Only values that differ from the defaults are saved, in `userData/settings.json`. A job snapshot of the settings is stored in its manifest and history entry.

| Key | Default | Notes |
|---|---|---|
| `mode` | `auto` | `auto` / `static` / `js` |
| `downloadExternal` | `true` | external hosts → `vendor/<host>/` |
| `maxDepth` | `5` | |
| `maxPages` | `500` | |
| `concurrency` | `6` | auto-reduced on 429/503 |
| `requestTimeoutMs` | `30000` | until response headers arrive |
| `retries` | `2` | backoff 500 ms → 2000 ms |
| `requestDelayMs` | `0` | politeness delay between requests |
| `renderTimeoutMs` | `15000` | JS mode, per page |
| `networkIdleMs` | `1000` | JS mode |
| `renderConcurrency` | `2` | hidden browser windows rendering at once (JS mode) |
| `idleTimeoutMs` | `30000` | max silence while a body streams; `requestTimeoutMs` covers only the wait for response headers |
| `memoryBodyLimitBytes` | `8388608` | larger bodies stream to `_trawler/blobs` instead of memory |
| `challengeTimeoutMs` | `30000` | max time to pass a bot-protection challenge in the hidden browser |
| `autoScroll` | `true` | JS mode |
| `analyzeRenderPages` | `5` | Analyze in JS mode |
| `userAgent` | Chromium default | |
| `respectRobotsTxt` | `true` | |
| `excludePatterns` | `[]` | regex list, matched against the full URL |
| `extraSeeds` | `[]` | additional start URLs |
| `rewriteJsAbsoluteUrls` | `false` | |
| `nonEmptyFolder` | `ask` | `ask` / `overwrite` / `merge` / `fail` |
| `verifyAfterDownload` | `true` | |
| `detection.thresholds` | `{ static: 0.3, js: 0.6 }` | advanced |
| `detection.weights` | `{ emptyMount: 0.3, textRatio: 0.25, frameworkMarkers: 0.3, dataRequests: 0.1, moduleScripts: 0.05 }` | advanced; `textRatio` contributes `1 - min(ratio, 1)`, `dataRequests` saturates at 3. An SSR framework page (markers only) scores exactly 0.3 → `hybrid` → JS mode |
| `historySize` | `20` | |
| `analysisCacheTtlMs` | `1800000` | how long an analysis stays reusable by the next download of the same URL; `0` = never (spec 4.7) |
| `analysisCacheMaxBytes` | `67108864` | memory budget for the reusable analysis bodies; `0` = keep nothing |
| `shutdownTimeoutMs` | `10000` | desktop app: how long quitting waits for a running job to cancel before exiting anyway |
| `sessionResetTimeoutMs` | `15000` | desktop app: how long emptying the browser sessions before a job may take; the job starts anyway afterwards |

---

## 7. Error handling

**Network**
- Retries with backoff.
- `429`/`503` → honor `Retry-After` and halve concurrency (minimum 1). Concurrency recovers gradually.
- Bot challenge detection: a `cf-mitigated` header, or a challenge page title/markers on a 403/503. In that case, load the URL in the hidden window (same session) to pass the JS challenge, then retry the fetch with the shared cookies. If it still fails, add a warning and continue.
- Seed failure → the job status is `failed` with a clear message.
- Asset failure → keep the original URL, log it, continue. The final status is `done_with_errors`.
- Render timeout → keep what was captured and add a warning.
- `requestTimeoutMs` limits the wait for response headers. While a body streams, `idleTimeoutMs` limits the silence between chunks, so large files on slow links still finish.
- Bodies above `memoryBodyLimitBytes` stream straight to `_trawler/blobs`.
- When the crawl halts on a fatal error, requests already in flight are aborted at once.
- Under `overwrite`, a previous-mirror file that sits where the new mirror needs a directory is removed first.

**Disk**
- Path sanitization and collisions are handled in `url-mapper` (4.5).
- Disk full or permission denied → abort and write the partial manifest.

**Cancellation**
- One `AbortController` per job is passed to every fetch and capture.
- Hidden windows are destroyed and the partial manifest is written. The status is `cancelled`.

**Process**
- A job error never crashes the app. The job moves to the `failed` state with its error.

---

## 8. Security

- Hidden windows run with:
  - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload
  - a fresh in-memory session partition per job
- In hidden windows, downloads, popups (`setWindowOpenHandler` → deny), permission requests and navigation outside the job scope are blocked.
- The app never executes downloaded files outside a sandboxed hidden window.
- The preview server binds only to `127.0.0.1`.
- The renderer UI runs with `contextIsolation` and a minimal preload exposing only the typed IPC API.
- Content Security Policy on the UI.
- Electron fuses of the packaged exe (`electronFuses` in `electron-builder.yml`): it cannot run as plain Node (`runAsNode` and `NODE_OPTIONS` are off), it loads only from `app.asar` with integrity validation, and cookie encryption is on. The inspect switch stays on because the packaged E2E (Playwright) needs it, and `file:` privileges stay on because the UI loads its module scripts from `file:`.
- Implemented by `src/main/job-session.ts`:
  - each job uses `session.fromPartition('trawler-<uuid>')`, an in-memory partition
  - permission requests are denied, and only local-network permission checks are allowed (pages load from 127.0.0.1)
  - downloads are cancelled
- Capture windows also block cross-origin navigations (`will-navigate`) and popups.
- Verification uses its own clean session.
- Without a configured user agent, sessions use Chromium's own: the `Electron/…` and app tokens are removed.
- Headless CLI runs use a throwaway profile (with a pid file, so a running job's profile is never swept), so they never touch the desktop app's profile.
- The main window runs with `sandbox`, `contextIsolation`, no Node integration, popups denied and navigation blocked. The default session denies all permission requests.
- IPC commands are answered only for Trawler's own UI page. The sender must be the app window, and the sender frame's `file:` URL, decoded to a path, must lie inside the built UI folder. Paths are compared, not URL strings, because Node and Chromium encode `~ [ ]` differently. Every argument is validated in the main process:
  - Paths must be absolute local paths. UNC and device paths (`\\host\share`, `\\?\…`) are refused.
  - **Open folder** opens only existing directories.
  - **Open report** opens only `<folder>/_trawler/report.json`.
  - **Open preview** opens only the URL of the preview Trawler itself is running.
- The preload is a single bundled file whose only import is `electron`.

---

## 9. Testing

**Unit (Vitest)**
- `url-mapper`: the largest suite. It covers Windows names and characters, long paths, query collisions, case collisions, extensionless URLs and external hosts.
- `parse-html`: every ref source listed in 4.4.
- `parse-css`: `url()` variants (quoted, unquoted, escaped), `@import`, `image-set`, `@font-face`.
- `rewriter`: relative path computation, `srcset`, failed-asset passthrough.
- `crawler`: scope, link filter, normalization, limits, `robots.txt`.
- `detector`: score and verdict from fixture signal sets.

**Integration**
- A local fixture HTTP server with three sites:
  1. **static**: multi-page, icon fonts loaded via CSS, `srcset`, `data-bg`, query-string assets, assets above the base path, a redirect
  2. **external-host**: a second port standing in for a CDN (exercises `downloadExternal` on and off)
  3. **spa**: vanilla JS router, a lazy chunk, a JSON fetch, an empty `#app` mount
- Each site runs a full analyze and download job in Electron. The tests assert the folder structure, the rewritten refs, the manifest and **verification = 0 missing files**.

**E2E (Playwright `_electron`)**
- Analyze → result screen → download → done
- Cancel mid-job
- Preview starts and serves
- The same API-level checks run against the packaged app (`npm run test:packaged`): it is the packaged build, the UI passes the trust check inside `app.asar`, a static and a JS-mode job complete.

**Manual**
- Free templates (e.g. HTML5 UP), with the owner's go-ahead per site.

---

## 10. Out of scope / future
- Page selection with checkboxes before download.
- Interaction scripts (click and hover recording) to capture interaction-loaded assets.
- Resuming an interrupted download.
- macOS and Linux builds. The code stays cross-platform, but only Windows is packaged and tested initially.
- Unminify or beautify passes.
