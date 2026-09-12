/**
 * Messages between a host (the VS Code extension or the Electron shell) and
 * the shared UI. Both hosts and the UI import this file, so a renamed message
 * fails the typecheck everywhere.
 */

/** Zero-based line span. `start` is inclusive and `end` is exclusive. */
export interface LineRange {
	start: number;
	end: number;
}

export type Mode = "strict" | "file";

export type UnitKind =
	| "lineRun"
	| "block"
	| "paragraph"
	| "listItem"
	| "heading"
	| "blockquote"
	| "file";

/** The isolated block the thread edits, as detected under the cursor. */
export interface Unit {
	kind: UnitKind;
	/** Margin label, such as "one // run" or "paragraph". */
	label: string;
	range: LineRange;
	/** The file lines of the range, with syntax, joined by "\n". */
	original: string;
	/** The prose the model sees, with syntax stripped. */
	text: string;
	/** Column the restored lines wrap at. */
	width: number;
}

export interface ThreadHeader {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	filePath: string;
	mode: Mode;
	model: string;
}

/** Where PROSE.md was found, or where the search started when it was not. */
export type ProseMdInfo = { path: string } | { searchedFrom: string };

export type FixKind = "apiKey" | "newThread";

export interface EditProposal {
	id: string;
	/** Range the edit replaces, in the file as it was before the edit. */
	range: LineRange;
	/** Zero-based line number of the first context line. */
	firstLine: number;
	contextBefore: string[];
	oldLines: string[];
	newLines: string[];
	contextAfter: string[];
	/** The replacement lines with syntax restored, joined by "\n". */
	text: string;
}

export type EditStatus = "accepted" | "rejected";

export interface EditResolution {
	id: string;
	status: EditStatus;
	/** Range the edit occupies after an accept; the proposal range after a reject. */
	range: LineRange;
	text: string;
}

export interface Usage {
	turns: number;
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number;
	cost: number;
}

/** A transcript item as the UI renders it. */
export type Entry =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string; activity: string[] }
	| { kind: "edit"; proposal: EditProposal; resolution?: EditResolution }
	| { kind: "error"; message: string; fix?: FixKind };

export interface ModelGroup {
	label: string;
	ids: string[];
}

export type HostToUi =
	| {
			type: "threadLoaded";
			thread: ThreadHeader;
			mode: Mode;
			model: string;
			systemPrompt: string;
			defaultSystemPrompt: string;
			proseMd: ProseMdInfo;
			entries: Entry[];
			usage: Usage;
	  }
	| { type: "galley"; unit: Unit | null; reason?: string }
	| { type: "turnStarted" }
	| { type: "messageDelta"; text: string }
	| { type: "activity"; label: string }
	| { type: "editProposed"; proposal: EditProposal }
	| { type: "editResolved"; resolution: EditResolution }
	| { type: "usage"; usage: Usage }
	| { type: "turnEnded" }
	| { type: "error"; message: string; fix?: FixKind }
	| { type: "threads"; current: ThreadHeader[]; other: ThreadHeader[] }
	| { type: "models"; groups: ModelGroup[] };

export type UiToHost =
	| { type: "ready" }
	| { type: "send"; text: string }
	| { type: "stop" }
	| { type: "acceptEdit"; id: string }
	| { type: "rejectEdit"; id: string }
	| { type: "newThread" }
	| { type: "openThread"; id: string }
	| { type: "setModel"; model: string }
	| { type: "setMode"; mode: Mode }
	| { type: "setSystemPrompt"; text: string }
	| { type: "copy"; text: string }
	| { type: "openFix"; kind: FixKind };
