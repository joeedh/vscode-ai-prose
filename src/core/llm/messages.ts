/** OpenAI-format chat messages and the request body the client sends. */

export interface CacheControl {
	type: "ephemeral";
}

export interface TextPart {
	type: "text";
	text: string;
	cache_control?: CacheControl;
}

export interface ApiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export type Message =
	| { role: "system"; content: string | TextPart[] }
	| { role: "user"; content: string | TextPart[] }
	| { role: "assistant"; content: string | null; tool_calls?: ApiToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

/** A tool the model may call, with a JSON schema for its arguments. */
export interface ToolDef {
	name: string;
	description: string;
	parameters: object;
}

export interface ChatRequest {
	model: string;
	stream: true;
	cache_control: CacheControl;
	messages: Message[];
	tools?: { type: "function"; function: ToolDef }[];
}

/**
 * Builds the streaming request body with both cache breakpoints: an explicit
 * one on the system text part and the top-level one OpenRouter moves to the
 * last cacheable block.
 */
export function buildRequest(opts: {
	model: string;
	system: string;
	messages: Message[];
	tools: ToolDef[];
}): ChatRequest {
	const system: Message = {
		role: "system",
		content: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
	};
	const body: ChatRequest = {
		model: opts.model,
		stream: true,
		cache_control: { type: "ephemeral" },
		messages: [system, ...opts.messages],
	};
	if (opts.tools.length > 0) {
		body.tools = opts.tools.map((t) => ({ type: "function", function: t }));
	}
	return body;
}
