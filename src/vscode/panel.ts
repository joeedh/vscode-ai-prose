import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { HostToUi, UiToHost } from "../core/protocol.js";

export const VIEW_ID = "aiProse.panel";

/** Hosts the UI bundle in the panel view and relays protocol messages both ways. */
export class PanelProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	private readonly resolved = new vscode.EventEmitter<void>();
	readonly onDidResolve = this.resolved.event;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly onMessage: (msg: UiToHost) => void,
	) {}

	get isResolved(): boolean {
		return this.view !== undefined;
	}

	post(msg: HostToUi): void {
		void this.view?.webview.postMessage(msg);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media")],
		};
		view.webview.html = this.html(view.webview);
		view.webview.onDidReceiveMessage((msg: UiToHost) => this.onMessage(msg));
		view.onDidDispose(() => {
			this.view = undefined;
		});
		this.resolved.fire();
	}

	private html(webview: vscode.Webview): string {
		const nonce = crypto.randomBytes(16).toString("base64");
		const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "ui.js"));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "ui.css"));
		const csp = [
			"default-src 'none'",
			`script-src 'nonce-${nonce}'`,
			`style-src ${webview.cspSource}`,
			`font-src ${webview.cspSource}`,
			`img-src ${webview.cspSource} data:`,
		].join("; ");
		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy" content="${csp};">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="stylesheet" href="${style}">
	<title>Prose</title>
</head>
<body>
	<div id="root"></div>
	<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
	}
}
