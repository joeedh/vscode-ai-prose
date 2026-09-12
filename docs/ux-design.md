# UX design

Design for the conversation editor described in req.md. The mockup in
docs/ux-mockup.html is the reference rendering; this file records the
decisions behind it.

## Concept

- The isolated block is the hero. It is shown the way the model sees it:
  comment syntax stripped, set in a reading serif, with its file address in
  the margin. This makes the isolation guarantee visible.
- The conversation reads as a manuscript with margin notes. No chat bubbles.
  Author labels are small run-in words above each message.
- The proposed edit is the one lifted surface on the page. It is a preview of
  the file, so it uses the editor's monospace font with the comment syntax
  restored, and it carries a few lines of context above and below.
- Everything else sits flat on the ground.

## Tokens

### Color

| Token        | Light     | Dark      | Role                                   |
|--------------|-----------|-----------|----------------------------------------|
| ground       | `#F4F5F8` | `#15171C` | page background                        |
| sheet        | `#FFFFFF` | `#1D2027` | galley, proposed edit, composer, menus |
| ink          | `#1C1F26` | `#E4E6EB` | primary text                           |
| graphite     | `#636A78` | `#9AA1AE` | secondary text, margins, labels        |
| line         | `#E2E5EB` | `#2A2E37` | hairlines                              |
| pencil       | `#3B4FC8` | `#8DA5FF` | accent: actions, focus, current block  |
| pencil-soft  | `#E7EAFA` | `#252B45` | accent tint for selected state         |
| removed      | `#B3382F` on `#FBEAE8` | `#F08A7E` on `#3A2320` | diff removed lines |
| added        | `#2F7A4B` on `#E6F4EA` | `#7FC79A` on `#1F3327` | diff added lines   |

- The accent is a proofreader's blue pencil. Diff red and green are semantic
  and never used as the accent.
- The dark theme is designed, not inverted. The accent is lifted two steps so
  it keeps contrast on the dark sheet.
- In the VS Code webview, `body.vscode-dark` and `body.vscode-high-contrast`
  select the dark token set. `body.vscode-light` and
  `body.vscode-high-contrast-light` select the light set, and the light rule
  comes last because a high-contrast-light body carries both high-contrast
  classes. The Electron shell follows `prefers-color-scheme` with an
  explicit override.

### Type

| Role     | Face                                 | Size / leading | Used for                          |
|----------|--------------------------------------|----------------|-----------------------------------|
| prose    | Literata (variable, optical size)    | 15px / 1.55    | galley text, message bodies       |
| chrome   | IBM Plex Sans                        | 13px / 1.4     | toolbar, labels, buttons, margins |
| file     | editor font, else IBM Plex Mono      | 13px / 1.5     | proposed edit preview and diff    |

- Scale: 12, 13, 14, 15, 18. Nothing larger; this is a working panel, not a
  page.
- Prose measures at most 68 characters. Chrome text is sentence case, never
  all caps.
- Fonts are bundled with the extension. The webview CSP does not allow a
  font host.
- The file preview font stack starts with `--vscode-editor-font-family` so
  the preview matches the user's editor. The Electron shell has no such
  variable and falls through to Plex Mono.

### Spacing and shape

- Base unit 4px. Panel gutter 20px. Message gap 20px. Card padding 12px.
- Radius 6px on the proposed edit and on menus. 4px on buttons and inputs.
  The galley has no radius; it has a 2px pencil rule on its left edge.
- One shadow, on the proposed edit only.

## Layout

```
┌ toolbar ────────────────────────────────────────────────────────────┐
│ [▾ Plainer pointer comment      ] [▾ anthropic/claude-sonnet-5]     │
│                                     [ Strict │ File ]  System prompt │
├ thread (scrolls) ───────────────────────────────────────────────────┤
│ ▌ src/editor/pointer.ts · lines 38–40 · one // run                  │
│ ▌ Style from ../PROSE.md                                            │
│ ▌ keeps track of the pointer ids that are currently held down…      │
│                                                                     │
│ You                                                                 │
│ Make this plainer. Two sentences at most.                           │
│                                                                     │
│ Editor                                                              │
│ Read the block · Checked the edit range                             │
│ Split it into a fact and how it is used.                            │
│ ┌ Proposed edit · lines 38–40 ──────────────── [Preview│Diff] ┐     │
│ │ 36 │   private captured = false;                             │     │
│ │ 38 │   // Pointer ids currently down. More than one id in    │     │
│ │ 39 │   // the set means a multi-touch is in progress.        │     │
│ │ 40 │   private down = new Set<number>();                     │     │
│ │                                    [Reject]  [Accept edit]   │     │
│ └──────────────────────────────────────────────────────────────┘     │
├ composer ───────────────────────────────────────────────────────────┤
│ [ Ask for a change                                         ] [Send] │
│ 2 turns · 3.1k tokens · 78% from cache · $0.004                      │
└─────────────────────────────────────────────────────────────────────┘
```

- Left aligned throughout. The thread column is capped at 72ch and sits at
  the left of the panel, not centered, so it lines up with the toolbar.
- The Electron shell places a read-only file pane to the left of the panel.
  The block under the cursor is marked with the same pencil rule the galley
  uses, so the two are visibly the same thing.
- The VS Code webview tab is the panel alone.

## Components

### Toolbar

- Thread menu. Shows the current thread's title. Titles are the first user
  message, trimmed. The menu lists threads for the current file first, then
  other files under a divider. A "New thread" item is always first.
- Model menu. Groups: Anthropic, Google, Z.ai, Other. Choosing Other reveals
  a text field for a model id. The field keeps the last id entered.
- Mode control. A two-segment control, Strict and File. Strict is the
  default. Switching mode starts a new thread, because the visible text
  changes and a resumed thread would carry the old view.
- System prompt. Opens a side sheet with a plain textarea and a "Reset to
  default" link. The sheet also shows which PROSE.md was found, or "No
  PROSE.md found" with the directory the search started from.

### Galley

- Margin line: file path, line range, unit kind ("one // run", "one /* */
  block", "one # run", "paragraph", "list item", "heading").
- Second margin line: "Style from ../PROSE.md" or nothing.
- Body: the block text with syntax stripped, in Literata.
- In File mode the galley shows the path and "whole file" and collapses the
  body to the first three lines with a "Show all" link.
- Empty state, when the cursor is not inside a comment or paragraph:
  "Put the cursor in a comment or a paragraph to start."

### Messages

- Author label "You" or "Editor" in graphite chrome type.
- User messages in Literata at prose size. Assistant messages the same.
- Tool activity is one graphite line under the author label: "Read the
  block · Checked the edit range". It never expands. Tool arguments are not
  shown.
- Streaming text appears as it arrives. A thin pencil caret sits at the end
  until the turn completes.

### Proposed edit

- Header: "Proposed edit · lines 38–40" on the left, a Preview / Diff
  segmented toggle on the right.
- Preview body: the file as it will be after the edit. Three lines of
  context above and below in graphite, the edited lines in ink, with line
  numbers in the gutter. Long lines scroll inside the card.
- Diff body: the same card. Removed lines carry a minus and the removed
  tint, added lines a plus and the added tint. Context lines stay graphite.
- Footer: Reject on the left as a quiet button, Accept edit on the right as
  the pencil-filled button. Enter accepts, Escape rejects, while the card
  has focus.
- The write tool call blocks until one is clicked. The tool result tells the
  model which happened.

### Accepted edit

- The card collapses to one line: "Applied to lines 38–39" with a check.
  Clicking it reopens the diff read-only.

### Rejected edit

- The card stays in the transcript with the header "Rejected edit" and a
  "Copy" button. The body is the final edited text as plain text in the
  file font, without context lines, so it can be pasted anywhere.

### Composer

- One textarea that grows to six lines. Placeholder "Ask for a change".
  Enter sends, Shift+Enter inserts a newline.
- Send button in pencil. While a turn is running it becomes Stop.
- Usage line under the composer in graphite: turns, tokens, share served
  from cache, cost. All four come from the usage block in the final chunk
  of each streamed reply.

### Errors

- Shown as a flat graphite block in the transcript. When a fix exists, a
  pencil link follows the message and runs it.
- "OpenRouter key is missing. Set one." The link runs the set-key command,
  or opens the secrets file in the Electron shell.
- "OpenRouter rejected the key. Set a new one." Same link.
- "The OpenRouter account has no credit."
- "OpenRouter is rate limiting this key. Try again in a moment."
- "OpenRouter failed mid-reply. Send again."
- "Could not reach OpenRouter."
- "The block changed on disk since this thread started. Start a new
  thread." The link starts one.
- "The editor for this file is closed. Reopen it and send again."

## Motion

- The proposed edit card fades in over 120ms when it arrives.
- Accept and reject animate the card to its collapsed form over 160ms.
- Preview and Diff swap with no transition.
- Everything respects `prefers-reduced-motion`.

## Accessibility

- All controls reachable by keyboard with a visible pencil focus ring.
- The segmented controls are radio groups. The thread and model menus are
  native selects styled with tokens, so they get platform keyboard handling
  for free.
- Diff lines carry a visually hidden "removed" or "added" prefix for screen
  readers; the color is never the only signal.
- Contrast: ink on sheet is 14:1 light and 12:1 dark. Graphite on sheet is
  5.2:1 light and 6.1:1 dark. Pencil on sheet is 6.3:1 light and 7.4:1
  dark.
