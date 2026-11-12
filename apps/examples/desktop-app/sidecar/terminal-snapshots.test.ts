import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearTerminalSnapshots,
	publishTerminalSnapshot,
	removeTerminalSnapshot,
	terminalSnapshotDir,
} from "./terminal-snapshots";

let dataDir: string;
const previous = process.env.CLINE_DATA_DIR;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "desktop-terminals-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(async () => {
	if (previous === undefined) delete process.env.CLINE_DATA_DIR;
	else process.env.CLINE_DATA_DIR = previous;
	await rm(dataDir, { recursive: true, force: true });
});

describe("terminal snapshots", () => {
	it("saves, trims, removes and clears terminal text", async () => {
		await publishTerminalSnapshot({
			id: "term_abc_1",
			sessionId: "session_1",
			label: "repo",
			cwd: "/repo",
			status: "running",
			text: `${"a".repeat(250_000)}END`,
		});
		const saved = JSON.parse(
			await readFile(join(terminalSnapshotDir(), "term_abc_1.json"), "utf8"),
		);
		expect(saved).toMatchObject({
			id: "term_abc_1",
			sessionId: "session_1",
			label: "repo",
			status: "running",
		});
		expect(saved.text.length).toBe(200_000);
		expect(saved.text.endsWith("END")).toBe(true);

		await removeTerminalSnapshot("term_abc_1");
		expect(await readdir(terminalSnapshotDir())).toEqual([]);

		await publishTerminalSnapshot({ id: "term_x", text: "" });
		await clearTerminalSnapshots();
		expect(await readdir(terminalSnapshotDir())).toEqual([]);
	});

	it("refuses ids that could write outside the folder", async () => {
		await expect(
			publishTerminalSnapshot({ id: "../../evil", text: "x" }),
		).rejects.toThrow(/Invalid terminal id/);
		await expect(removeTerminalSnapshot("../x")).rejects.toThrow(
			/Invalid terminal id/,
		);
	});
});
