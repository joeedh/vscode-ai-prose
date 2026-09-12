import { buildRequest, type Message, type ToolDef } from "./messages.js";
import { sseEvents } from "./sse.js";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface ToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface TurnUsage {
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number;
	cost: number;
}

export interface ChatResult {
	text: string;
	toolCalls: ToolCall[];
	usage: TurnUsage;
	finishReason: string;
}

/** A failure the UI can show verbatim, with an optional fix link. */
export class LlmError extends Error {
	fix?: "apiKey";
	status?: number;
	constructor(message: string, opts: { fix?: "apiKey"; status?: number } = {}) {
		super(message);
		this.name = "LlmError";
		this.fix = opts.fix;
		this.status = opts.status;
	}
}

export const MESSAGES = {
	missingKey: "OpenRouter key is missing. Set one.",
	badKey: "OpenRouter rejected the key. Set a new one.",
	noCredit: "The OpenRouter account has no credit.",
	rateLimited: "OpenRouter is rate limiting this key. Try again in a moment.",
	midReply: "OpenRouter failed mid-reply. Send again.",
	unreachable: "Could not reach OpenRouter.",
} as const;

export interface ChatOptions {
	baseUrl?: string;
	apiKey: string;
	model: string;
	system: string;
	messages: Message[];
	tools: ToolDef[];
	signal?: AbortSignal;
	onDelta?: (text: string) => void;
	/** Called once per tool call as soon as its name is known. */
	onToolCall?: (name: string) => void;
	fetch?: typeof fetch;
}

interface StreamChunk {
	error?: { code?: unknown; message?: string };
	choices?: {
		delta?: {
			content?: string | null;
			tool_calls?: {
				index: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}[];
		};
		finish_reason?: string | null;
	}[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		cost?: number;
		prompt_tokens_details?: { cached_tokens?: number };
	};
}

export function headers(apiKey: string): Record<string, string> {
	return {
		"Authorization": `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		"HTTP-Referer": "https://github.com/joeedh/vscode-ai-prose",
		"X-Title": "ai-prose",
	};
}

/** Streams one chat completion and returns the assembled reply. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
	if (!opts.apiKey) {
		throw new LlmError(MESSAGES.missingKey, { fix: "apiKey" });
	}
	const doFetch = opts.fetch ?? fetch;
	const url = `${opts.baseUrl ?? DEFAULT_BASE_URL}/chat/completions`;
	const body = buildRequest(opts);
	let response: Response;
	try {
		response = await doFetch(url, {
			method: "POST",
			headers: headers(opts.apiKey),
			body: JSON.stringify(body),
			signal: opts.signal,
		});
	} catch (e) {
		if (isAbort(e)) {
			throw e;
		}
		throw new LlmError(MESSAGES.unreachable);
	}
	if (!response.ok) {
		throw await statusError(response);
	}
	if (!response.body) {
		throw new LlmError(MESSAGES.midReply);
	}
	return readStream(response.body, opts);
}

async function readStream(body: ReadableStream<Uint8Array>, opts: ChatOptions): Promise<ChatResult> {
	let text = "";
	let finishReason = "";
	let usage: TurnUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
	const calls = new Map<number, ToolCall>();
	let sawDone = false;
	try {
		for await (const event of sseEvents(body)) {
			if (event === "[DONE]") {
				sawDone = true;
				break;
			}
			let chunk: StreamChunk;
			try {
				chunk = JSON.parse(event) as StreamChunk;
			} catch {
				throw new LlmError(MESSAGES.midReply);
			}
			if (chunk.error) {
				throw new LlmError(MESSAGES.midReply);
			}
			const choice = chunk.choices?.[0];
			if (choice?.delta?.content) {
				text += choice.delta.content;
				opts.onDelta?.(choice.delta.content);
			}
			for (const delta of choice?.delta?.tool_calls ?? []) {
				let call = calls.get(delta.index);
				if (!call) {
					call = { id: delta.id ?? "", name: "", arguments: "" };
					calls.set(delta.index, call);
				}
				if (delta.id) {
					call.id = delta.id;
				}
				if (delta.function?.name) {
					call.name += delta.function.name;
					opts.onToolCall?.(call.name);
				}
				if (delta.function?.arguments) {
					call.arguments += delta.function.arguments;
				}
			}
			if (choice?.finish_reason) {
				finishReason = choice.finish_reason;
			}
			if (chunk.usage) {
				usage = {
					promptTokens: chunk.usage.prompt_tokens ?? 0,
					completionTokens: chunk.usage.completion_tokens ?? 0,
					cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
					cost: chunk.usage.cost ?? 0,
				};
			}
		}
	} catch (e) {
		if (isAbort(e) || opts.signal?.aborted) {
			throw abortError();
		}
		if (e instanceof LlmError) {
			throw e;
		}
		throw new LlmError(MESSAGES.midReply);
	}
	if (!sawDone) {
		throw new LlmError(MESSAGES.midReply);
	}
	return {
		text,
		toolCalls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c),
		usage,
		finishReason,
	};
}

async function statusError(response: Response): Promise<LlmError> {
	const status = response.status;
	if (status === 401) {
		return new LlmError(MESSAGES.badKey, { fix: "apiKey", status });
	}
	if (status === 402) {
		return new LlmError(MESSAGES.noCredit, { status });
	}
	if (status === 429) {
		return new LlmError(MESSAGES.rateLimited, { status });
	}
	if (status >= 500) {
		return new LlmError(MESSAGES.midReply, { status });
	}
	let detail = "";
	try {
		const parsed = (await response.json()) as { error?: { message?: string } };
		detail = parsed.error?.message ?? "";
	} catch {
		detail = "";
	}
	return new LlmError(`OpenRouter rejected the request (${status})${detail ? `: ${detail}` : "."}`, { status });
}

function isAbort(e: unknown): boolean {
	return e instanceof Error && e.name === "AbortError";
}

function abortError(): Error {
	return new DOMException("The request was aborted.", "AbortError");
}
