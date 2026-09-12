import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeOpenRouter, type FakeOpenRouter } from "../../test/fake-openrouter.js";
import { chat, LlmError, MESSAGES, type ChatOptions } from "./client.js";
import { buildRequest, type Message } from "./messages.js";

let server: FakeOpenRouter;

beforeEach(async () => {
	server = await startFakeOpenRouter();
});

afterEach(async () => {
	await server.close();
});

function options(overrides: Partial<ChatOptions> = {}): ChatOptions {
	return {
		baseUrl: server.url,
		apiKey: "sk-test",
		model: "z-ai/glm-5.3-flash",
		system: "You are an editor.",
		messages: [{ role: "user", content: "Hello" }],
		tools: [],
		...overrides,
	};
}

async function failure(opts: ChatOptions): Promise<LlmError> {
	try {
		await chat(opts);
	} catch (e) {
		if (e instanceof LlmError) {
			return e;
		}
		throw e;
	}
	throw new Error("chat did not throw");
}

describe("chat", () => {
	it("streams a text reply and reports each delta", async () => {
		server.script({ text: "Hello there, friend.", chunkSize: 4 });
		const deltas: string[] = [];
		const result = await chat(options({ onDelta: (t) => deltas.push(t) }));
		expect(result.text).toBe("Hello there, friend.");
		expect(deltas.join("")).toBe("Hello there, friend.");
		expect(deltas.length).toBeGreaterThan(1);
		expect(result.finishReason).toBe("stop");
		expect(result.toolCalls).toEqual([]);
	});

	it("sends the key, the attribution headers, and the streaming body", async () => {
		server.script({ text: "ok" });
		await chat(options());
		const request = server.requests[0];
		expect(request.path).toBe("/api/v1/chat/completions");
		expect(request.headers.authorization).toBe("Bearer sk-test");
		expect(request.headers["x-title"]).toBe("ai-prose");
		expect((request.body as { stream: boolean }).stream).toBe(true);
		expect((request.body as { model: string }).model).toBe("z-ai/glm-5.3-flash");
	});

	it("assembles a tool call split across chunks", async () => {
		server.script({ toolCalls: [{ id: "call_1", name: "read_text", arguments: '{"reason":"look"}' }] });
		const names: string[] = [];
		const result = await chat(
			options({
				tools: [{ name: "read_text", description: "Reads the block.", parameters: { type: "object", properties: {} } }],
				onToolCall: (n) => names.push(n),
			}),
		);
		expect(result.toolCalls).toEqual([{ id: "call_1", name: "read_text", arguments: '{"reason":"look"}' }]);
		expect(names).toEqual(["read_text"]);
		expect(result.finishReason).toBe("tool_calls");
		const body = server.requests[0].body as { tools: { type: string; function: { name: string } }[] };
		expect(body.tools).toEqual([
			{ type: "function", function: { name: "read_text", description: "Reads the block.", parameters: { type: "object", properties: {} } } },
		]);
	});

	it("returns two tool calls from one turn in order", async () => {
		server.script({
			text: "Checking.",
			toolCalls: [
				{ id: "a", name: "read_text", arguments: "{}" },
				{ id: "b", name: "get_edit_range", arguments: "{}" },
			],
		});
		const result = await chat(options());
		expect(result.text).toBe("Checking.");
		expect(result.toolCalls.map((c) => c.id)).toEqual(["a", "b"]);
		expect(result.toolCalls.map((c) => c.name)).toEqual(["read_text", "get_edit_range"]);
	});

	it("throws an AbortError when the signal fires mid-stream", async () => {
		server.script({ text: "a".repeat(200), chunkSize: 5, delayMs: 20 });
		const controller = new AbortController();
		const deltas: string[] = [];
		const promise = chat(
			options({
				signal: controller.signal,
				onDelta: (t) => {
					deltas.push(t);
					if (deltas.length === 3) {
						controller.abort();
					}
				},
			}),
		);
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(deltas.length).toBeLessThan(40);
	});

	it("refuses to send without a key", async () => {
		const error = await failure(options({ apiKey: "" }));
		expect(error.message).toBe(MESSAGES.missingKey);
		expect(error.fix).toBe("apiKey");
		expect(server.requests).toHaveLength(0);
	});

	it.each([
		[401, MESSAGES.badKey, "apiKey"],
		[402, MESSAGES.noCredit, undefined],
		[429, MESSAGES.rateLimited, undefined],
		[500, MESSAGES.midReply, undefined],
		[503, MESSAGES.midReply, undefined],
	])("maps status %i to its message", async (status, message, fix) => {
		server.script({ status });
		const error = await failure(options());
		expect(error.message).toBe(message);
		expect(error.fix).toBe(fix);
		expect(error.status).toBe(status);
	});

	it("shows the body message for another 4xx status", async () => {
		server.script({ status: 400, message: "model not found" });
		const error = await failure(options());
		expect(error.message).toBe("OpenRouter rejected the request (400): model not found");
	});

	it("reports a network failure", async () => {
		await server.close();
		const error = await failure(options());
		expect(error.message).toBe(MESSAGES.unreachable);
		server = await startFakeOpenRouter();
	});

	it("treats an error event in a 200 stream as a failure", async () => {
		server.script({ text: "partial", midStreamError: "Provider disconnected unexpectedly" });
		const deltas: string[] = [];
		const error = await failure(options({ onDelta: (t) => deltas.push(t) }));
		expect(error.message).toBe(MESSAGES.midReply);
		expect(deltas.join("")).toBe("partial");
	});

	it("parses usage with cached tokens and cost", async () => {
		server.script({ text: "ok", usage: { prompt_tokens: 1200, completion_tokens: 30, cached_tokens: 1000, cost: 0.0021 } });
		const result = await chat(options());
		expect(result.usage).toEqual({ promptTokens: 1200, completionTokens: 30, cachedTokens: 1000, cost: 0.0021 });
	});

	it("treats absent cached tokens and cost as zero", async () => {
		server.script({ text: "ok", usage: { prompt_tokens: 50, completion_tokens: 5, cached_tokens: 0, cost: undefined } });
		const result = await chat(options());
		expect(result.usage).toEqual({ promptTokens: 50, completionTokens: 5, cachedTokens: 0, cost: 0 });
	});
});

describe("buildRequest", () => {
	it("places one explicit breakpoint on the system part and one at the top level", () => {
		const messages: Message[] = [
			{ role: "user", content: "Tighten this." },
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "c1", type: "function", function: { name: "read_text", arguments: "{}" } }],
			},
			{ role: "tool", tool_call_id: "c1", content: "the block" },
			{ role: "assistant", content: "Done." },
			{ role: "user", content: "Shorter." },
			{ role: "assistant", content: "Shorter now." },
			{ role: "user", content: "Once more." },
		];
		const body = buildRequest({ model: "m", system: "sys", messages, tools: [] });
		expect(body.cache_control).toEqual({ type: "ephemeral" });
		expect(body.messages[0]).toEqual({
			role: "system",
			content: [{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }],
		});
		expect(body.messages.slice(1)).toEqual(messages);
		const marked = JSON.stringify(body.messages).match(/cache_control/g) ?? [];
		expect(marked).toHaveLength(1);
		for (const message of body.messages) {
			if (message.role === "tool") {
				expect(JSON.stringify(message)).not.toContain("cache_control");
			}
		}
		expect(body.tools).toBeUndefined();
	});
});
