import { contextBridge, ipcRenderer } from "electron";
import type { FileState } from "./bridge.js";
import type { ElectronBridge } from "./bridge.js";
import type { HostToUi, UiToHost } from "../core/protocol.js";

const bridge: ElectronBridge = {
	post(msg: UiToHost) {
		ipcRenderer.send("ui", msg);
	},
	onMessage(cb: (msg: HostToUi) => void) {
		ipcRenderer.on("host", (_event, msg: HostToUi) => cb(msg));
	},
	onFile(cb: (state: FileState | null) => void) {
		ipcRenderer.on("file", (_event, state: FileState | null) => cb(state));
		ipcRenderer.send("file:get");
	},
	setCursor(line: number) {
		ipcRenderer.send("cursor", line);
	},
};

contextBridge.exposeInMainWorld("aiprose", bridge);
