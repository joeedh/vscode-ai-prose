import type { HostToUi, UiToHost } from "../core/protocol.js";

/** The loaded file as the file pane shows it. Null when nothing is open. */
export interface FileState {
	path: string;
	text: string;
	cursorLine: number;
}

/** What the preload exposes to the renderer as `window.aiprose`. */
export interface ElectronBridge {
	post(msg: UiToHost): void;
	onMessage(cb: (msg: HostToUi) => void): void;
	/** Delivers the current file at once and again after every change. */
	onFile(cb: (state: FileState | null) => void): void;
	setCursor(line: number): void;
}
