# Debugging guide

Running notes on how the pieces behave in practice.

## Running each host against the fake server

- `startFakeOpenRouter()` in src/test/fake-openrouter.ts serves a scripted
  reply per chat request on a free port and records every request. Set
  `AIPROSE_BASE_URL` to its url and any non-empty key passes.
- Electron: `AIPROSE_BASE_URL=<url> AIPROSE_PROFILE_DIR=<dir> pnpm electron
  <file>`. The Playwright fixture in test/electron/shell-fixture.ts does
  exactly this with a temp profile.
- VS Code: the extension host reads `process.env.AIPROSE_BASE_URL` on each
  `config()` call, so a test can set it after activation. From F5, set it in
  the launch configuration's `env`.
- Core only: build a `Session` with an in-memory `Host`, as
  src/core/agent/session.test.ts does.

## Where things live

- Transcripts: `<home>/.aiprose/transcripts/<id>.json`, where `<home>` is
  `AIPROSE_HOME` or the home directory. Line 1 holds the header so listing
  never parses the messages.
- Model cache: `<home>/.aiprose/models.json`, refreshed after an hour.
- Electron profile: `AIPROSE_PROFILE_DIR` or `~/.aiprose/electron-profile`,
  holding Chromium's data plus `secrets.json` and `settings.json`.
- VS Code key: SecretStorage under `openrouterApiKey`. Settings: `aiProse.*`.

## Attaching over CDP

- Electron listens on `AIPROSE_CDP_PORT` (default 9337). Fetch
  `http://127.0.0.1:<port>/json/version` to confirm, or connect Playwright
  with `chromium.connectOverCDP`. The profile's `DevToolsActivePort` file
  names the port actually in use.
- VS Code needs `--remote-debugging-port=<port>` on its command line; the
  test runner passes it. The webview is a separate `iframe` target on
  `/json`; see the VS Code section below.
- Never use 9222 for either host, so a stray browser session never attaches.

## Unit detection limits

- Comment markers inside string literals are read as comments. A `#` or
  `//` in a string on its own line starts a run. The fixture
  src/test/fixtures/units/hash.py records this as a known limitation.
- A `*`-led list bullet inside a block comment without a gutter is read as a
  gutter.
- A nested markdown list item indented four spaces after a blank line is
  read as indented code.
- Tabs count as one column when deriving the wrap width.
- Headings never wrap. A markdown paragraph whose longest line is over 100
  columns is treated as soft-wrapped and never split unless
  `aiProse.wrapColumn` is set. `Unit.width` of 0 means never split.
- Restore keeps every line break the model produces and only splits lines
  longer than the width. A model that pre-wraps at a narrower width yields
  ragged comments; the Diff view shows it before accepting.

## Prompt caching shows 0% on short threads

Anthropic's minimum cacheable prefix is over a thousand tokens on most
models. A short system prompt plus a short PROSE.md falls under it, so the
usage line reads 0% from cache until the thread grows. This is expected.

## OpenRouter request and response shapes

Recorded from the OpenRouter docs and a live fetch of the models endpoint
on 2026-09-12. The fake server in src/test/fake-openrouter.ts encodes
these shapes, so a change here needs a matching change there.

### Chat request

- `POST <baseUrl>/chat/completions` with `Authorization: Bearer <key>`,
  `Content-Type: application/json`, and the optional `HTTP-Referer` and
  `X-Title` headers OpenRouter uses for attribution.
- Body fields the client sends: `model`, `stream: true`, `messages`,
  `tools` (omitted when empty), and a top-level
  `cache_control: { "type": "ephemeral" }`.
- `usage: { include: true }` and `stream_options: { include_usage: true }`
  are deprecated and have no effect. Usage is always included.

### Prompt caching

- Two mechanisms exist and the client uses both:
  - A top-level `"cache_control": { "type": "ephemeral" }` on the request.
    OpenRouter documents it as Anthropic automatic caching: the service
    places the breakpoint on the last cacheable block itself, so it moves
    forward as the conversation grows.
  - An explicit `cache_control` on a text content part. The client places
    exactly one, on the system message's single text part, so the system
    prompt plus PROSE.md is a stable cached prefix.
- The system message must use the array form for the part-level
  breakpoint: `{ "role": "system", "content": [{ "type": "text", "text":
  "...", "cache_control": { "type": "ephemeral" } }] }`.
- Anthropic allows four explicit breakpoints per request. Explicit
  breakpoints are never placed on `tool` messages.
- Anthropic's minimum cacheable prefix is 1,024 tokens on Sonnet 4.x and
  Opus 4.0 and 4.1, 2,048 on Haiku 3.5, and 4,096 on the Opus 4.5 and later
  and Haiku 4.5 lines. A short system prompt plus a short PROSE.md caches
  nothing, and the usage line shows 0% from cache. That is expected.
- Cache metrics arrive in `usage.prompt_tokens_details.cached_tokens` and
  `usage.prompt_tokens_details.cache_write_tokens`.

### Streaming

- The body is Server-Sent Events. Each event is `data: <json>` followed by
  a blank line.
- Comment lines start with a colon, such as `: OPENROUTER PROCESSING`, and
  are keep-alives to skip.
- The stream ends with `data: [DONE]`.
- A content chunk:

  ```json
  {"choices":[{"index":0,"delta":{"role":"assistant","content":"text"},"finish_reason":null}]}
  ```

- Tool call deltas arrive in `delta.tool_calls[]` with `index`, and on the
  first fragment `id`, `type: "function"`, and `function.name`. Later
  fragments for the same `index` carry only `function.arguments` pieces,
  which concatenate into one JSON string. The finish reason for a turn that
  requested tools is `"tool_calls"`.
- The final chunk repeats `finish_reason` with an empty delta and carries
  `usage`:

  ```json
  {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"cost":0.0004,"prompt_tokens_details":{"cached_tokens":80,"cache_write_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}
  ```

  OpenRouter documents the content-free delta as a deliberate deviation from
  OpenAI so clients that index `choices[0]` do not crash.
- A mid-stream failure arrives with HTTP status 200, because headers were
  already sent, as an event with a top-level `error`:

  ```json
  {"error":{"code":"server_error","message":"Provider disconnected unexpectedly"},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}
  ```

  The stream terminates after that event.

### Usage object

- `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (USD
  credits), `cost_details.upstream_inference_cost`,
  `prompt_tokens_details.cached_tokens`,
  `prompt_tokens_details.cache_write_tokens`,
  `completion_tokens_details.reasoning_tokens`.
- The client reads `prompt_tokens`, `completion_tokens`,
  `prompt_tokens_details.cached_tokens`, and `cost`, and treats a missing
  field as zero.

### Error statuses

- Non-200 responses carry `{"error":{"code":<number|string>,"message":"..."}}`.
- The client maps 401 to "OpenRouter rejected the key. Set a new one."
  with the set-key fix, 402 to "The OpenRouter account has no credit.",
  429 to "OpenRouter is rate limiting this key. Try again in a moment.",
  5xx and mid-stream errors to "OpenRouter failed mid-reply. Send again.",
  and a thrown `fetch` to "Could not reach OpenRouter." Other 4xx statuses
  show the message from the body.

### Tool calling

- Request: `tools: [{ "type": "function", "function": { "name", "description", "parameters": <JSON schema> } }]`.
- Assistant message: `{ "role": "assistant", "content": null, "tool_calls": [{ "id", "type": "function", "function": { "name", "arguments": "<json string>" } }] }`.
- Tool result: `{ "role": "tool", "tool_call_id": "<id>", "content": "<string>" }`.
- Models that accept tools list `"tools"` in `supported_parameters`.

### Models endpoint

- `GET <baseUrl>/models` needs no authentication. The response is
  `{ "data": [ ... ] }`.
- Fields per entry: `id`, `canonical_slug`, `name`, `created`,
  `description`, `context_length`, `architecture`, `pricing`,
  `top_provider`, `per_request_limits`, `supported_parameters`,
  `default_parameters`, `knowledge_cutoff`, `expiration_date`, `links`.
- Variants share a base id with a `:suffix`, such as `:batch` and `:free`.
  Alias ids start with `~`, such as `~anthropic/claude-sonnet-latest`. The
  client keeps ids without a colon that carry `tools`, which also drops the
  aliases because they do not start with a grouped prefix.
- The list is cached for one hour at `~/.aiprose/models.json`. A failed
  refresh falls back to a stale cache when one exists.

## Electron shell

- The shell reads `AIPROSE_PROFILE_DIR` (default `~/.aiprose/electron-profile`),
  `AIPROSE_CDP_PORT` (default 9337), `AIPROSE_HOME` (where `.aiprose/transcripts`
  and the model cache live, default the home directory), and `AIPROSE_BASE_URL`.
- Chromium writes `DevToolsActivePort` into the profile with the port it is
  actually listening on. The test reads that file, so a wrong port shows up as
  a mismatch there rather than as a connection refusal.
- Playwright launches with `--inspect=0` and `--remote-debugging-pipe` of its
  own. The `appendSwitch` in main.ts still wins for the port, as the test proves.
- On Windows, `fs.rm` of a profile right after `app.close()` fails with
  `EBUSY` or `ENOTEMPTY` unless it retries. The fixture waits for the child
  process `exit` event and then removes with `maxRetries: 10, retryDelay: 200`.
- The secrets file is `<profile>/secrets.json` with an `openrouterApiKey`
  field. The "Set key" fix link creates it when missing and opens it in the
  system editor. Settings live beside it in `settings.json`.
- Clicking a line in the file pane moves the cursor. If the current thread has
  no messages yet, it restarts on the block under the new cursor; otherwise
  the thread stays and the pane still marks the thread's block, not the
  cursor's. Use New thread to move a started thread.

## VS Code extension

- `pnpm test:vscode` runs test/vscode/run.mjs, which sweeps and creates a
  temp `aiprose-vscode-*` user-data directory, picks a free debugging port,
  and passes both to .vscode-test.mjs through `AIPROSE_TEST_USER_DATA` and
  `AIPROSE_TEST_CDP_PORT`. The directory is removed in `finally`.
- The fake OpenRouter runs inside the extension host, so the test sets
  `process.env.AIPROSE_BASE_URL` in `suiteSetup` and the host reads it on
  every `config()` call. `AIPROSE_HOME` points at the user-data directory so
  transcripts and the model cache stay out of the real home directory.
- Commands are only registered once the extension activates, and listing
  commands does not activate it. Tests call `extension.activate()` first and
  use the API it returns (session, host, panel, and a message event).
- The webview is an out-of-process iframe. Playwright's `connectOverCDP`
  sees the outer `iframe.webview.ready` element in the workbench page but
  never attaches to its content, so `frameLocator` chains time out. The
  `/json` target list on the debugging port exposes the webview as a target
  of type `iframe` with a `vscode-webview://` url and its own
  `webSocketDebuggerUrl`. The test opens that socket and runs
  `Runtime.evaluate`; the app's `#active-frame` shares the origin, so
  `contentDocument` reaches the galley.
- `undo` acts on the focused editor, so a test brings the document back with
  `showTextDocument` before running it. The write is one `WorkspaceEdit`, so
  one undo restores the original text.
