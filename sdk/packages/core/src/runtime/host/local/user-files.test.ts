import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUserFileContent } from "./user-files";

describe("mentioned user files and folders", () => {
	it("loads a multiword file and lists a folder without reading its children", async () => {
		const root = await mkdtemp(join(tmpdir(), "mentioned-user-files-"));
		try {
			await mkdir(join(root, "Design Notes"));
			await writeFile(join(root, "Release Plan.md"), "draft contents");
			expect(await loadUserFileContent(join(root, "Release Plan.md"))).toBe(
				"draft contents",
			);
			expect(await loadUserFileContent(root)).toBe(
				"Design Notes/\nRelease Plan.md",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("bounds a mentioned folder listing", async () => {
		const root = await mkdtemp(join(tmpdir(), "mentioned-folder-bound-"));
		try {
			await Promise.all(
				Array.from({ length: 205 }, (_, index) =>
					writeFile(join(root, `file ${index}.md`), ""),
				),
			);
			const result = await loadUserFileContent(root);
			expect(result.split("\n")).toHaveLength(201);
			expect(result).toContain("…");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
