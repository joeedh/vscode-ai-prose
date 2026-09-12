import { promises as fs } from "node:fs";
import * as path from "node:path";
import { expect, test, type Shell } from "./shell-fixture.js";

const ORIGINAL_COMMENT = [
	"\t// keeps track of the pointer ids that are currently held down, we use this",
	"\t// to detect multi touch which is when there is more than one pointer id",
].join("\n");

const writeCall = (id: string, text: string) => ({ id, name: "write_text", arguments: JSON.stringify({ text }) });

async function focusComment(shell: Shell) {
	await shell.page.locator(".file-body .ln").nth(1).click();
	await expect(shell.page.locator(".galley .margin")).toContainText("lines 2–3");
	await expect(shell.page.locator(".file-body .ln.unit")).toHaveCount(2);
}

async function sendAndWaitForCard(shell: Shell, text: string) {
	await shell.page.getByLabel("Ask for a change").fill(text);
	await shell.page.getByRole("button", { name: "Send" }).click();
	await expect(shell.page.locator(".edit.pending")).toBeVisible();
}

test.describe("Electron shell", () => {
	test("runs on the given profile and debugging port", async ({ shell }) => {
		const userData = await shell.app.evaluate(({ app }) => app.getPath("userData"));
		expect(path.resolve(userData)).toBe(path.resolve(shell.profileDir));
		expect(path.basename(shell.profileDir).startsWith("aiprose-test-")).toBe(true);
		expect(shell.cdpPort).not.toBe(9222);

		const response = await fetch(`http://127.0.0.1:${shell.cdpPort}/json/version`);
		expect(response.ok).toBe(true);
		const version = (await response.json()) as { Browser?: string };
		expect(version.Browser).toContain("Chrome");

		const entries = await fs.readdir(shell.profileDir);
		expect(entries).toContain("DevToolsActivePort");
		const activePort = (await fs.readFile(path.join(shell.profileDir, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0];
		expect(Number(activePort)).toBe(shell.cdpPort);
	});

	test("shows the galley for a clicked comment line", async ({ shell }) => {
		await expect(shell.page.locator(".file-title")).toHaveText(shell.file);
		await expect(shell.page.locator(".galley.empty")).toBeVisible();
		await focusComment(shell);
		await expect(shell.page.locator(".galley p")).toContainText("keeps track of the pointer ids");
		await expect(shell.page.locator(".file-body .ln.unit").first()).toHaveClass(/cursor/);
	});

	test("accepting a proposed edit writes the file and a transcript", async ({ shell }) => {
		await focusComment(shell);
		shell.server.script({ toolCalls: [writeCall("c1", "Pointer ids currently down. More than one means multi-touch.")] });
		shell.server.script({ text: "Tightened it." });
		await sendAndWaitForCard(shell, "Tighten this");
		await shell.page.getByRole("button", { name: "Accept edit" }).click();

		await expect(shell.page.locator(".edit.accepted")).toBeVisible();
		await expect(shell.page.locator(".file-body .ln").nth(1)).toContainText("Pointer ids currently down.");
		const text = await fs.readFile(shell.file, "utf8");
		expect(text).toContain("\t// Pointer ids currently down. More than one means multi-touch.\n\tprivate down");
		expect(text).not.toContain("keeps track");

		const transcripts = await fs.readdir(shell.transcriptsDir);
		expect(transcripts.filter((n) => n.endsWith(".json"))).toHaveLength(1);
		const stored = JSON.parse(await fs.readFile(path.join(shell.transcriptsDir, transcripts[0]), "utf8")) as {
			header: { title: string };
			body: { edits: { resolution: { status: string } }[] };
		};
		expect(stored.header.title).toBe("Tighten this");
		expect(stored.body.edits[0].resolution.status).toBe("accepted");
	});

	test("rejecting a proposed edit leaves the file alone", async ({ shell }) => {
		await focusComment(shell);
		shell.server.script({ toolCalls: [writeCall("c1", "Not this wording.")] });
		shell.server.script({ text: "Understood." });
		await sendAndWaitForCard(shell, "Try again");
		await shell.page.getByRole("button", { name: "Reject" }).click();

		await expect(shell.page.locator(".edit.rejected")).toBeVisible();
		await expect(shell.page.locator(".edit.rejected")).toContainText("Rejected edit");
		const text = await fs.readFile(shell.file, "utf8");
		expect(text).toContain(ORIGINAL_COMMENT);
		expect(text).not.toContain("Not this wording");
	});

	test("follows the color scheme", async ({ shell }) => {
		const background = () => shell.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		await shell.page.emulateMedia({ colorScheme: "light" });
		const light = await background();
		await shell.page.emulateMedia({ colorScheme: "dark" });
		const dark = await background();
		expect(light).not.toBe(dark);
		const brightness = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0);
		expect(brightness(light)).toBeGreaterThan(brightness(dark));
	});
});
