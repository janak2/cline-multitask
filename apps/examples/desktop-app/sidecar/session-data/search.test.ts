import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchWorkspaceFiles } from "./search";

describe("workspace mention search", () => {
	it("matches multiword files and parent folders without quoting", async () => {
		const root = await mkdtemp(join(tmpdir(), "desktop-mention-search-"));
		try {
			await mkdir(join(root, "Project Documents", "Design Notes"), {
				recursive: true,
			});
			await writeFile(
				join(
					root,
					"Project Documents",
					"Design Notes",
					"Release Plan Draft.md",
				),
				"draft",
			);
			await expect(
				searchWorkspaceFiles(
					{ localWorkspaceRoot: root },
					{ query: "release plan" },
				),
			).resolves.toEqual([
				"Project Documents/Design Notes/Release Plan Draft.md",
			]);
			await expect(
				searchWorkspaceFiles(
					{ localWorkspaceRoot: root },
					{ query: "Project Documents/Design Notes" },
				),
			).resolves.toEqual([
				"Project Documents/Design Notes/",
				"Project Documents/Design Notes/Release Plan Draft.md",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
