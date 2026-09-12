import * as assert from "assert";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToUi } from "../../core/protocol.js";
import { startFakeOpenRouter, type FakeOpenRouter } from "../fake-openrouter.js";
import type { ExtensionApi } from "../../vscode/extension.js";

const EXTENSION_ID = "joeedh.ai-prose";
// Compiled tests run from out/, so the fixture is read from the source tree
const SAMPLE = path.join(__dirname, "..", "..", "..", "src", "test", "fixtures", "vscode", "sample.ts");
const COMMENT_LINE = 1;
const writeCall = (id: string, text: string) => ({ id, name: "write_text", arguments: JSON.stringify({ text }) });

interface CdpTarget {
	type: string;
	url: string;
	webSocketDebuggerUrl: string;
}

/** Evaluates one expression in a debugging target and returns its JSON value. */
function cdpEvaluate(wsUrl: string, expression: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(wsUrl);
		socket.onerror = () => reject(new Error(`Could not connect to ${wsUrl}`));
		socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
		socket.onmessage = (event) => {
			const reply = JSON.parse(String(event.data)) as { id?: number; result?: { result?: { value?: unknown }; exceptionDetails?: { text: string } } };
			if (reply.id !== 1) {
				return;
			}
			socket.close();
			if (reply.result?.exceptionDetails) {
				reject(new Error(reply.result.exceptionDetails.text));
			} else {
				resolve(reply.result?.result?.value ?? null);
			}
		};
	});
}

let api: ExtensionApi;
let server: FakeOpenRouter;
let workDir: string;
let messages: HostToUi[] = [];

function next<T extends HostToUi["type"]>(type: T, timeoutMs = 10_000): Promise<Extract<HostToUi, { type: T }>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			sub.dispose();
			reject(new Error(`No ${type} message within ${timeoutMs}ms; saw ${messages.map((m) => m.type).join(", ")}`));
		}, timeoutMs);
		const sub = api.onMessage((msg) => {
			if (msg.type === type) {
				clearTimeout(timer);
				sub.dispose();
				resolve(msg as Extract<HostToUi, { type: T }>);
			}
		});
	});
}

async function openSample(): Promise<vscode.TextEditor> {
	const file = path.join(workDir, "sample.ts");
	await fs.copyFile(SAMPLE, file);
	const doc = await vscode.workspace.openTextDocument(file);
	const editor = await vscode.window.showTextDocument(doc);
	const pos = new vscode.Position(COMMENT_LINE, 5);
	editor.selection = new vscode.Selection(pos, pos);
	return editor;
}

/** Opens the sample and starts a thread on its comment, subscribing before the command so the galley is not missed. */
async function startOnSample(): Promise<vscode.TextEditor> {
	const editor = await openSample();
	const galley = next("galley");
	await vscode.commands.executeCommand("ai-prose.newThread");
	const msg = await galley;
	assert.deepStrictEqual(msg.unit?.range, { start: 1, end: 3 });
	return editor;
}

suite("Extension", function () {
	this.timeout(30_000);

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is installed`);
		api = await extension.activate();
		api.onMessage((msg) => messages.push(msg));
		server = await startFakeOpenRouter();
		process.env.AIPROSE_BASE_URL = server.url;
		workDir = await fs.mkdtemp(path.join(os.tmpdir(), "aiprose-vscode-work-"));
		await api.host.setSecret("openrouterApiKey", "test-key");
	});

	suiteTeardown(async () => {
		await server.close();
		await fs.rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});

	setup(() => {
		messages = [];
	});

	test("registers its commands", async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const id of ["ai-prose.open", "ai-prose.newThread", "ai-prose.setApiKey", "ai-prose._resolvePendingEdit"]) {
			assert.ok(commands.includes(id), id);
		}
	});

	test("resolves the panel view and starts a thread from the cursor", async () => {
		await openSample();
		const resolved = api.panel.isResolved ? Promise.resolve() : new Promise<void>((r) => api.panel.onDidResolve(() => r()));
		const galley = next("galley");
		await vscode.commands.executeCommand("ai-prose.open");
		await resolved;
		assert.ok(api.panel.isResolved);
		const msg = await galley;
		assert.deepStrictEqual(msg.unit?.range, { start: 1, end: 3 });
		assert.strictEqual(msg.unit?.kind, "lineRun");
	});

	test("applies an accepted edit as one undo step", async () => {
		const editor = await startOnSample();

		server.script({ toolCalls: [writeCall("c1", "Pointer ids currently down. More than one means multi-touch.")] });
		server.script({ text: "Tightened it." });
		const proposed = next("editProposed");
		const sending = api.session.send("Tighten this");
		const proposal = (await proposed).proposal;
		assert.deepStrictEqual(proposal.newLines, ["\t// Pointer ids currently down. More than one means multi-touch."]);
		const ended = next("turnEnded");
		await vscode.commands.executeCommand("ai-prose._resolvePendingEdit", "accepted");
		await ended;
		await sending;

		const original = await fs.readFile(SAMPLE, "utf8");
		const lines = editor.document.getText().split(/\r?\n/);
		assert.strictEqual(lines[1], "\t// Pointer ids currently down. More than one means multi-touch.");
		assert.strictEqual(lines[2], "\tprivate down = new Set<number>();");
		assert.strictEqual(lines.length, original.split(/\r?\n/).length - 1);

		await vscode.window.showTextDocument(editor.document);
		await vscode.commands.executeCommand("undo");
		assert.strictEqual(editor.document.getText(), original);
	});

	test("rejecting an edit leaves the document alone", async () => {
		const editor = await startOnSample();
		server.script({ toolCalls: [writeCall("c1", "Not this wording.")] });
		server.script({ text: "Understood." });
		const proposed = next("editProposed");
		const sending = api.session.send("Try again");
		await proposed;
		const resolved = next("editResolved");
		await vscode.commands.executeCommand("ai-prose._resolvePendingEdit", "rejected");
		assert.strictEqual((await resolved).resolution.status, "rejected");
		await sending;
		assert.strictEqual(editor.document.getText(), await fs.readFile(SAMPLE, "utf8"));
		assert.strictEqual(editor.document.isDirty, false);
	});

	test("stores the key from the set-key command", async () => {
		await vscode.commands.executeCommand("ai-prose.setApiKey", "stored-key");
		assert.strictEqual(await api.host.secret("openrouterApiKey"), "stored-key");
		await api.host.setSecret("openrouterApiKey", "test-key");
	});

	test("shows the galley in the webview, reached over CDP", async () => {
		const port = process.env.AIPROSE_TEST_CDP_PORT;
		assert.ok(port, "AIPROSE_TEST_CDP_PORT is set");
		assert.notStrictEqual(port, "9222");
		await startOnSample();

		const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as CdpTarget[];
		const webview = targets.find((t) => t.type === "iframe" && t.url.startsWith("vscode-webview://"));
		assert.ok(webview, `webview target among ${targets.map((t) => `${t.type} ${t.url.slice(0, 40)}`).join("; ")}`);
		// The webview's outer frame is its own target, and the app frame inside shares its origin
		const expression = "document.getElementById('active-frame')?.contentDocument?.querySelector('.galley .margin')?.innerText ?? null";
		const deadline = Date.now() + 15_000;
		let text: unknown = null;
		while (text === null && Date.now() < deadline) {
			text = await cdpEvaluate(webview.webSocketDebuggerUrl, expression);
			if (text === null) {
				await new Promise((r) => setTimeout(r, 250));
			}
		}
		assert.strictEqual(typeof text, "string", "galley text");
		assert.ok((text as string).includes("lines 2–3"), text as string);
		assert.ok((text as string).includes("sample.ts"), text as string);
	});
});
