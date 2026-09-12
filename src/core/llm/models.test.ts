import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeOpenRouter, type FakeModel, type FakeOpenRouter } from "../../test/fake-openrouter.js";
import { groupModels, listModels, MODEL_CACHE_FILE, MODEL_CACHE_MS } from "./models.js";

const MODELS: FakeModel[] = [
	{ id: "anthropic/claude-sonnet-5", supported_parameters: ["tools"] },
	{ id: "anthropic/claude-sonnet-5:batch", supported_parameters: ["tools"] },
	{ id: "anthropic/claude-3-haiku:free", supported_parameters: ["tools"] },
	{ id: "google/gemini-3.8-flash", supported_parameters: ["tools"] },
	{ id: "google/gemini-3.1-flash-image", supported_parameters: ["max_tokens"] },
	{ id: "google/gemma-3", supported_parameters: ["tools"] },
	{ id: "z-ai/glm-5.3-flash", supported_parameters: ["tools"] },
	{ id: "z-ai/glm-5.3", supported_parameters: ["tools"] },
	{ id: "~anthropic/claude-sonnet-latest", supported_parameters: ["tools"] },
	{ id: "openai/gpt-5", supported_parameters: ["tools"] },
];

describe("groupModels", () => {
	it("keeps tool-capable base ids in the three groups", () => {
		expect(groupModels(MODELS)).toEqual([
			{ label: "Anthropic", ids: ["anthropic/claude-sonnet-5"] },
			{ label: "Google", ids: ["google/gemini-3.8-flash"] },
			{ label: "Z.ai", ids: ["z-ai/glm-5.3-flash"] },
		]);
	});
});

describe("listModels", () => {
	let server: FakeOpenRouter;
	let dir: string;

	beforeEach(async () => {
		server = await startFakeOpenRouter();
		server.scriptModels(MODELS);
		dir = await mkdtemp(path.join(os.tmpdir(), "aiprose-models-"));
	});

	afterEach(async () => {
		await server.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("fetches once and serves the cache within an hour", async () => {
		let clock = 1_000_000;
		const now = () => clock;
		const first = await listModels({ baseUrl: server.url, apiKey: "k", cacheDir: dir, now });
		expect(first[2].ids).toEqual(["z-ai/glm-5.3-flash"]);
		expect(server.requests).toHaveLength(1);
		expect(server.requests[0].headers.authorization).toBe("Bearer k");
		const written = JSON.parse(await readFile(path.join(dir, MODEL_CACHE_FILE), "utf8")) as { fetchedAt: number };
		expect(written.fetchedAt).toBe(1_000_000);

		clock += MODEL_CACHE_MS - 1;
		await listModels({ baseUrl: server.url, apiKey: "k", cacheDir: dir, now });
		expect(server.requests).toHaveLength(1);

		clock += 2;
		server.scriptModels([{ id: "anthropic/claude-opus-5", supported_parameters: ["tools"] }]);
		const refreshed = await listModels({ baseUrl: server.url, apiKey: "k", cacheDir: dir, now });
		expect(server.requests).toHaveLength(2);
		expect(refreshed[0].ids).toEqual(["anthropic/claude-opus-5"]);
	});

	it("falls back to a stale cache when the refresh fails", async () => {
		let clock = 0;
		const now = () => clock;
		await listModels({ baseUrl: server.url, cacheDir: dir, now });
		clock = MODEL_CACHE_MS + 1;
		await server.close();
		const stale = await listModels({ baseUrl: server.url, cacheDir: dir, now });
		expect(stale[0].ids).toEqual(["anthropic/claude-sonnet-5"]);
		server = await startFakeOpenRouter();
	});

	it("throws when there is no cache and the fetch fails", async () => {
		await server.close();
		await expect(listModels({ baseUrl: server.url, cacheDir: dir })).rejects.toThrow();
		server = await startFakeOpenRouter();
	});
});
