import { useState } from "preact/hooks";
import type { EditProposal, EditResolution, UiToHost } from "../core/protocol";
import { diffLines } from "./diff";
import { rangeLabel } from "./state";

interface Line {
	number: number;
	text: string;
	cls: string;
	mark?: "removed" | "added";
}

/** Lays out the card body as numbered lines for the preview or the diff. */
function bodyLines(p: EditProposal, view: "preview" | "diff"): Line[] {
	const lines: Line[] = [];
	let n = p.firstLine + 1;
	for (const text of p.contextBefore) {
		lines.push({ number: n++, text, cls: "ln" });
	}
	if (view === "preview") {
		for (const text of p.newLines) {
			lines.push({ number: n++, text, cls: "ln hot" });
		}
	} else {
		let oldNo = p.range.start + 1;
		for (const op of diffLines(p.oldLines, p.newLines)) {
			if (op.type === "equal") {
				lines.push({ number: n++, text: op.text, cls: "ln" });
				oldNo++;
			} else if (op.type === "del") {
				lines.push({ number: oldNo++, text: op.text, cls: "ln del", mark: "removed" });
			} else {
				lines.push({ number: n++, text: op.text, cls: "ln hot add", mark: "added" });
			}
		}
	}
	for (const text of p.contextAfter) {
		lines.push({ number: n++, text, cls: "ln" });
	}
	return lines;
}

function Body({ proposal, view }: { proposal: EditProposal; view: "preview" | "diff" }) {
	return (
		<div class={`body ${view}`}>
			{bodyLines(proposal, view).map((l, i) => (
				<div class={l.cls} key={i}>
					<span class="n">{l.number}</span>
					<span class="m">{l.mark && <span class="sr">{l.mark} </span>}</span>
					<span>{l.text}</span>
				</div>
			))}
		</div>
	);
}

function ViewToggle({ view, onChange }: { view: "preview" | "diff"; onChange: (v: "preview" | "diff") => void }) {
	return (
		<div class="seg" role="radiogroup" aria-label="View">
			<button role="radio" aria-checked={view === "preview"} onClick={() => onChange("preview")}>
				Preview
			</button>
			<button role="radio" aria-checked={view === "diff"} onClick={() => onChange("diff")}>
				Diff
			</button>
		</div>
	);
}

interface Props {
	proposal: EditProposal;
	resolution?: EditResolution;
	post: (msg: UiToHost) => void;
}

/** Shows a proposed edit, then its accepted or rejected form once the user answers. */
export function EditCard({ proposal, resolution, post }: Props) {
	const [view, setView] = useState<"preview" | "diff">("preview");
	const [open, setOpen] = useState(false);

	if (!resolution) {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				post({ type: "acceptEdit", id: proposal.id });
			} else if (e.key === "Escape") {
				e.preventDefault();
				post({ type: "rejectEdit", id: proposal.id });
			}
		};
		return (
			<div class="edit pending" tabIndex={0} aria-label="Proposed edit" onKeyDown={onKey}>
				<div class="head">
					<span class="title">Proposed edit</span>
					<span class="range">{rangeLabel(proposal.range)}</span>
					<ViewToggle view={view} onChange={setView} />
				</div>
				<Body proposal={proposal} view={view} />
				<div class="foot">
					<button class="secondary" onClick={() => post({ type: "rejectEdit", id: proposal.id })}>
						Reject
					</button>
					<button class="primary" onClick={() => post({ type: "acceptEdit", id: proposal.id })}>
						Accept edit
					</button>
				</div>
			</div>
		);
	}

	if (resolution.status === "accepted") {
		return (
			<div class="edit accepted">
				<button class="applied" aria-expanded={open} onClick={() => setOpen(!open)}>
					<span class="check" aria-hidden="true">
						✓
					</span>
					Applied to {rangeLabel(resolution.range)}
				</button>
				{open && <Body proposal={proposal} view="diff" />}
			</div>
		);
	}

	return (
		<div class="edit rejected">
			<div class="head">
				<span class="title">Rejected edit</span>
				<span class="range">{rangeLabel(proposal.range)}</span>
				<button class="quiet" onClick={() => post({ type: "copy", text: resolution.text })}>
					Copy
				</button>
			</div>
			<pre>{resolution.text}</pre>
		</div>
	);
}
