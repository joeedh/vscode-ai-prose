import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { chat } from "./client.js";

// Runs only under `pnpm test:live`, and only against the one cheap model the key is allowed for
const KEY_FILE = path.resolve(__dirname, "..", "..", "..", "keys", "openrouter.txt");
const LIVE_MODEL = "z-ai/glm-5.3-flash";

describe.skipIf(!existsSync(KEY_FILE))("live OpenRouter", () => {
	it("streams a short reply with a usage block", async () => {
		const apiKey = readFileSync(KEY_FILE, "utf8").trim();
		const deltas: string[] = [];
		const result = await chat({
			apiKey,
			model: LIVE_MODEL,
			system: "Reply with plain text only. Keep it under twenty words.",
			messages: [{ role: "user", content: "Say hello and name one color." }],
			tools: [],
			onDelta: (t) => deltas.push(t),
		});
		expect(result.text.length).toBeGreaterThan(0);
		expect(deltas.join("")).toBe(result.text);
		expect(result.finishReason).toBe("stop");
		expect(result.usage.promptTokens).toBeGreaterThan(0);
		expect(result.usage.completionTokens).toBeGreaterThan(0);
	});
});
