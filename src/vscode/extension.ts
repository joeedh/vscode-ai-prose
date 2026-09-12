import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
	// CLAUDENOTE: wave 7 replaces these with the webview view provider and the real commands.
	context.subscriptions.push(
		vscode.commands.registerCommand("ai-prose.open", () => {}),
		vscode.commands.registerCommand("ai-prose.newThread", () => {}),
		vscode.commands.registerCommand("ai-prose.setApiKey", () => {}),
	);
}

export function deactivate() {}
