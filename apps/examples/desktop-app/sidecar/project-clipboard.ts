import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	realpath,
	rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export function parseCopiedFiles(raw: string): string[] {
	const lines = raw
		.split(/\r?\n/)
		.filter((line) => line && !line.startsWith("#"));
	if (lines[0] === "cut")
		throw new Error("Cut files are not supported. Copy them instead.");
	if (lines[0] === "copy") lines.shift();
	const paths = lines.map((line) => {
		const url = new URL(line);
		if (
			url.protocol !== "file:" ||
			(url.hostname && url.hostname !== "localhost") ||
			url.search ||
			url.hash
		) {
			throw new Error(
				"Clipboard must contain local file URLs copied from a file manager",
			);
		}
		return fileURLToPath(url);
	});
	if (!paths.length)
		throw new Error("No copied files or folders on the clipboard");
	return [...new Set(paths)];
}

export async function readCopiedFiles(): Promise<string[]> {
	if (process.platform !== "linux")
		throw new Error(
			"File clipboard paste is currently supported only on Linux",
		);
	const read = async (type: string) => {
		const { stdout } = process.env.WAYLAND_DISPLAY
			? await run("wl-paste", ["--no-newline", "--type", type], {
					timeout: 3000,
					maxBuffer: 1024 * 1024,
				})
			: await run(
					"xclip",
					["-selection", "clipboard", "-out", "-target", type],
					{ timeout: 3000, maxBuffer: 1024 * 1024 },
				);
		return stdout;
	};
	const cut = await read("application/x-kde-cutselection").catch(() => "");
	if (cut.trim() === "1")
		throw new Error("Cut files are not supported. Copy them instead.");
	for (const type of ["x-special/gnome-copied-files", "text/uri-list"]) {
		try {
			return parseCopiedFiles(await read(type));
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("Cut files"))
				throw error;
		}
	}
	throw new Error(
		"No supported copied files found. Copy files in your file manager; Linux paste requires xclip (X11) or wl-paste (Wayland).",
	);
}

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return (
		rel !== ".." &&
		!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(rel)
	);
}

export async function projectDirectory(
	root: string,
	path: string,
): Promise<string> {
	if (!isAbsolute(root) || !isAbsolute(path))
		throw new Error("Absolute workspace and target paths are required");
	const [base, target] = await Promise.all([realpath(root), realpath(path)]);
	if (!inside(base, target)) throw new Error("Target is outside the workspace");
	if (!(await lstat(target)).isDirectory())
		throw new Error("Paste target must be a directory");
	return target;
}

async function validateSource(path: string): Promise<void> {
	const stat = await lstat(path);
	if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
		throw new Error(
			"Clipboard copies cannot contain symbolic links or special files",
		);
	if (stat.isDirectory())
		for (const name of await readdir(path))
			await validateSource(join(path, name));
}

async function copyEntry(source: string, target: string): Promise<void> {
	const stat = await lstat(source);
	if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
		throw new Error(
			"Clipboard source changed or contains an unsupported entry",
		);
	if (stat.isFile()) {
		await copyFile(source, target, constants.COPYFILE_EXCL);
		return;
	}
	await mkdir(target);
	try {
		for (const name of await readdir(source))
			await copyEntry(join(source, name), join(target, name));
	} catch (error) {
		await rm(target, { recursive: true, force: true });
		throw error;
	}
}

export async function copyProjectEntries(
	root: string,
	target: string,
	sources: string[],
): Promise<void> {
	if (!sources.length) throw new Error("No copied files or folders");
	const destination = await projectDirectory(root, target);
	const names = new Set<string>();
	for (const source of sources) {
		if (!isAbsolute(source))
			throw new Error("Clipboard source must be an absolute path");
		const name = basename(source);
		if (!name || names.has(name))
			throw new Error(`Duplicate clipboard name: ${name}`);
		names.add(name);
		const resolved = await realpath(source);
		if (inside(resolved, destination))
			throw new Error("Cannot copy a folder into itself");
		await validateSource(source);
		try {
			await lstat(join(destination, name));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		throw new Error(`${name} already exists. Nothing was copied.`);
	}
	for (const source of sources) {
		const to = join(destination, basename(source));
		await copyEntry(source, to);
	}
}

export async function openContainingProjectFolder(
	root: string,
	path: string,
): Promise<void> {
	if (!isAbsolute(path)) throw new Error("Absolute path required");
	await projectDirectory(root, path === root ? root : dirname(path));
	await lstat(path);
	const folder = path === root ? root : dirname(path);
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "explorer.exe"
				: "xdg-open";
	await run(command, [folder], { timeout: 5000 });
}
