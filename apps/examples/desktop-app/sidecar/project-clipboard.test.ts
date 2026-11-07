import {
	mkdtemp,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	copyProjectEntries,
	parseCopiedFiles,
	projectDirectory,
} from "./project-clipboard";

let fixture: string;
let root: string;
let source: string;
beforeEach(async () => {
	fixture = await mkdtemp(join(tmpdir(), "cline-project-clipboard-"));
	root = join(fixture, "workspace");
	source = join(fixture, "source");
	await mkdir(root);
	await mkdir(source);
});
afterEach(async () => rm(fixture, { recursive: true, force: true }));

it("parses GNOME copied files and URI lists, not text paths, remote URLs or cuts", () => {
	const url = pathToFileURL(join(source, "a b.txt")).href;
	expect(parseCopiedFiles(`copy\n${url}\n${url}\n`)).toEqual([
		join(source, "a b.txt"),
	]);
	expect(parseCopiedFiles(`# files\r\n${url}\r\n`)).toEqual([
		join(source, "a b.txt"),
	]);
	for (const value of [
		`cut\n${url}`,
		"/home/user/file",
		"https://example.com/a",
		"file://remote/a",
		"",
	]) {
		expect(() => parseCopiedFiles(value)).toThrow();
	}
});

it("recursively copies files and folders without moving the originals", async () => {
	await mkdir(join(source, "folder"));
	await writeFile(join(source, "folder", "nested.txt"), "nested");
	await writeFile(join(source, "file.txt"), "file");
	await copyProjectEntries(root, root, [
		join(source, "folder"),
		join(source, "file.txt"),
	]);
	expect(await readFile(join(root, "folder", "nested.txt"), "utf8")).toBe(
		"nested",
	);
	expect(await readFile(join(source, "folder", "nested.txt"), "utf8")).toBe(
		"nested",
	);
	expect(await readFile(join(root, "file.txt"), "utf8")).toBe("file");
});

it("preflights conflicts without copying earlier entries or overwriting", async () => {
	await writeFile(join(source, "one"), "new");
	await writeFile(join(source, "two"), "new");
	await writeFile(join(root, "two"), "original");
	await expect(
		copyProjectEntries(root, root, [join(source, "one"), join(source, "two")]),
	).rejects.toThrow("already exists");
	await expect(readFile(join(root, "one"))).rejects.toThrow();
	expect(await readFile(join(root, "two"), "utf8")).toBe("original");
});

it("rejects escapes, symlink targets/sources, self copies and duplicate names", async () => {
	await writeFile(join(source, "file"), "data");
	await symlink(source, join(root, "escape"));
	await expect(
		copyProjectEntries(root, join(root, "escape"), [join(source, "file")]),
	).rejects.toThrow("outside");
	await expect(projectDirectory(root, source)).rejects.toThrow("outside");
	await expect(copyProjectEntries(root, root, [root])).rejects.toThrow(
		"itself",
	);
	await symlink(join(source, "file"), join(source, "link"));
	await expect(
		copyProjectEntries(root, root, [join(source, "link")]),
	).rejects.toThrow("symbolic");
	await expect(copyProjectEntries(root, root, [source])).rejects.toThrow(
		"symbolic",
	);
	await expect(
		copyProjectEntries(root, root, [
			join(source, "file"),
			join(source, "file"),
		]),
	).rejects.toThrow("Duplicate");
});
