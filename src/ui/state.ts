import type {
	Entry,
	HostToUi,
	LineRange,
	Mode,
	ModelGroup,
	ProseMdInfo,
	ThreadHeader,
	Unit,
	Usage,
} from "../core/protocol";

export interface State {
	thread?: ThreadHeader;
	mode: Mode;
	model: string;
	systemPrompt: string;
	defaultSystemPrompt: string;
	proseMd?: ProseMdInfo;
	entries: Entry[];
	usage: Usage;
	unit: Unit | null;
	galleyReason?: string;
	running: boolean;
	threads: { current: ThreadHeader[]; other: ThreadHeader[] };
	models: ModelGroup[];
}

export const emptyUsage: Usage = {
	turns: 0,
	promptTokens: 0,
	completionTokens: 0,
	cachedTokens: 0,
	cost: 0,
};

export const initialState: State = {
	mode: "strict",
	model: "",
	systemPrompt: "",
	defaultSystemPrompt: "",
	entries: [],
	usage: emptyUsage,
	unit: null,
	running: false,
	threads: { current: [], other: [] },
	models: [],
};

export type Action = { type: "host"; msg: HostToUi } | { type: "sent"; text: string } | { type: "stopped" };

/** Applies a host message or a local action to the state without mutating it. */
export function reduce(state: State, action: Action): State {
	if (action.type === "sent") {
		return { ...state, running: true, entries: [...state.entries, { kind: "user", text: action.text }] };
	}
	if (action.type === "stopped") {
		return { ...state, running: false };
	}
	const msg = action.msg;
	switch (msg.type) {
		case "threadLoaded":
			return {
				...state,
				thread: msg.thread,
				mode: msg.mode,
				model: msg.model,
				systemPrompt: msg.systemPrompt,
				defaultSystemPrompt: msg.defaultSystemPrompt,
				proseMd: msg.proseMd,
				entries: msg.entries,
				usage: msg.usage,
				running: false,
			};
		case "galley":
			return { ...state, unit: msg.unit, galleyReason: msg.reason };
		case "turnStarted":
			return { ...state, running: true, entries: [...state.entries, { kind: "assistant", text: "", activity: [] }] };
		case "messageDelta":
			return { ...state, entries: appendAssistant(state.entries, (e) => ({ ...e, text: e.text + msg.text })) };
		case "activity":
			return {
				...state,
				entries: appendAssistant(state.entries, (e) => ({ ...e, activity: [...e.activity, msg.label] })),
			};
		case "editProposed":
			return { ...state, entries: [...state.entries, { kind: "edit", proposal: msg.proposal }] };
		case "editResolved":
			return {
				...state,
				entries: state.entries.map((e) =>
					e.kind === "edit" && e.proposal.id === msg.resolution.id ? { ...e, resolution: msg.resolution } : e,
				),
			};
		case "usage":
			return { ...state, usage: msg.usage };
		case "turnEnded":
			return { ...state, running: false };
		case "error":
			return { ...state, running: false, entries: [...state.entries, { kind: "error", message: msg.message, fix: msg.fix }] };
		case "threads": {
			// The list carries the current thread's header too, which is where a new title first shows up
			const header = msg.current.find((t) => t.id === state.thread?.id);
			return { ...state, thread: header ?? state.thread, threads: { current: msg.current, other: msg.other } };
		}
		case "models":
			return { ...state, models: msg.groups };
	}
}

type AssistantEntry = Extract<Entry, { kind: "assistant" }>;

// Streams into the trailing assistant entry, opening one when the last entry is something else
function appendAssistant(entries: Entry[], update: (e: AssistantEntry) => AssistantEntry): Entry[] {
	const last = entries[entries.length - 1];
	if (last && last.kind === "assistant") {
		return [...entries.slice(0, -1), update(last)];
	}
	return [...entries, update({ kind: "assistant", text: "", activity: [] })];
}

/** Formats a zero-based exclusive range as the one-based "lines 38–40" the design shows. */
export function rangeLabel(range: LineRange): string {
	const first = range.start + 1;
	const last = range.end;
	return last <= first ? `line ${first}` : `lines ${first}–${last}`;
}

export function formatTokens(n: number): string {
	if (n < 1000) {
		return String(n);
	}
	return `${(n / 1000).toFixed(1)}k`;
}

export function formatUsage(u: Usage): string {
	const tokens = u.promptTokens + u.completionTokens;
	const cached = u.promptTokens > 0 ? Math.round((u.cachedTokens / u.promptTokens) * 100) : 0;
	const turns = u.turns === 1 ? "1 turn" : `${u.turns} turns`;
	return `${turns} · ${formatTokens(tokens)} tokens · ${cached}% from cache · $${u.cost.toFixed(3)}`;
}

/** Writes `target` relative to the directory holding `fromFile`, using forward slashes. */
export function relativePath(fromFile: string, target: string): string {
	const split = (p: string) => p.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
	const from = split(fromFile);
	from.pop();
	const to = split(target);
	let common = 0;
	while (common < from.length && common < to.length && from[common].toLowerCase() === to[common].toLowerCase()) {
		common++;
	}
	const ups = from.length - common;
	const parts = [...new Array<string>(ups).fill(".."), ...to.slice(common)];
	return parts.join("/");
}
