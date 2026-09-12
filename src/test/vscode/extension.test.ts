import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension", () => {
	test("registers its commands", async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes("ai-prose.open"));
		assert.ok(commands.includes("ai-prose.newThread"));
		assert.ok(commands.includes("ai-prose.setApiKey"));
	});
});
