import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchWorkspaceFiles, workspaceSearchQuery } from "./search";

describe("workspace mention search", () => {
	it("searches an attached folder by filename, folder-qualified path, and absolute path", async () => {
		const root = await mkdtemp(join(tmpdir(), "desktop-attached-search-"));
		const workspace = join(root, "workspace");
		const attached = join(root, "Other Project");
		try {
			await mkdir(workspace);
			await mkdir(attached);
			await writeFile(join(attached, "body.tex"), "document");
			for (const query of ["body", "Other Project/body", `${attached}/body`]) {
				await expect(
					searchWorkspaceFiles(
						{ localWorkspaceRoot: workspace },
						{
							workspaceRoot: attached,
							query,
						},
					),
				).resolves.toEqual(["body.tex"]);
			}
			await expect(
				searchWorkspaceFiles(
					{ localWorkspaceRoot: workspace },
					{
						workspaceRoot: attached,
						query: "Other Project",
					},
				),
			).resolves.toEqual(["body.tex"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each([
		["C:\\Projects\\Other", "Other\\src\\main.py", "src/main.py"],
		["/projects/other", "/projects/other/src/main.py", "src/main.py"],
		["/projects/other", "other", ""],
		["/projects/other", "unrelated/main.py", "unrelated/main.py"],
	])("normalizes folder-qualified search %s %s", (root, query, expected) => {
		expect(workspaceSearchQuery(root, query)).toBe(expected);
	});
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
