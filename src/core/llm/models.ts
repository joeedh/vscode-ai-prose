import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ModelGroup } from "../protocol.js";
import { DEFAULT_BASE_URL, headers } from "./client.js";

export const MODEL_CACHE_MS = 60 * 60 * 1000;
export const MODEL_CACHE_FILE = "models.json";

interface ModelEntry {
	id: string;
	supported_parameters?: string[];
}

interface CacheFile {
	fetchedAt: number;
	groups: ModelGroup[];
}

const GROUPS: { label: string; match: (id: string) => boolean }[] = [
	{ label: "Anthropic", match: (id) => id.startsWith("anthropic/") },
	{ label: "Google", match: (id) => id.startsWith("google/gemini-") },
	{ label: "Z.ai", match: (id) => id === "z-ai/glm-5.3-flash" },
];

/** Groups the tool-capable base ids from a models response in API order. */
export function groupModels(entries: ModelEntry[]): ModelGroup[] {
	const groups = GROUPS.map((g) => ({ label: g.label, ids: [] as string[] }));
	for (const entry of entries) {
		if (entry.id.includes(":") || !entry.supported_parameters?.includes("tools")) {
			continue;
		}
		const index = GROUPS.findIndex((g) => g.match(entry.id));
		if (index >= 0) {
			groups[index].ids.push(entry.id);
		}
	}
	return groups;
}

/**
 * Fetches the model list, cached for `MODEL_CACHE_MS` under `cacheDir`. A
 * failed refresh returns the stale cache when one exists.
 */
export async function listModels(opts: {
	baseUrl?: string;
	apiKey?: string;
	cacheDir: string;
	fetch?: typeof fetch;
	now?: () => number;
}): Promise<ModelGroup[]> {
	const now = opts.now ?? Date.now;
	const file = path.join(opts.cacheDir, MODEL_CACHE_FILE);
	const cached = await readCache(file);
	if (cached && now() - cached.fetchedAt < MODEL_CACHE_MS) {
		return cached.groups;
	}
	try {
		const doFetch = opts.fetch ?? fetch;
		const response = await doFetch(`${opts.baseUrl ?? DEFAULT_BASE_URL}/models`, {
			headers: opts.apiKey ? headers(opts.apiKey) : undefined,
		});
		if (!response.ok) {
			throw new Error(`models endpoint returned ${response.status}`);
		}
		const parsed = (await response.json()) as { data?: ModelEntry[] };
		const groups = groupModels(parsed.data ?? []);
		await mkdir(opts.cacheDir, { recursive: true });
		await writeFile(file, JSON.stringify({ fetchedAt: now(), groups } satisfies CacheFile));
		return groups;
	} catch (e) {
		if (cached) {
			return cached.groups;
		}
		throw e;
	}
}

async function readCache(file: string): Promise<CacheFile | undefined> {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8")) as CacheFile;
		if (typeof parsed.fetchedAt === "number" && Array.isArray(parsed.groups)) {
			return parsed;
		}
	} catch {
		return undefined;
	}
	return undefined;
}
