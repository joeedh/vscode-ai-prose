import { describe, expect, it } from "vitest";
import { diffLines } from "./diff";

describe("diffLines", () => {
	it("marks a full replacement as removals then additions", () => {
		expect(diffLines(["a", "b"], ["c"])).toEqual([
			{ type: "del", text: "a" },
			{ type: "del", text: "b" },
			{ type: "add", text: "c" },
		]);
	});

	it("keeps shared lines as equal", () => {
		expect(diffLines(["a", "b", "c"], ["a", "x", "c"])).toEqual([
			{ type: "equal", text: "a" },
			{ type: "del", text: "b" },
			{ type: "add", text: "x" },
			{ type: "equal", text: "c" },
		]);
	});

	it("handles empty sides", () => {
		expect(diffLines([], ["a"])).toEqual([{ type: "add", text: "a" }]);
		expect(diffLines(["a"], [])).toEqual([{ type: "del", text: "a" }]);
	});
});
