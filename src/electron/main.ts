import { app, BrowserWindow } from "electron";
import { mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// CLAUDENOTE: wave 6 adds the file pane, the Host, and the window layout.
const profileDir = process.env.AIPROSE_PROFILE_DIR ?? path.join(os.homedir(), ".aiprose", "electron-profile");
mkdirSync(profileDir, { recursive: true });
app.setPath("userData", profileDir);
app.commandLine.appendSwitch("remote-debugging-port", process.env.AIPROSE_CDP_PORT ?? "9337");

app.whenReady().then(() => {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	void win.loadFile(path.join(__dirname, "..", "..", "media", "electron.html"));
});

app.on("window-all-closed", () => {
	app.quit();
});
