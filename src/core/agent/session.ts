import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Host } from "../host.js";
import { chat as defaultChat, listModels as defaultListModels, LlmError, MESSAGES, type ChatResult, type Message, type ToolCall } from "../llm/index.js";
import { findProseMd } from "../prose-md.js";
import type { EditProposal, EditResolution, EditStatus, Entry, HostToUi, LineRange, Mode, ModelGroup, UiToHost, Unit, Usage } from "../protocol.js";
import { groupByFile, ThreadStore, type StoredEdit, type Thread } from "../threads/store.js";
import { detectUnit, resolveLanguage, restoreUnit } from "../units/index.js";
import { buildSystemContent, DEFAULT_SYSTEM_PROMPT } from "./prompt.js";
import { activityLabel, GET_EDIT_RANGE, READ_TEXT, TOOL_DEFS, WRITE_TEXT } from "./tools.js";

export const SECRET_KEY = "openrouterApiKey";
export const MISSING_KEY = MESSAGES.missingKey;
export const BLOCK_CHANGED = "The block changed on disk since this thread started. Start a new thread.";
export const NO_UNIT = "Put the cursor in a comment or a paragraph to start.";
export const CONTEXT_LINES = 3;

const FALLBACK_MODELS: ModelGroup[] = [
	{ label: "Anthropic", ids: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "anthropic/claude-haiku-4.5"] },
	{ label: "Google", ids: ["google/gemini-2.5-pro", "google/gemini-2.5-flash"] },
	{ label: "Z.ai", ids: ["z-ai/glm-5.3-flash"] },
];

export interface SessionDeps {
	host: Host;
	store: ThreadStore;
	sink: (msg: HostToUi) => void;
	chat?: typeof defaultChat;
	listModels?: typeof defaultListModels;
}

interface PendingEdit {
	id: string;
	resolve: (status: EditStatus) => void;
}

const emptyUsage = (): Usage => ({ turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 });

/** Drives one thread at a time: builds prompts, runs tool calls, and gates writes on the user. */
export class Session {
	thread: Thread | undefined;
	private unit: Unit | undefined;
	private languageId = "";
	private pending: PendingEdit | undefined;
	private abort: AbortController | undefined;
	private running = false;
	private stopped = false;
	private editCounter = 0;
	private readonly chat: typeof defaultChat;
	private readonly listModels: typeof defaultListModels;

	constructor(private readonly deps: SessionDeps) {
		this.chat = deps.chat ?? defaultChat;
		this.listModels = deps.listModels ?? defaultListModels;
	}

	get isRunning(): boolean {
		return this.running;
	}

	get pendingEditId(): string | undefined {
		return this.pending?.id;
	}

	async handle(msg: UiToHost): Promise<void> {
		switch (msg.type) {
			case "ready":
				if (this.thread) {
					await this.emitThread();
				} else {
					await this.startThread();
				}
				return;
			case "send":
				await this.send(msg.text);
				return;
			case "stop":
				this.stop();
				return;
			case "acceptEdit":
				this.resolvePendingEdit("accepted", msg.id);
				return;
			case "rejectEdit":
				this.resolvePendingEdit("rejected", msg.id);
				return;
			case "newThread":
				await this.startThread(this.thread?.mode);
				return;
			case "openThread":
				await this.openThread(msg.id);
				return;
			case "setModel":
				await this.setModel(msg.model);
				return;
			case "setMode":
				await this.startThread(msg.mode);
				return;
			case "setSystemPrompt":
				await this.setSystemPrompt(msg.text);
				return;
			case "copy":
				await this.deps.host.clipboardWrite(msg.text);
				return;
			case "openFix":
				await this.deps.host.openFix(msg.kind);
				return;
		}
	}

	/** Starts a new thread on the block under the cursor. The thread is saved on its first message. */
	async startThread(mode?: Mode): Promise<void> {
		this.stop();
		const { host, store } = this.deps;
		const doc = await host.document();
		const cursor = await host.cursor();
		const config = await host.config();
		const resolvedMode = mode ?? this.thread?.mode ?? "strict";
		this.languageId = resolveLanguage(doc.languageId, doc.path) ?? doc.languageId;
		const detected = detectUnit(doc.text, doc.languageId, doc.path, cursor.line, { wrapColumn: config.wrapColumn });
		this.unit = detected.ok ? detected.unit : undefined;
		const proseMd = await findProseMd(path.dirname(doc.path));
		const proseMdText = "path" in proseMd ? await fs.readFile(proseMd.path, "utf8") : undefined;
		const userPrompt = config.systemPrompt;
		this.thread = store.create({
			title: "New thread",
			filePath: doc.path,
			languageId: doc.languageId,
			mode: resolvedMode,
			model: this.thread?.model ?? config.model,
			userPrompt,
			systemPrompt: buildSystemContent({ userPrompt, proseMd: proseMdText, mode: resolvedMode, width: this.unit?.width ?? 80 }),
			proseMdPath: "path" in proseMd ? proseMd.path : undefined,
			proseMdSearchedFrom: "searchedFrom" in proseMd ? proseMd.searchedFrom : undefined,
			unit: this.unit ?? null,
			messages: [],
			usage: emptyUsage(),
			edits: [],
		});
		await this.emitThread();
		if (!detected.ok) {
			this.emit({ type: "galley", unit: null, reason: detected.reason });
		}
		void this.emitModels();
	}

	/** Resumes a stored thread if its block is unchanged in the current document. */
	async openThread(id: string): Promise<void> {
		this.stop();
		const thread = await this.deps.store.load(id);
		const doc = await this.deps.host.document();
		this.languageId = resolveLanguage(doc.languageId, doc.path) ?? doc.languageId;
		let unit: Unit | undefined;
		if (thread.unit && doc.path === thread.filePath) {
			const detected = detectUnit(doc.text, doc.languageId, doc.path, thread.unit.range.start);
			if (detected.ok && detected.unit.range.start === thread.unit.range.start && detected.unit.original === thread.unit.original) {
				unit = detected.unit;
			}
		}
		this.thread = thread;
		this.unit = unit;
		await this.emitThread();
		if (!unit) {
			this.emit({ type: "galley", unit: null });
			this.emit({ type: "error", message: BLOCK_CHANGED, fix: "newThread" });
		}
	}

	async send(text: string): Promise<void> {
		const thread = this.thread;
		if (!thread || this.running) {
			return;
		}
		if (!this.unit) {
			this.emit({ type: "error", message: NO_UNIT });
			return;
		}
		const apiKey = await this.deps.host.secret(SECRET_KEY);
		if (!apiKey) {
			this.emit({ type: "error", message: MISSING_KEY, fix: "apiKey" });
			return;
		}
		if (thread.messages.length === 0) {
			thread.title = ThreadStore.titleFor(text);
		}
		thread.messages.push({ role: "user", content: text } satisfies Message);
		thread.usage.turns += 1;
		await this.deps.store.save(thread);
		await this.runTurn(thread, apiKey);
	}

	/** Aborts the running turn and rejects any write waiting on the user. */
	stop(): void {
		if (!this.running) {
			return;
		}
		this.stopped = true;
		this.abort?.abort();
		this.pending?.resolve("rejected");
	}

	/** Answers the pending write. A mismatched id is ignored. */
	resolvePendingEdit(status: EditStatus, id?: string): void {
		if (!this.pending || (id !== undefined && id !== this.pending.id)) {
			return;
		}
		this.pending.resolve(status);
	}

	private async runTurn(thread: Thread, apiKey: string): Promise<void> {
		const config = await this.deps.host.config();
		this.running = true;
		this.stopped = false;
		this.abort = new AbortController();
		this.emit({ type: "turnStarted" });
		try {
			for (;;) {
				const result = await this.chat({
					baseUrl: config.baseUrl,
					apiKey,
					model: thread.model,
					system: thread.systemPrompt,
					messages: thread.messages as Message[],
					tools: TOOL_DEFS,
					signal: this.abort.signal,
					onDelta: (delta) => this.emit({ type: "messageDelta", text: delta }),
				});
				thread.messages.push(assistantMessage(result));
				this.addUsage(thread, result);
				if (result.toolCalls.length === 0) {
					break;
				}
				for (const call of result.toolCalls) {
					this.emit({ type: "activity", label: activityLabel(call.name, thread.mode) });
					const output = await this.runTool(thread, call);
					thread.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) } satisfies Message);
				}
				if (this.stopped) {
					break;
				}
			}
		} catch (e) {
			if (!this.stopped) {
				this.emit(errorMessage(e));
			}
		} finally {
			this.running = false;
			this.abort = undefined;
			await this.deps.store.save(thread);
			this.emit({ type: "turnEnded" });
			await this.emitThreads(thread.filePath);
		}
	}

	private async runTool(thread: Thread, call: ToolCall): Promise<unknown> {
		const unit = this.unit;
		if (!unit) {
			return { error: NO_UNIT };
		}
		switch (call.name) {
			case READ_TEXT:
				return thread.mode === "file" ? { text: numbered((await this.deps.host.document()).text) } : { text: unit.text };
			case GET_EDIT_RANGE:
				return { startLine: unit.range.start + 1, endLine: unit.range.end, kind: unit.label, text: unit.text };
			case WRITE_TEXT: {
				const prose = parseText(call.arguments);
				return prose === undefined ? { error: "write_text needs a text argument" } : await this.proposeEdit(thread, call.id, prose);
			}
			default:
				return { error: `Unknown tool ${call.name}` };
		}
	}

	private async proposeEdit(thread: Thread, callId: string, prose: string): Promise<{ status: EditStatus; error?: string }> {
		const unit = this.unit!;
		const restored = restoreUnit(unit, prose, this.languageId);
		const doc = await this.deps.host.document();
		const lines = doc.text.split(/\r?\n/);
		const { start, end } = unit.range;
		if (lines.slice(start, end).join("\n") !== unit.original) {
			this.emit({ type: "error", message: BLOCK_CHANGED, fix: "newThread" });
			return { status: "rejected", error: BLOCK_CHANGED };
		}
		const newLines = restored.split(/\r?\n/);
		const firstLine = Math.max(0, start - CONTEXT_LINES);
		const proposal: EditProposal = {
			id: `${thread.id}-${++this.editCounter}`,
			range: { start, end },
			firstLine,
			contextBefore: lines.slice(firstLine, start),
			oldLines: lines.slice(start, end),
			newLines,
			contextAfter: lines.slice(end, end + CONTEXT_LINES),
			text: restored,
		};
		this.emit({ type: "editProposed", proposal });
		const status = await new Promise<EditStatus>((resolve) => {
			this.pending = { id: proposal.id, resolve };
		});
		this.pending = undefined;
		let range: LineRange = { start, end };
		let error: string | undefined;
		let finalStatus = status;
		if (status === "accepted") {
			try {
				await this.deps.host.applyEdit(range, restored);
				range = { start, end: start + newLines.length };
				this.unit = { ...unit, range, original: restored, text: prose };
				thread.unit = { ...thread.unit!, range, original: restored, text: prose };
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				finalStatus = "rejected";
				this.emit({ type: "error", message: error });
			}
		}
		const resolution: EditResolution = { id: proposal.id, status: finalStatus, range, text: restored };
		const stored: StoredEdit = { callId, proposal, resolution };
		thread.edits.push(stored);
		this.emit({ type: "editResolved", resolution });
		return error === undefined ? { status: finalStatus } : { status: finalStatus, error };
	}

	private async setModel(model: string): Promise<void> {
		if (!this.thread) {
			return;
		}
		this.thread.model = model;
		await this.deps.host.setConfig({ model });
		await this.saveIfStarted();
	}

	private async setSystemPrompt(text: string): Promise<void> {
		const thread = this.thread;
		if (!thread) {
			return;
		}
		await this.deps.host.setConfig({ systemPrompt: text });
		thread.userPrompt = text;
		const proseMd = thread.proseMdPath ? await fs.readFile(thread.proseMdPath, "utf8") : undefined;
		thread.systemPrompt = buildSystemContent({ userPrompt: text, proseMd, mode: thread.mode, width: this.unit?.width ?? 80 });
		await this.saveIfStarted();
	}

	private async saveIfStarted(): Promise<void> {
		if (this.thread && this.thread.messages.length > 0) {
			await this.deps.store.save(this.thread);
		}
	}

	private addUsage(thread: Thread, result: ChatResult): void {
		const u = thread.usage;
		u.promptTokens += result.usage.promptTokens;
		u.completionTokens += result.usage.completionTokens;
		u.cachedTokens += result.usage.cachedTokens;
		u.cost += result.usage.cost;
		this.emit({ type: "usage", usage: { ...u } });
	}

	private async emitThread(): Promise<void> {
		const thread = this.thread!;
		this.emit({
			type: "threadLoaded",
			thread: headerOf(thread),
			mode: thread.mode,
			model: thread.model,
			systemPrompt: thread.userPrompt,
			defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
			proseMd: thread.proseMdPath ? { path: thread.proseMdPath } : { searchedFrom: thread.proseMdSearchedFrom ?? path.dirname(thread.filePath) },
			entries: entriesOf(thread),
			usage: { ...thread.usage },
		});
		this.emit({ type: "galley", unit: this.unit ?? null });
		await this.emitThreads(thread.filePath);
	}

	private async emitThreads(filePath: string): Promise<void> {
		const headers = await this.deps.store.list();
		this.emit({ type: "threads", ...groupByFile(headers, filePath) });
	}

	private async emitModels(): Promise<void> {
		const apiKey = await this.deps.host.secret(SECRET_KEY);
		let groups = FALLBACK_MODELS;
		if (apiKey) {
			try {
				const config = await this.deps.host.config();
				groups = await this.listModels({ baseUrl: config.baseUrl, apiKey, cacheDir: path.join(this.deps.host.homeDir(), ".aiprose") });
			} catch {
				groups = FALLBACK_MODELS;
			}
		}
		this.emit({ type: "models", groups });
	}

	private emit(msg: HostToUi): void {
		this.deps.sink(msg);
	}
}

function headerOf(thread: Thread) {
	const { id, title, createdAt, updatedAt, filePath, mode, model } = thread;
	return { id, title, createdAt, updatedAt, filePath, mode, model };
}

function assistantMessage(result: ChatResult): Message {
	const msg: Message = { role: "assistant", content: result.text === "" ? null : result.text };
	if (result.toolCalls.length > 0) {
		msg.tool_calls = result.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } }));
	}
	return msg;
}

/** Rebuilds the transcript the UI shows from the stored messages and edits. */
export function entriesOf(thread: Thread): Entry[] {
	const entries: Entry[] = [];
	const edits = new Map(thread.edits.map((e) => [e.callId, e]));
	for (const raw of thread.messages as Message[]) {
		if (raw.role === "user") {
			entries.push({ kind: "user", text: String(raw.content ?? "") });
		} else if (raw.role === "assistant") {
			const calls = raw.tool_calls ?? [];
			entries.push({ kind: "assistant", text: String(raw.content ?? ""), activity: calls.map((c) => activityLabel(c.function.name, thread.mode)) });
			for (const call of calls) {
				const edit = edits.get(call.id);
				if (edit) {
					entries.push({ kind: "edit", proposal: edit.proposal, resolution: edit.resolution });
				}
			}
		}
	}
	return entries;
}

function numbered(text: string): string {
	return text.split(/\r?\n/).map((line, i) => `${i + 1}: ${line}`).join("\n");
}

function parseText(args: string): string | undefined {
	try {
		const parsed = JSON.parse(args) as { text?: unknown };
		return typeof parsed.text === "string" ? parsed.text : undefined;
	} catch {
		return undefined;
	}
}

function errorMessage(e: unknown): HostToUi {
	if (e instanceof LlmError) {
		return { type: "error", message: e.message, fix: e.fix };
	}
	return { type: "error", message: e instanceof Error ? e.message : String(e) };
}
