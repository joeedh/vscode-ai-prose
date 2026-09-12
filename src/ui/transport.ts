import type { HostToUi, UiToHost } from "../core/protocol";
import type { ElectronBridge } from "../electron/bridge";

/** Carries protocol messages between the app and whichever host loaded it. */
export interface Transport {
	post(msg: UiToHost): void;
	onMessage(cb: (msg: HostToUi) => void): void;
}

interface VsCodeApi {
	postMessage(msg: unknown): void;
}

declare global {
	var acquireVsCodeApi: (() => VsCodeApi) | undefined;
	interface Window {
		aiprose?: ElectronBridge;
	}
}

export function vscodeTransport(): Transport {
	const api = globalThis.acquireVsCodeApi!();
	return {
		post: (msg) => api.postMessage(msg),
		onMessage: (cb) => {
			window.addEventListener("message", (event: MessageEvent<HostToUi>) => cb(event.data));
		},
	};
}

export function electronTransport(): Transport {
	const bridge = window.aiprose!;
	return {
		post: (msg) => bridge.post(msg),
		onMessage: (cb) => bridge.onMessage(cb),
	};
}

/** In-memory pair for tests: `posted` records the app's messages and `emit` plays the host's. */
export interface TestTransport {
	transport: Transport;
	posted: UiToHost[];
	emit(msg: HostToUi): void;
}

export function testTransport(): TestTransport {
	const posted: UiToHost[] = [];
	const listeners: Array<(msg: HostToUi) => void> = [];
	return {
		transport: {
			post: (msg) => {
				posted.push(msg);
			},
			onMessage: (cb) => {
				listeners.push(cb);
			},
		},
		posted,
		emit: (msg) => {
			for (const cb of listeners) {
				cb(msg);
			}
		},
	};
}

/** Picks the VS Code bridge when the webview API exists, otherwise the Electron one. */
export function detectTransport(): Transport {
	if (typeof globalThis.acquireVsCodeApi === "function") {
		return vscodeTransport();
	}
	if (window.aiprose) {
		return electronTransport();
	}
	throw new Error("No host bridge found");
}
