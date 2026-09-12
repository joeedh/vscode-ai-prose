import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";
import { mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../core/agent/session.js";
import type { HostToUi, UiToHost } from "../core/protocol.js";
import { ThreadStore } from "../core/threads/store.js";
import type { FileState } from "./bridge.js";
import { ElectronHost } from "./host.js";

export const NO_FILE = "Open a file to start.";
const DEFAULT_CDP_PORT = "9337";

// Both the profile and the debugging port must be fixed before `ready`
const profileDir = process.env.AIPROSE_PROFILE_DIR ?? path.join(os.homedir(), ".aiprose", "electron-profile");
mkdirSync(profileDir, { recursive: true });
app.setPath("userData", profileDir);
app.commandLine.appendSwitch("remote-debugging-port", process.env.AIPROSE_CDP_PORT ?? DEFAULT_CDP_PORT);

const home = process.env.AIPROSE_HOME ?? os.homedir();
const host = new ElectronHost(profileDir, home);
const session = new Session({ host, store: new ThreadStore(home), sink: (msg) => send("host", msg) });
let win: BrowserWindow | undefined;

function send(channel: "host", payload: HostToUi): void;
function send(channel: "file", payload: FileState | null): void;
function send(channel: string, payload: unknown): void {
	win?.webContents.send(channel, payload);
}

host.onFileChange = (state) => send("file", state);
host.onNewThread = () => session.startThread();

ipcMain.on("ui", (_event, msg: UiToHost) => {
	const startsThread = msg.type === "ready" || msg.type === "newThread" || msg.type === "setMode";
	if (!host.hasFile && startsThread) {
		send("host", { type: "galley", unit: null, reason: NO_FILE });
		return;
	}
	session.handle(msg).catch((e: unknown) => {
		send("host", { type: "error", message: e instanceof Error ? e.message : String(e) });
	});
});

ipcMain.on("file:get", () => send("file", host.fileState()));

// A click in the file pane retargets an unstarted thread, and only that
ipcMain.on("cursor", (_event, line: number) => {
	host.setCursor(line);
	if (!session.thread || session.thread.messages.length === 0) {
		void session.startThread();
	}
});

function openFile(filePath: string): void {
	host.openFile(path.resolve(filePath));
	void session.startThread();
}

async function chooseFile(): Promise<void> {
	if (!win) {
		return;
	}
	const result = await dialog.showOpenDialog(win, { properties: ["openFile"] });
	if (!result.canceled && result.filePaths.length > 0) {
		openFile(result.filePaths[0]);
	}
}

function buildMenu(): Menu {
	const template: MenuItemConstructorOptions[] = [
		{
			label: "File",
			submenu: [
				{ label: "Open…", accelerator: "CmdOrCtrl+O", click: () => void chooseFile() },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{ role: "editMenu" },
		{ role: "viewMenu" },
	];
	return Menu.buildFromTemplate(template);
}

/** The first bare argument after the script is the file to open. */
function fileArg(): string | undefined {
	return process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith("-"));
}

app.whenReady().then(() => {
	Menu.setApplicationMenu(buildMenu());
	win = new BrowserWindow({
		width: 1200,
		height: 800,
		title: "ai-prose",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const arg = fileArg();
	if (arg) {
		host.openFile(path.resolve(arg));
	}
	void win.loadFile(path.join(__dirname, "..", "..", "media", "electron.html"));
});

app.on("window-all-closed", () => {
	app.quit();
});
