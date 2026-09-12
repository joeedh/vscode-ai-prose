import type { JSX } from "preact";
import { useLayoutEffect, useReducer, useState } from "preact/hooks";
import type { FixKind, Mode, ThreadHeader, UiToHost } from "../core/protocol";
import { EditCard } from "./edit-card";
import { formatUsage, initialState, rangeLabel, reduce, relativePath, type State } from "./state";
import type { Transport } from "./transport";

type Post = (msg: UiToHost) => void;

const OTHER = "__other";
const NEW_THREAD = "__new";

function Toolbar({ state, post, onOpenSheet }: { state: State; post: Post; onOpenSheet: () => void }) {
	const known = state.models.some((g) => g.ids.includes(state.model));
	const [other, setOther] = useState(known ? "" : state.model);
	const [pickedOther, setPickedOther] = useState(false);
	// The model list arrives after the thread, so the field follows the list rather than the first render
	const showOther = pickedOther || (!known && state.model !== "");
	const modelValue = known && !pickedOther ? state.model : OTHER;

	const onThread = (e: Event) => {
		const value = (e.currentTarget as HTMLSelectElement).value;
		if (value === NEW_THREAD) {
			post({ type: "newThread" });
		} else if (value !== state.thread?.id) {
			post({ type: "openThread", id: value });
		}
	};
	const onModel = (e: Event) => {
		const value = (e.currentTarget as HTMLSelectElement).value;
		if (value === OTHER) {
			setPickedOther(true);
		} else {
			setPickedOther(false);
			post({ type: "setModel", model: value });
		}
	};
	const commitOther = (value: string) => {
		const id = value.trim();
		if (id !== "" && id !== state.model) {
			post({ type: "setModel", model: id });
		}
		setPickedOther(false);
	};
	const onMode = (mode: Mode) => {
		if (mode !== state.mode) {
			post({ type: "setMode", mode });
		}
	};
	const otherThreads = state.threads.current.filter((t) => t.id !== state.thread?.id);
	const option = (t: ThreadHeader) => (
		<option value={t.id} key={t.id}>
			{t.title}
		</option>
	);

	return (
		<header class="toolbar">
			<select class="thread-sel" aria-label="Thread" value={state.thread?.id ?? NEW_THREAD} onChange={onThread}>
				{state.thread && option(state.thread)}
				<option value={NEW_THREAD}>New thread</option>
				{otherThreads.length > 0 && <option disabled>── {state.thread?.filePath ?? "this file"} ──</option>}
				{otherThreads.map(option)}
				{state.threads.other.length > 0 && <option disabled>── other files ──</option>}
				{state.threads.other.map(option)}
			</select>
			<select class="model-sel" aria-label="Model" value={modelValue} onChange={onModel}>
				{state.models.map((g) => (
					<optgroup label={g.label} key={g.label}>
						{g.ids.map((id) => (
							<option value={id} key={id}>
								{id}
							</option>
						))}
					</optgroup>
				))}
				<option value={OTHER}>Other model id…</option>
			</select>
			{showOther && (
				<input
					class="model-other"
					aria-label="Model id"
					placeholder="vendor/model"
					value={other !== "" || known ? other : state.model}
					onInput={(e) => setOther((e.currentTarget as HTMLInputElement).value)}
					onBlur={(e) => commitOther((e.currentTarget as HTMLInputElement).value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							commitOther((e.currentTarget as HTMLInputElement).value);
						}
					}}
				/>
			)}
			<div class="seg" role="radiogroup" aria-label="Mode">
				<button
					role="radio"
					aria-checked={state.mode === "strict"}
					title="Only this comment or paragraph is visible to the model"
					onClick={() => onMode("strict")}
				>
					Strict
				</button>
				<button
					role="radio"
					aria-checked={state.mode === "file"}
					title="The whole file is visible to the model"
					onClick={() => onMode("file")}
				>
					File
				</button>
			</div>
			<button class="quiet" onClick={onOpenSheet}>
				System prompt
			</button>
		</header>
	);
}

function Galley({ state }: { state: State }) {
	const [showAll, setShowAll] = useState(false);
	const unit = state.unit;
	if (!unit) {
		return (
			<article class="galley empty" aria-label="Block in view">
				<p>{state.galleyReason ?? "Put the cursor in a comment or a paragraph to start."}</p>
			</article>
		);
	}
	const filePath = state.thread?.filePath ?? "";
	const style =
		state.proseMd && "path" in state.proseMd ? `Style from ${relativePath(filePath, state.proseMd.path)}` : null;
	const lines = unit.text.split("\n");
	const collapsed = unit.kind === "file" && !showAll && lines.length > 3;
	const body = collapsed ? lines.slice(0, 3).join("\n") : unit.text;
	return (
		<article class="galley" aria-label="Block in view">
			<div class="margin">
				<span>
					<b>{filePath}</b>
				</span>
				<span>{unit.kind === "file" ? "whole file" : rangeLabel(unit.range)}</span>
				{unit.kind !== "file" && <span>{unit.label}</span>}
				{style && <span>{style}</span>}
			</div>
			<p>{body}</p>
			{collapsed && (
				<button class="link" onClick={() => setShowAll(true)}>
					Show all
				</button>
			)}
		</article>
	);
}

function fixLabel(kind: FixKind): string {
	return kind === "apiKey" ? "Set key" : "New thread";
}

function Transcript({ state, post }: { state: State; post: Post }) {
	const items: JSX.Element[] = [];
	state.entries.forEach((entry, i) => {
		const prev = state.entries[i - 1];
		const last = i === state.entries.length - 1;
		if (entry.kind === "user") {
			items.push(
				<div class="msg user" key={i}>
					<div class="who">You</div>
					<Paragraphs text={entry.text} />
				</div>,
			);
		} else if (entry.kind === "assistant") {
			const continues = prev !== undefined && prev.kind === "edit";
			items.push(
				<div class="msg assistant" key={i}>
					{!continues && <div class="who">Editor</div>}
					{entry.activity.length > 0 && <div class="activity">{entry.activity.join(" · ")}</div>}
					<Paragraphs text={entry.text} caret={last && state.running} />
				</div>,
			);
		} else if (entry.kind === "edit") {
			const continues = prev !== undefined && (prev.kind === "assistant" || prev.kind === "edit");
			items.push(
				<div class="msg assistant" key={i}>
					{!continues && <div class="who">Editor</div>}
					<EditCard proposal={entry.proposal} resolution={entry.resolution} post={post} />
				</div>,
			);
		} else {
			items.push(
				<div class="error" role="alert" key={i}>
					<span>{entry.message}</span>
					{entry.fix && (
						<button class="link" onClick={() => post({ type: "openFix", kind: entry.fix! })}>
							{fixLabel(entry.fix)}
						</button>
					)}
				</div>,
			);
		}
	});
	return <>{items}</>;
}

function Paragraphs({ text, caret }: { text: string; caret?: boolean }) {
	const parts = text.split(/\n{2,}/);
	return (
		<>
			{parts.map((p, i) => (
				<p key={i}>
					{p}
					{caret && i === parts.length - 1 && <span class="caret" aria-hidden="true" />}
				</p>
			))}
		</>
	);
}

function Composer({ state, post, dispatch }: { state: State; post: Post; dispatch: (a: { type: "sent"; text: string } | { type: "stopped" }) => void }) {
	const [text, setText] = useState("");
	const send = (value: string) => {
		const trimmed = value.trim();
		if (trimmed === "" || state.running) {
			return;
		}
		post({ type: "send", text: trimmed });
		dispatch({ type: "sent", text: trimmed });
		setText("");
	};
	const stop = () => {
		post({ type: "stop" });
		dispatch({ type: "stopped" });
	};
	// Reads the element so a key pressed before the last input re-rendered still sends the full text
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send((e.currentTarget as HTMLTextAreaElement).value);
		}
	};
	const rows = Math.min(6, Math.max(1, text.split("\n").length));
	return (
		<footer class="composer">
			<div class="row">
				<textarea
					rows={rows}
					placeholder="Ask for a change"
					aria-label="Ask for a change"
					value={text}
					onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
					onKeyDown={onKey}
				/>
				{state.running ? (
					<button class="primary" onClick={stop}>
						Stop
					</button>
				) : (
					<button class="primary" onClick={() => send(text)}>
						Send
					</button>
				)}
			</div>
			{state.usage.turns > 0 && <div class="usage">{formatUsage(state.usage)}</div>}
		</footer>
	);
}

function Sheet({ state, post, onClose }: { state: State; post: Post; onClose: () => void }) {
	const [text, setText] = useState(state.systemPrompt);
	const save = () => {
		if (text !== state.systemPrompt) {
			post({ type: "setSystemPrompt", text });
		}
		onClose();
	};
	const filePath = state.thread?.filePath ?? "";
	return (
		<div class="sheet-wrap">
			<div class="sheet-bg" onClick={onClose} />
			<aside class="sheet" role="dialog" aria-label="System prompt">
				<h2>System prompt</h2>
				<div class="margin">
					{state.proseMd && "path" in state.proseMd ? (
						<span>
							Style guide found at <b>{relativePath(filePath, state.proseMd.path)}</b> and added after this prompt.
						</span>
					) : (
						<span>
							No PROSE.md found. Searched upward from <b>{state.proseMd?.searchedFrom ?? filePath}</b>.
						</span>
					)}
					<span>Saved with every thread that uses it.</span>
				</div>
				<textarea
					aria-label="System prompt text"
					value={text}
					onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
				/>
				<div class="foot">
					<button class="link" onClick={() => setText(state.defaultSystemPrompt)}>
						Reset to default
					</button>
					<button class="primary" onClick={save}>
						Save
					</button>
				</div>
			</aside>
		</div>
	);
}

/** Renders the panel and keeps its state in step with the host over `transport`. */
export function App({ transport }: { transport: Transport }) {
	const [state, dispatch] = useReducer(reduce, initialState);
	const [sheetOpen, setSheetOpen] = useState(false);

	useLayoutEffect(() => {
		transport.onMessage((msg) => dispatch({ type: "host", msg }));
		transport.post({ type: "ready" });
	}, [transport]);

	// The host sends no reply to setModel, so the dropdown would snap back on the next render without this
	const post: Post = (msg) => {
		transport.post(msg);
		if (msg.type === "setModel") {
			dispatch({ type: "model", model: msg.model });
		}
	};

	return (
		<section class="panel" aria-label="ai-prose">
			<Toolbar
				state={state}
				post={post}
				onOpenSheet={() => setSheetOpen(true)}
				key={`${state.thread?.id ?? ""}:${state.model}`}
			/>
			<div class="thread">
				<div class="column">
					<Galley state={state} key={state.thread?.id ?? ""} />
					<Transcript state={state} post={post} />
				</div>
			</div>
			<Composer state={state} post={post} dispatch={dispatch} />
			{sheetOpen && <Sheet state={state} post={post} onClose={() => setSheetOpen(false)} />}
		</section>
	);
}
