import type { ToolDef } from "../llm/index.js";

export const READ_TEXT = "read_text";
export const GET_EDIT_RANGE = "get_edit_range";
export const WRITE_TEXT = "write_text";

export const TOOL_DEFS: ToolDef[] = [
	{
		name: READ_TEXT,
		description: "Returns the text available to you. In strict mode that is the block under edit; in file mode it is the whole file with line numbers.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: GET_EDIT_RANGE,
		description: "Returns the line range write_text will replace, the kind of block, and its current text.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: WRITE_TEXT,
		description: "Replaces the block under edit with new prose. The user reviews the change and the result says whether it was accepted or rejected.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "The replacement prose, without comment syntax." },
			},
			required: ["text"],
			additionalProperties: false,
		},
	},
];

/** Transcript line shown for a tool call, keyed by tool name. */
export function activityLabel(name: string, mode: "strict" | "file"): string {
	switch (name) {
		case READ_TEXT:
			return mode === "file" ? "Read the file" : "Read the block";
		case GET_EDIT_RANGE:
			return "Checked the edit range";
		case WRITE_TEXT:
			return "Proposed an edit";
		default:
			return `Called ${name}`;
	}
}
