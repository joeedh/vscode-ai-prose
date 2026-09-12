# Plan: initial build of ai-prose

Builds the tool described in req.md to the design in docs/ux-design.md. Each
wave ends with its tests passing and a commit. Waves 2 through 4 have no UI
and no host, so they can be verified with unit tests alone. The plan was
pressure-tested on 2026-09-12; the revisions are listed at the end.

## Decisions fixed by this plan

- One package, one repo. Folders under `src/` separate the layers. No pnpm
  workspace, because the layers share one `node_modules` and one esbuild
  script.
- `src/core/` is Node-only and imports neither `vscode` nor `electron`.
  The two hosts adapt to it through the `Host` interface below.
- The UI is Preact with TSX, bundled by esbuild to one `dist/ui.js` and one
  `dist/ui.css`. Both hosts load the same two files. Preact is chosen over
  vanilla DOM because the transcript, streaming text, and the pending edit
  card are all state that re-renders, and over React for bundle size inside
  a webview.
- Fonts ship as woff2 under `media/fonts/` from the `@fontsource-variable/
  literata`, `@fontsource/ibm-plex-sans`, and `@fontsource/ibm-plex-mono`
  packages, with their OFL licence files, referenced through `@font-face`.
  The webview CSP forbids a font host. The Literata file must keep the
  `opsz` axis. The mockup loads Google Fonts and is not the reference for
  the bundled setup.
- Core and UI tests run under vitest, placed next to their modules as
  `src/**/*.test.ts` and `.test.tsx`. Extension tests keep the template's
  `@vscode/test-cli` runner and live under `src/test/vscode/`. Playwright
  suites live under `test/electron/` with their own tsconfig, and the root
  tsconfig gets `include: ["src"]` so they stay outside `rootDir`.
- Model calls go through OpenRouter's chat completions endpoint with
  `stream: true` and OpenAI-style tool calling. Usage and cost arrive in
  the final stream chunk with no request option; the old `usage.include`
  option is deprecated and does nothing.
- The model list comes from OpenRouter's models endpoint at runtime,
  filtered to ids without a `:variant` suffix that carry `tools` in
  `supported_parameters`, grouped as `anthropic/*`, `google/gemini-*`, and
  `z-ai/glm-5.3-flash`, with the Other option for a typed id.
- Prompt caching means one explicit `cache_control: { type: "ephemeral" }`
  breakpoint on the system text part and OpenRouter's top-level
  `cache_control` request option for the moving breakpoint, which the
  service places on the last cacheable block. Explicit breakpoints are never
  placed on `tool` messages. Wave 3 confirms both against the current docs
  before the fake server is written.
- The VS Code surface is a webview view contributed to the bottom panel
  container, so it opens as a horizontal pane beside Terminal and Problems
  and the user can drag it elsewhere. It is not an editor-column panel.
- The write tool blocks until the user accepts or rejects. The tool result
  tells the model which happened. Stop rejects any pending write and aborts
  the turn.
- The default system prompt tells the model to write each paragraph as one
  line and to leave wrapping to the tool. Restore keeps every line break the
  model produces and only splits lines longer than the width. It never
  joins lines, so list items, `@param` lines, and intended hard breaks
  survive.
- The wrap width is the longest line of the original block, never below 60
  columns and never above 100. The setting `aiProse.wrapColumn` overrides
  it with a fixed column. Markdown paragraphs whose original longest line
  exceeds 100 columns are treated as soft-wrapped and are never split.
- The base URL is `https://openrouter.ai/api/v1` unless the environment
  variable `AIPROSE_BASE_URL` or the setting `aiProse.baseUrl` says
  otherwise. Tests point it at the fake server.

## Architecture

```
src/
  core/
    units/        unit detection, strip and restore of comment syntax, rewrap
    llm/          OpenRouter client, SSE parsing, tool-call assembly, caching
    agent/        agent loop, tools, pending-write gate
    threads/      transcript store under ~/.aiprose/transcripts
    prose-md.ts   upward search for PROSE.md
    host.ts       Host interface
    protocol.ts   messages between host and UI
  ui/             Preact app, one entry, styles from the mockup, own tsconfig
  vscode/         extension entry, webview view provider, VS Code Host
  electron/       main, preload, renderer shell with the file pane, Electron Host
  test/
    fake-openrouter.ts
    fixtures/
    vscode/       @vscode/test-cli suites (compiled to out/test/vscode)
test/
  electron/       Playwright suites for the shell, own tsconfig
media/fonts/
```

### Host interface

```ts
interface Host {
  document(): Promise<{ path: string; languageId: string; text: string }>;
  cursor(): Promise<{ line: number; character: number }>;
  applyEdit(range: LineRange, text: string): Promise<void>;
  secret(name: string): Promise<string | undefined>;
  setSecret(name: string, value: string): Promise<void>;
  config(): Promise<{ model: string; systemPrompt: string; wrapColumn?: number; baseUrl: string }>;
  setConfig(patch: Partial<Config>): Promise<void>;
  clipboardWrite(text: string): Promise<void>;
  openFix(kind: "apiKey" | "newThread"): Promise<void>;
  homeDir(): string;
}
```

- VS Code implements it over the active text editor, `WorkspaceEdit`,
  `SecretStorage`, the `aiProse.*` settings, `env.clipboard`, and commands.
- Electron implements it over the file loaded in the shell's file pane, a
  direct write to disk, `<profile>/secrets.json`, `<profile>/settings.json`
  for model and system prompt, and Electron's `clipboard`.

### Protocol

- Host to UI: `threadLoaded` (thread header, mode, model, system prompt,
  PROSE.md path or the directory the search started from), `galley`,
  `messageDelta`, `activity`, `editProposed`, `editResolved`, `usage`,
  `error`, `threads` (grouped: current file first, then other files),
  `models`.
- UI to host: `send`, `stop`, `acceptEdit`, `rejectEdit`, `newThread`,
  `openThread`, `setModel`, `setMode` (starts a new thread), `setSystemPrompt`,
  `copy`, `openFix`.
- One TypeScript union per direction in `protocol.ts`. Both hosts and the UI
  import it, so a renamed message fails the typecheck everywhere.

### Agent loop

- Builds messages: system content, then the thread's stored messages.
- System content is, in order: the user's system prompt, the PROSE.md text
  under a "Style guide" heading, and a line stating the mode and the wrap
  width. The tool definitions are sent in the `tools` field. This order
  keeps the cached prefix identical across turns in a thread.
- Tools:
  - `read_text` returns the block in Strict mode. In File mode it returns
    the whole file with line numbers.
  - `get_edit_range` returns the unit's start and end lines, its kind, and
    its current text with syntax stripped.
  - `write_text` takes the replacement prose. The loop restores syntax,
    posts `editProposed` to the UI, and awaits the user's answer. Accepted
    writes go through `Host.applyEdit` and update the unit's range and
    text. The result is `{ status: "accepted" | "rejected" }`.
- After an accepted write, `get_edit_range` reports the new range so a
  second write in the same turn targets the right lines.
- A tool call outside the valid range cannot happen because the tools take
  no range argument. The range is fixed by the thread.
- The pending-write gate is also reachable through a host-level
  `resolvePendingEdit(status)` call, so extension tests can accept or reject
  without clicking inside the webview.

### Unit detection

- A comment table keyed by language id: line marker and block delimiters.
  `//` and `/* */` for ts, js, tsx, jsx, c, cpp, h, java, cs, go, rust,
  swift, kotlin, scala, php. `/* */` only for css, scss, less. `#` for py,
  rb, sh, bash, zsh, yaml, toml, perl, r, makefile, dockerfile. `#` and
  `<# #>` for powershell. `--` and `--[[ ]]` for lua. `--` and `{- -}` for
  haskell. `--` for sql. Unknown ids fall back to the file extension, then
  to no comment support with the error "No comment syntax known for this
  file".
- Line runs: from the cursor line, extend up and down while the trimmed
  line starts with the marker. A blank line or a non-comment line ends the
  run. A line holding only the marker stays in the run and becomes an empty
  line after stripping, which the model sees as a paragraph break. A
  shebang on line 1 is never part of a run.
- Comment markers inside strings are not detected. A `#` line inside a
  Python triple-quoted string is treated as a comment. This is a known
  limitation and docs/debugging.md records it.
- Block comments: find the nearest opener before the cursor whose matching
  closer is at or after it. The unit is that span. Doc comments starting
  with `/**` are the same unit kind.
- Markdown:
  - A paragraph is a run of non-blank lines that are not headings, list
    items, fences, tables, or indented code.
  - A list item is one item at its own indent, including its wrapped
    lines. A nested item is its own unit.
  - An ATX heading is one line. A setext heading is the text line plus its
    underline, and the underline is preserved on restore.
  - A blockquote paragraph is a paragraph whose lines carry a `> ` prefix,
    which strip records like a comment marker.
  - Backtick and tilde fences, indented code blocks, front matter, and
    table rows are not units. The errors are "The cursor is in a code
    block", "The cursor is in front matter", and "The cursor is in a
    table".
- Strip records per line the leading whitespace and the marker text, so
  `  // ` and `   * ` are restored exactly. A block comment records its
  opener and closer lines separately. The canonical body prefix for lines
  that did not exist before is the second line's prefix for a block comment
  with a gutter, otherwise the first line's. Surplus prefixes from a
  shrinking block are dropped.
- Restore takes the model's text line by line, splits any line longer than
  the width minus the prefix length at word boundaries, and reattaches the
  prefix. A continuation of a line that starts with a list marker (`-`,
  `*`, or a number and a period) is indented by the marker's width.

### Transcripts

- One JSON file per thread at `~/.aiprose/transcripts/<id>.json` where the
  id is a timestamp plus a short random suffix, so directory order is
  creation order. The home directory comes from `Host.homeDir`, never from
  a literal `~`.
- Fields: id, title, createdAt, updatedAt, filePath, languageId, mode,
  model, systemPrompt (the full resolved text sent to the model),
  proseMdPath, unit (range, kind, original text), messages (the OpenAI
  format array, including tool calls and results), usage totals, and the
  list of resolved edits with their status and final text.
- The store lists threads by reading the directory and parsing only the
  header fields, so a long history stays cheap to open.
- Resume re-detects the unit at the stored range and compares the text to
  the stored original. A mismatch shows the "block changed on disk" error
  and offers a new thread.

### PROSE.md lookup

- Walk from the file's directory to the filesystem root. The first file
  named `PROSE.md` (case-insensitive) wins. Cache the result per thread; a
  new thread looks again.

## Waves

### Wave 1: scaffold

- Move `src/extension.ts` to `src/vscode/extension.ts`. Delete the hello
  world command.
- Rewrite `esbuild.js` as three contexts in one script: the extension
  (cjs, node, external vscode, `dist/extension.js`), the Electron main and
  preload (cjs, node, external electron, `dist/electron/`), and the UI
  (esm, browser, `jsx: "automatic"`, `jsxImportSource: "preact"`, outdir
  `dist/` so the imported CSS lands at `dist/ui.css`). The Electron entry
  is always started explicitly with `electron dist/electron/main.js`, since
  `package.json` `main` must keep pointing at the extension bundle.
- Add `src/ui/tsconfig.json` with `lib: ["ES2022", "DOM"]`,
  `jsx: "react-jsx"`, and `jsxImportSource: "preact"`. Add
  `test/electron/tsconfig.json`. Set the root tsconfig `include` to
  `["src"]` and `exclude` to `["src/ui"]`. Make `check-types` run all
  three. Add `**/*.tsx` to the eslint `files` list.
- Add preact as a dependency and vitest, jsdom, electron, playwright, and
  `@playwright/test` as dev dependencies. Add `pnpm.onlyBuiltDependencies`
  with `electron` and `esbuild`, because pnpm 10 skips install scripts by
  default and Electron's binary never downloads without it.
- Narrow the `.vscode-test.mjs` glob to `out/test/vscode/**/*.test.js`.
- Add `pnpm test:core` (vitest), `pnpm test:vscode` (vscode-test),
  `pnpm test:electron` (playwright), `pnpm test:live` (the opt-in smoke
  test from wave 3), and `pnpm test` running the first three.
- Add `package.json` contributions: the `aiProse` panel view container, a
  view entry with `"type": "webview"` (without it `resolveWebviewView` is
  never called), commands `ai-prose.open`, `ai-prose.newThread`,
  `ai-prose.setApiKey`, and settings `aiProse.defaultModel`,
  `aiProse.systemPrompt`, `aiProse.wrapColumn`, `aiProse.baseUrl`.
- Copy the woff2 files and licences from the fontsource packages into
  `media/fonts/`.
- Done when `pnpm compile` builds all four bundles and `pnpm test:core`
  runs an empty suite.

### Wave 2: units

- Implement the comment table, run and block detection, markdown units,
  strip, restore, and rewrap in `src/core/units/`.
- Tests are table-driven over fixture files in `src/test/fixtures/units/`:
  each fixture is a source file plus a JSON list of cursor positions and
  the expected unit range, kind, stripped text, and a round-trip check
  that restore(strip(x)) equals x when the prose is unchanged.
- Cover: `//` runs separated by a blank line, a run ending at code, `/* */`
  with and without the `*` gutter, `/** */`, `#` with a shebang on line 1,
  indented comments, tabs, CRLF files, a block that grows by two lines on
  restore, a block that shrinks to one line, a list inside a comment, a
  markdown paragraph, a soft-wrapped markdown paragraph on one long line, a
  list item with a wrapped line, a nested list item, an ATX heading, a
  setext heading, a blockquote paragraph, a backtick fence, a tilde fence,
  indented code, front matter, and a table row.
- Done when the fixtures pass and the round-trip holds on every fixture.

### Wave 3: OpenRouter client

- Before writing code, re-read OpenRouter's prompt caching, streaming, and
  usage accounting pages and record the exact request and response shapes
  in docs/debugging.md. The fake server encodes those shapes, so a wrong
  reading here would make every later test pass against the wrong thing.
- Implement `src/core/llm/`: request building with the two cache
  breakpoints, SSE parsing into text deltas and assembled tool calls, abort
  through `AbortSignal`, and error mapping. The parser skips SSE comment
  lines (OpenRouter sends `: OPENROUTER PROCESSING` keep-alives), accepts
  the final usage chunk that repeats `finish_reason` with an empty delta,
  and treats a 200 chunk carrying a top-level `error` as a failure.
- Error messages, all also written into docs/ux-design.md:
  - 401: "OpenRouter rejected the key. Set a new one." with the fix
    opening the key command.
  - 402: "The OpenRouter account has no credit."
  - 429: "OpenRouter is rate limiting this key. Try again in a moment."
  - 5xx and mid-stream errors: "OpenRouter failed mid-reply. Send again."
  - Network failure: "Could not reach OpenRouter."
- Implement the model list fetch with the filter from the decisions and a
  one-hour cache on disk under `~/.aiprose/models.json`.
- Build a fake OpenRouter server in `src/test/fake-openrouter.ts`: an HTTP
  server on a free port that replays scripted SSE responses from a test
  and records the requests it received. It always emits keep-alive
  comments, the trailing usage chunk, and `[DONE]`. Every test that needs
  a model uses it.
- A live smoke test, skipped unless `keys/openrouter.txt` exists, sends one
  short turn to `z-ai/glm-5.3-flash` and checks that a text reply and a
  usage block come back. It runs under `pnpm test:live`, not under
  `pnpm test`, and never uses another model.
- Tests: a streamed text reply, a streamed tool call split across chunks,
  two tool calls in one turn, an abort mid-stream, each error code, a
  mid-stream error chunk, the cache breakpoint placement on a three-turn
  conversation including a tool round, and usage parsing with cached
  tokens and cost present and absent.
- Done when the client passes those tests against the fake server.

### Wave 4: agent, threads, PROSE.md

- Implement the agent loop, the three tools, the pending-write gate with
  `resolvePendingEdit`, the transcript store, and the PROSE.md search.
- The agent takes a `Host`, a thread, and an event sink. It emits protocol
  messages and never touches a transport, so it is tested with an in-memory
  host and the fake server.
- Tests: a full turn ending in an accepted write updates the file through
  the host and the transcript on disk; a rejected write leaves the file
  unchanged and stores the final text; Stop during a pending write aborts
  and rejects it; a second write after an accepted one targets the new
  range; File mode returns the whole file from `read_text` and still limits
  writes to the unit; resume with a changed block raises the error; PROSE.md
  two directories up is found and lands in the system content after the
  user prompt; a thread's title is the first user message trimmed to 60
  characters; `setMode` produces a new thread id.
- Done when those tests pass with no host code involved.

### Wave 5: UI

- Build the Preact app from the mockup: toolbar, galley, transcript,
  proposed edit card with the Preview and Diff toggle, rejected edit card,
  accepted edit line, composer, usage line, system prompt sheet with the
  PROSE.md path, error block with its fix link, empty state.
- No string `style` attributes anywhere. The webview CSP allows CSSOM
  writes from Preact style objects and the bundled stylesheet, and blocks
  inline style strings.
- The app talks to a `Transport` with `post(msg)` and `onMessage(cb)`. The
  VS Code transport wraps `acquireVsCodeApi`. The Electron transport wraps
  the preload bridge. A test transport is an in-memory pair.
- Theme: tokens from the mockup on `:root`; the dark set applies under
  `prefers-color-scheme: dark`, under `:root[data-theme="dark"]`, and under
  `body.vscode-dark` and `body.vscode-high-contrast`. The light set applies
  under `body.vscode-light` and `body.vscode-high-contrast-light`, which
  must come after the high-contrast rule because a high-contrast-light
  body carries both classes.
- Tests under vitest with jsdom: render each state from a protocol message
  and assert the DOM; the Preview and Diff toggle; Enter sends and
  Shift+Enter inserts a newline; Enter on a focused edit card accepts and
  Escape rejects; the rejected card's Copy posts `copy`; the error block's
  link posts `openFix`.
- Done when the app renders every state in the design doc with the test
  transport and the tests pass.

### Wave 6: Electron shell

- `src/electron/main.ts`:
  - Resolves the profile directory to `~/.aiprose/electron-profile`, or to
    `AIPROSE_PROFILE_DIR` when set, creates it with `mkdirSync` recursive
    (Electron throws on a missing directory), then calls
    `app.setPath("userData", dir)` before `ready`. The default profile is
    never used.
  - Appends `remote-debugging-port` with the value of `AIPROSE_CDP_PORT`,
    default 9337, before `ready`. The port is never 9222. Playwright's
    launcher passes `--remote-debugging-port=0` of its own; the later
    `appendSwitch` wins in Chromium's switch map, and the wave 6 test
    proves it by fetching `/json/version` on the chosen port.
  - Opens one window: file pane on the left, the UI on the right, matching
    the mockup's shell view. A file path on the command line loads that
    file; otherwise File > Open.
  - Implements `Host` over the loaded file and the profile directory.
- `src/electron/preload.ts` exposes `post` and `onMessage` through
  `contextBridge`. Node integration stays off in the renderer.
- The file pane is read-only in this wave. Clicking a line moves the cursor
  and marks the unit with the pencil rule.
- Playwright suites in `test/electron/`:
  - A fixture launches the shell with `_electron.launch`, a temp profile
    directory named `aiprose-test-<random>` under the OS temp dir, a free
    CDP port, and the fake OpenRouter server's URL in `AIPROSE_BASE_URL`.
  - The fixture's teardown closes the app, waits for the child process
    `exit` event, and then removes the temp profile with
    `fs.rm(dir, { recursive: true, force: true, maxRetries: 10,
    retryDelay: 200 })`, because Chromium holds handles on the profile for
    a moment after the window closes on Windows. Teardown runs in
    `finally`, so a failing or throwing test still cleans up. The suite's
    global teardown sweeps any `aiprose-test-*` directories left in the
    temp dir by a killed run.
  - Tests: the shell starts with the given profile and Playwright can
    fetch `/json/version` on the chosen port; opening a fixture file and
    clicking a comment line shows the galley; a scripted turn proposes an
    edit, Accept writes the file, and the transcript exists; Reject leaves
    the file alone and shows the rejected card; the theme follows
    `page.emulateMedia({ colorScheme })` for both values.
- Pin the Electron and Playwright versions together. Playwright's Electron
  support is experimental and its `--remote-debugging-port=0` argument was
  rejected by some Electron 30-era releases (Playwright issue 39008).
- Done when `pnpm test:electron` passes and leaves no directory behind.

### Wave 7: VS Code integration

- `src/vscode/`:
  - `WebviewViewProvider` for the panel view with
    `retainContextWhenHidden` so a hidden panel keeps its thread.
  - CSP with a nonce for the script, `style-src ${webview.cspSource}` for
    the stylesheet, `font-src ${webview.cspSource}` for the fonts, and
    `localResourceRoots` set to `dist/` and `media/`.
  - `Host` over the active editor. `applyEdit` uses one `WorkspaceEdit` so
    the edit is one undo step. A closed editor fails the write with the
    "editor closed" error. `config()` reads the `aiProse.*` settings and
    honors `AIPROSE_BASE_URL` when set.
  - `ai-prose.open` reveals the view and starts a thread from the cursor if
    none is open. `ai-prose.newThread` always starts one.
    `ai-prose.setApiKey` prompts with a password input and stores the key
    in `SecretStorage`. A hidden command `ai-prose._resolvePendingEdit`
    calls the gate for tests.
- Extension tests under `src/test/vscode/` with `@vscode/test-cli`:
  - The config passes `launchArgs` with `--user-data-dir` pointing at a
    temp directory and `--remote-debugging-port` set to a free non-standard
    port, and `env` with `AIPROSE_BASE_URL` for the fake server. Teardown
    deletes the directory in `finally` with the same retrying `fs.rm`.
  - Tests: the view registers and resolves; opening a fixture file and
    running `ai-prose.open` posts a `galley` message with the right range;
    a scripted turn plus `ai-prose._resolvePendingEdit("accepted")` changes
    the document and one undo restores it; the key command stores into
    `SecretStorage`.
  - A CDP smoke test connects Playwright with `connectOverCDP` to the port,
    takes the first page of the first context (the workbench), and reaches
    the webview through `frameLocator("iframe.webview.ready")` then
    `frameLocator("#active-frame")`, since webviews are nested iframes in
    the workbench page rather than separate targets. It reads the galley
    text. The selectors are the one unverified claim in this wave and are
    checked first.
- Done when `pnpm test:vscode` passes and the extension runs from F5.

### Wave 8: documentation and cleanup

- `docs/debugging.md`: how to run each host with the fake server, where
  transcripts and the profile live, how to attach over CDP to each host,
  the request and response shapes recorded in wave 3, the string-comment
  limitation, and the failure modes found during the waves.
- README: install, set the key, open the panel, the two modes, PROSE.md.
- Remove every `CLAUDENOTE:` comment. Run `pnpm compile` and `pnpm test`.

## Risks

- Prompt caching may cache nothing on short prompts. Anthropic's minimum
  cacheable prefix is over a thousand tokens on most models, and a short
  system prompt plus a short PROSE.md may fall under it. The usage line
  will show 0% from cache in that case. This is expected behavior, not a
  bug, and docs/debugging.md will say so.
- Playwright's Electron support tracks specific Electron versions. Pin
  both and check the compatibility note in Playwright's release notes when
  either is bumped.
- VS Code webview views in the panel area do not support editor-style
  tabs. If the user wants several threads visible at once, that is a
  future change to an editor-column panel, not a tweak.
- Splitting an over-long line changes only that line, but a model that
  ignores the "one line per paragraph" instruction and pre-wraps at a
  narrower width produces ragged comments. The Diff view makes this
  visible before accepting.

## Out of scope for this plan

- Editing the file pane in the Electron shell.
- Following the cursor to a new block inside an open thread.
- Multiple simultaneous threads.
- Providers other than OpenRouter.
- Comment markers inside string literals.

## Revisions from the pressure test

- Dropped the deprecated `usage.include` option; usage always arrives.
- Moved test suites so nothing outside `rootDir` is compiled and the
  test-cli glob cannot sweep up vitest files.
- Added the UI tsconfig, JSX settings, and TSX linting.
- Added `aiProse.baseUrl`, `AIPROSE_BASE_URL`, and the hidden
  `_resolvePendingEdit` command so wave 7 is testable.
- Wrote the five error messages and pointed the key fix at the command.
- Replaced paragraph refilling with line splitting so lists and hard breaks
  survive, and exempted soft-wrapped markdown.
- Defined the body prefix for new lines and added grow and shrink fixtures.
- Added `pnpm.onlyBuiltDependencies` for Electron and esbuild.
- Added `"type": "webview"` to the view entry and `font-src` and
  `style-src` to the CSP.
- Tightened the model filter to tool-capable ids without variants.
- Rewrote the CDP smoke test around nested iframes.
- Made the wave 6 test assert the CDP port and noted Playwright's own port
  argument.
- Added `mkdirSync` before `setPath` and a retrying `fs.rm` after exit.
- Extended `Host` with config, clipboard, and fix-link methods.
- Moved the second cache breakpoint to the top-level option.
- Decided the shebang, block delimiters for four more languages, and every
  markdown structure the first draft left open.
- Made the fake server emit keep-alive comments and the trailing usage
  chunk.
- Added `vscode-high-contrast-light` to the light theme set.
- Switched font sourcing to the fontsource packages.
- Split the esbuild script into three contexts.
- Added the PROSE.md path to `threadLoaded`, the new-thread rule to
  `setMode`, and `emulateMedia` for the theme test.
