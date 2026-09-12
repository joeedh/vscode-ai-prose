import * as vscode from "vscode";
import { SECRET_KEY, Session } from "../core/agent/session.js";
import type { EditStatus, HostToUi } from "../core/protocol.js";
import { ThreadStore } from "../core/threads/store.js";
import { VsCodeHost } from "./host.js";
import { PanelProvider, VIEW_ID } from "./panel.js";

/** What `activate` returns, so tests can drive the session and watch what the panel is told. */
export interface ExtensionApi {
	session: Session;
	host: VsCodeHost;
	panel: PanelProvider;
	onMessage: vscode.Event<HostToUi>;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	const messages = new vscode.EventEmitter<HostToUi>();
	const host = new VsCodeHost(context);
	const panel = new PanelProvider(context.extensionUri, (msg) => {
		session.handle(msg).catch((e: unknown) => sink({ type: "error", message: e instanceof Error ? e.message : String(e) }));
	});
	const sink = (msg: HostToUi) => {
		panel.post(msg);
		messages.fire(msg);
	};
	const session = new Session({ host, store: new ThreadStore(host.homeDir()), sink });
	host.threadPath = () => session.thread?.filePath;
	host.onNewThread = () => session.startThread();

	const reveal = () => vscode.commands.executeCommand(`${VIEW_ID}.focus`);

	context.subscriptions.push(
		messages,
		vscode.window.registerWebviewViewProvider(VIEW_ID, panel, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.commands.registerCommand("ai-prose.open", async () => {
			await reveal();
			// A view that is not yet resolved starts its thread when the UI reports ready
			if (panel.isResolved && !session.thread) {
				await session.startThread();
			}
		}),
		vscode.commands.registerCommand("ai-prose.newThread", async () => {
			await reveal();
			await session.startThread();
		}),
		vscode.commands.registerCommand("ai-prose.setApiKey", async (value?: string) => {
			const key =
				value ??
				(await vscode.window.showInputBox({
					title: "OpenRouter API key",
					prompt: "Stored in VS Code's secret storage and sent only to OpenRouter.",
					password: true,
					ignoreFocusOut: true,
				}));
			if (key !== undefined && key !== "") {
				await host.setSecret(SECRET_KEY, key);
			}
		}),
		vscode.commands.registerCommand("ai-prose._resolvePendingEdit", (status: EditStatus) => {
			session.resolvePendingEdit(status);
		}),
	);

	return { session, host, panel, onMessage: messages.event };
}

export function deactivate() {}
