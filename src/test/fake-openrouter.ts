import * as http from "node:http";
import type { AddressInfo } from "node:net";

/** A scripted reply the fake server streams for one chat request. */
export interface FakeReply {
	text?: string;
	toolCalls?: { id: string; name: string; arguments: string }[];
	usage?: Partial<FakeUsage>;
	/** Emits an error event after the text and ends the stream without `[DONE]`. */
	midStreamError?: string;
	finishReason?: string;
	/** Characters of text per chunk. */
	chunkSize?: number;
	/** Pause before each chunk, so a test can abort mid-stream. */
	delayMs?: number;
}

export interface FakeUsage {
	prompt_tokens: number;
	completion_tokens: number;
	cached_tokens: number;
	cost: number | undefined;
}

/** A non-200 status with an OpenRouter-style error body. */
export interface FakeStatus {
	status: number;
	message?: string;
}

export type FakeResponse = FakeReply | FakeStatus;

export interface FakeRequest {
	method: string;
	path: string;
	headers: http.IncomingHttpHeaders;
	body: unknown;
}

export interface FakeModel {
	id: string;
	supported_parameters: string[];
}

export interface FakeOpenRouter {
	/** Base URL ending in `/api/v1`. */
	url: string;
	/** Queues a response for the next chat request. */
	script(response: FakeResponse): void;
	/** Sets the list `GET /models` returns. */
	scriptModels(models: FakeModel[]): void;
	requests: FakeRequest[];
	close(): Promise<void>;
}

const DEFAULT_USAGE: FakeUsage = { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 0, cost: 0.0004 };

/** Starts a fake OpenRouter on a free port that replays scripted responses. */
export async function startFakeOpenRouter(): Promise<FakeOpenRouter> {
	const queue: FakeResponse[] = [];
	let models: FakeModel[] = [];
	const requests: FakeRequest[] = [];
	const sockets = new Set<import("node:net").Socket>();

	const server = http.createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(chunk as Buffer);
		}
		const raw = Buffer.concat(chunks).toString("utf8");
		const record: FakeRequest = {
			method: req.method ?? "",
			path: req.url ?? "",
			headers: req.headers,
			body: raw ? JSON.parse(raw) : undefined,
		};
		requests.push(record);

		if (record.method === "GET" && record.path.endsWith("/models")) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ data: models }));
			return;
		}
		const next = queue.shift();
		if (!next) {
			sendStatus(res, { status: 500, message: "no scripted response" });
			return;
		}
		if ("status" in next) {
			sendStatus(res, next);
			return;
		}
		await streamReply(res, next);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}/api/v1`,
		script: (response) => queue.push(response),
		scriptModels: (list) => {
			models = list;
		},
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of sockets) {
					socket.destroy();
				}
				server.close(() => resolve());
			}),
	};
}

function sendStatus(res: http.ServerResponse, status: FakeStatus) {
	res.writeHead(status.status, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: { code: status.status, message: status.message ?? "scripted error" } }));
}

async function streamReply(res: http.ServerResponse, reply: FakeReply) {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
	});
	const delay = () => (reply.delayMs ? new Promise((r) => setTimeout(r, reply.delayMs)) : undefined);
	const send = (payload: unknown) => {
		res.write(`data: ${JSON.stringify(payload)}\n\n`);
	};
	const choice = (delta: object, finish: string | null = null) => ({
		choices: [{ index: 0, delta, finish_reason: finish }],
	});

	res.write(": OPENROUTER PROCESSING\n\n");
	const size = reply.chunkSize ?? 5;
	const text = reply.text ?? "";
	for (let i = 0; i < text.length; i += size) {
		await delay();
		if (res.destroyed) {
			return;
		}
		send(choice({ role: "assistant", content: text.slice(i, i + size) }));
		if (i === 0) {
			res.write(": OPENROUTER PROCESSING\n\n");
		}
	}
	if (reply.midStreamError !== undefined) {
		send({
			error: { code: "server_error", message: reply.midStreamError },
			choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
		});
		res.end();
		return;
	}
	const calls = reply.toolCalls ?? [];
	calls.forEach((call, index) => {
		send(choice({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.name, arguments: "" } }] }));
		const half = Math.ceil(call.arguments.length / 2);
		for (const piece of [call.arguments.slice(0, half), call.arguments.slice(half)]) {
			if (piece) {
				send(choice({ tool_calls: [{ index, function: { arguments: piece } }] }));
			}
		}
	});
	await delay();
	const finish = reply.finishReason ?? (calls.length > 0 ? "tool_calls" : "stop");
	const usage = { ...DEFAULT_USAGE, ...reply.usage };
	send({
		...choice({ role: "assistant", content: "" }, finish),
		usage: {
			prompt_tokens: usage.prompt_tokens,
			completion_tokens: usage.completion_tokens,
			total_tokens: usage.prompt_tokens + usage.completion_tokens,
			...(usage.cost === undefined ? {} : { cost: usage.cost }),
			prompt_tokens_details: { cached_tokens: usage.cached_tokens, cache_write_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 0 },
		},
	});
	res.write("data: [DONE]\n\n");
	res.end();
}
