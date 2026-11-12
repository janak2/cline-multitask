import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSessionTerminals } from "./terminal-snapshots";

let dir: string | undefined;
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = undefined;
});

describe("listSessionTerminals", () => {
	it("returns only the requested session's terminals and skips broken files", async () => {
		dir = await mkdtemp(join(tmpdir(), "hub-terminals-"));
		const write = (name: string, value: unknown) =>
			writeFile(join(dir as string, name), JSON.stringify(value));
		await write("term_b.json", {
			id: "term_b",
			sessionId: "s1",
			label: "repo 2",
			cwd: "/repo",
			status: "running",
			text: "$ ls",
			updatedAt: 2,
		});
		await write("term_a.json", {
			id: "term_a",
			sessionId: "s1",
			label: "repo",
			cwd: "/repo",
			status: "running",
			text: "$ pwd",
			updatedAt: 1,
		});
		await write("term_other.json", {
			id: "term_other",
			sessionId: "s2",
			text: "secret",
		});
		await write("term_unsaved.json", { id: "term_unsaved", text: "x" });
		await writeFile(join(dir, "term_broken.json"), "{not json");
		await writeFile(join(dir, "term_c.json.tmp"), "{}");

		const terminals = await listSessionTerminals("s1", dir);

		expect(terminals.map((terminal) => terminal.id)).toEqual([
			"term_a",
			"term_b",
		]);
		expect(terminals[0]).toMatchObject({ label: "repo", text: "$ pwd" });
		expect(await listSessionTerminals("", dir)).toEqual([]);
		expect(await listSessionTerminals("s1", join(dir, "missing"))).toEqual([]);
	});
});
