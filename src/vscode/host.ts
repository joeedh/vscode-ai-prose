import * as os from "node:os";
import * as vscode from "vscode";
import type { Config, Host, HostDocument } from "../core/host.js";
import { DEFAULT_BASE_URL } from "../core/llm/index.js";
import type { LineRange } from "../core/protocol.js";

export const NO_EDITOR = "Open a file and put the cursor in a comment or a paragraph to start.";
export const EDITOR_CLOSED = "The editor for this file is closed. Reopen it and send again.";
const SECTION = "aiProse";

/**
 * Serves the thread's document while it is open, and otherwise the last
 * text editor that had focus, since focusing the panel does not count as
 * leaving the editor.
 */
export class VsCodeHost implements Host {
	private lastEditor: vscode.TextEditor | undefined;
	/** Reports the current thread's file so edits go to it and not to whichever editor has focus. */
	threadPath: () => string | undefined = () => undefined;
	onNewThread: () => Promise<void> = async () => {};

	constructor(private readonly context: vscode.ExtensionContext) {
		this.lastEditor = vscode.window.activeTextEditor;
		context.subscriptions.push(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor) {
					this.lastEditor = editor;
				}
			}),
		);
	}

	private threadDocument(): vscode.TextDocument | undefined {
		const target = this.threadPath();
		return target === undefined ? undefined : vscode.workspace.textDocuments.find((d) => d.uri.fsPath === target);
	}

	private editorDocument(): vscode.TextDocument | undefined {
		const editor = vscode.window.activeTextEditor ?? this.lastEditor;
		return editor && !editor.document.isClosed ? editor.document : undefined;
	}

	async document(): Promise<HostDocument> {
		const doc = this.threadDocument() ?? this.editorDocument();
		if (!doc) {
			throw new Error(this.threadPath() === undefined ? NO_EDITOR : EDITOR_CLOSED);
		}
		return { path: doc.uri.fsPath, languageId: doc.languageId, text: doc.getText() };
	}

	async cursor() {
		const doc = this.threadDocument() ?? this.editorDocument();
		const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc) ?? this.lastEditor;
		const active = editor?.selection.active;
		return { line: active?.line ?? 0, character: active?.character ?? 0 };
	}

	/** Replaces the lines in one workspace edit, so the change is a single undo step. */
	async applyEdit(range: LineRange, text: string): Promise<void> {
		const doc = this.threadDocument();
		if (!doc) {
			throw new Error(EDITOR_CLOSED);
		}
		const lastLine = doc.lineAt(range.end - 1);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, new vscode.Range(range.start, 0, lastLine.lineNumber, lastLine.text.length), text);
		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			throw new Error(EDITOR_CLOSED);
		}
	}

	async secret(name: string): Promise<string | undefined> {
		const value = await this.context.secrets.get(name);
		return value === "" ? undefined : value;
	}

	async setSecret(name: string, value: string): Promise<void> {
		await this.context.secrets.store(name, value);
	}

	async config(): Promise<Config> {
		const settings = vscode.workspace.getConfiguration(SECTION);
		const wrapColumn = settings.get<number | null>("wrapColumn", null);
		const config: Config = {
			model: settings.get<string>("defaultModel", "anthropic/claude-sonnet-5"),
			systemPrompt: settings.get<string>("systemPrompt", ""),
			baseUrl: process.env.AIPROSE_BASE_URL ?? settings.get<string>("baseUrl", DEFAULT_BASE_URL),
		};
		if (typeof wrapColumn === "number") {
			config.wrapColumn = wrapColumn;
		}
		return config;
	}

	async setConfig(patch: Partial<Config>): Promise<void> {
		const settings = vscode.workspace.getConfiguration(SECTION);
		const keys: Record<keyof Config, string> = { model: "defaultModel", systemPrompt: "systemPrompt", wrapColumn: "wrapColumn", baseUrl: "baseUrl" };
		for (const [key, value] of Object.entries(patch) as [keyof Config, unknown][]) {
			await settings.update(keys[key], value, vscode.ConfigurationTarget.Global);
		}
	}

	async clipboardWrite(text: string): Promise<void> {
		await vscode.env.clipboard.writeText(text);
	}

	async openFix(kind: "apiKey" | "newThread"): Promise<void> {
		if (kind === "apiKey") {
			await vscode.commands.executeCommand("ai-prose.setApiKey");
		} else {
			await this.onNewThread();
		}
	}

	homeDir(): string {
		return process.env.AIPROSE_HOME ?? os.homedir();
	}
}
