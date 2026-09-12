import { contextBridge, ipcRenderer } from "electron";
import type { HostToUi, UiToHost } from "../core/protocol.js";

contextBridge.exposeInMainWorld("aiprose", {
	post(msg: UiToHost) {
		ipcRenderer.send("ui", msg);
	},
	onMessage(cb: (msg: HostToUi) => void) {
		ipcRenderer.on("host", (_event, msg: HostToUi) => cb(msg));
	},
});
