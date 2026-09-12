# Conversation agent requirements

This is a tool to edit prose written by LLM with strict context isolation
to prevent prose style context poisoning.

## Modes 

There are two modes:
* Strict Isolation -- tool is only fed individual code comments or markdown paragraphs
  * The unit of isolation is one full comment. In C++-comment languages that is
    a single `/* */` block or a run of consecutive `//` lines. In pound-comment
    languages it is a run of consecutive `#` lines. A blank line ends a run,
    so runs separated by a blank line are separate units.
  * In markdown files the unit is a paragraph. Each list item and each heading
    is its own unit. Fenced code blocks are never included in a unit.
* File Isolation -- tool can read the entire file 

## Details

The user can edit the system prompt.  In addition the tool will 
load the first PROSE.MD file it finds walking upward from the current 
file path and add it to the context.

The UI is a conversation editor.  There is a dropdown box for past
threads.  Users will be able to resume past threads.  We will only 
be supporting openrouter models.  There will be a model dropdown box 
with Anthropic models, Gemini models, z-ai/glm-5.3-flash and a 'other'
option that lets them paste in another model id.  

The llm agent itself has a tool to read its available text, a tool to 
get the valid edit range, a write tool (restricted to the valid edit range)
etc.  The llm will see prose without surrounding code comment syntax,
which will be transparently re-added on writes.  

The agent should support prompt caching from the beginning.

### Edit review

A write does not land in the file directly. It appears as a preview of the
edited block with a few lines of context above and below. A button toggles
between that preview and a diff view. The user clicks accept or reject.
On reject, the final edited text is pasted into the conversation history
so the user can copy it later.

### thread transcripts 

Store transcripts in ~/.aiprose/transcripts 
Transcripts should include the system prompt the user used 
for that thread.

## Non-vscode mode 

The agent should have a simple electron shell for testing.  

* The shell creates its own chromium profile (a dedicated user-data-dir),
  never the default one.
* CDP listens on a non-standard port, not 9222.
* A full live headed shell is required; headless-only is not enough.
* Playwright may be used for integration tests.
* Integration tests that create a temporary chromium profile must delete
  it when they finish, including when they error.

## Integration into vscode

Integrate into vscode with a webview panel tab thingy.  Its default location
is a horizontal pane (the bottom panel area, beside Terminal and Problems),
not a vertical one beside the editor.  Figure out how to 
connect to both the host vscode and the webview over CDP to drive them for 
testing.  The webview panel and the electron shell should presumably share 
a lot of code (including UI).  The frontend design skill should be used 
to design its UI/UX.
