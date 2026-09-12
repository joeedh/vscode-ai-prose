# ai-prose

An LLM prose editor for code comments and markdown paragraphs. The model sees
one block at a time with its comment syntax stripped, proposes a replacement
through a tool call, and nothing reaches the file until you accept it.

Runs as a VS Code panel and as a standalone Electron shell. Both hosts share
the same core and the same UI.

## Install

- `pnpm install`
- `pnpm compile` builds the extension, the Electron shell, and the UI into
  dist/.
- Press F5 in VS Code to run the extension, or `pnpm electron <file>` to open
  a file in the shell.

## Set the OpenRouter key

- VS Code: run "Prose: Set OpenRouter API Key" from the command palette. The
  key is kept in VS Code's secret storage.
- Electron: the "Set key" link in the panel opens `<profile>/secrets.json`;
  put the key in its `openrouterApiKey` field. The profile is
  `~/.aiprose/electron-profile` unless `AIPROSE_PROFILE_DIR` says otherwise.

## Open the panel

- VS Code: run "Prose: Open" with the cursor in a comment or a markdown
  paragraph. The Prose view opens in the bottom panel beside Terminal and
  Problems, and the galley shows the block it will edit. "Prose: New
  Thread" starts over on the block under the cursor.
- Electron: click a line in the file pane. An unstarted thread follows the
  click; a started one keeps its block until you choose New thread.

Type a request and send it. A proposed edit appears as a card with Preview
and Diff views. Accept writes it to the file as one undo step; Reject leaves
the file alone and keeps the rejected text for copying. Stop rejects a
pending edit and ends the turn.

## Modes

- Strict: the model can read only the block under edit.
- File: the model can read the whole file with line numbers, and still writes
  only the block. Switching modes starts a new thread.

## PROSE.md

A file named PROSE.md (any case) in the edited file's directory or any
directory above it is appended to the system prompt as a style guide. The
galley shows which one is in use, and the system prompt sheet shows where
the search started when none was found.

## Settings

| Setting | Effect |
| --- | --- |
| `aiProse.defaultModel` | Model id for new threads. |
| `aiProse.systemPrompt` | Replaces the built-in system prompt when set. |
| `aiProse.wrapColumn` | Fixed wrap column. Empty derives it from the original block, between 60 and 100. |
| `aiProse.baseUrl` | OpenRouter API base URL. `AIPROSE_BASE_URL` overrides it. |

Transcripts are stored one JSON file per thread under `~/.aiprose/transcripts`.

## Development

- `pnpm test:core` runs the vitest suites for the core and the UI.
- `pnpm test:electron` runs the Playwright suite against the shell.
- `pnpm test:vscode` runs the extension tests in a VS Code test build.
- `pnpm test:live` sends one real request through OpenRouter using the key in
  keys/openrouter.txt.

docs/debugging.md records how each piece behaves and the failure modes met
while building it.
