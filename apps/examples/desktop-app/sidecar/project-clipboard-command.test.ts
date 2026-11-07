import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import {
	openContainingProjectFolder,
	readCopiedFiles,
} from "./project-clipboard";

const mocks = vi.hoisted(() => ({
	remote: false,
	exec: vi.fn(),
}));
vi.mock("./context", async (original) => ({
	...(await original<typeof import("./context")>()),
	getRuntimeBinding: () =>
		mocks.remote
			? { kind: "ssh", environmentId: "remote" }
			: { kind: "local", environmentId: "local" },
}));
vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	const execFile = (...args: unknown[]) => {
		const callback = args.at(-1) as (
			error: Error | null,
			stdout: string,
			stderr: string,
		) => void;
		try {
			callback(null, mocks.exec(args[0], args[1]), "");
		} catch (error) {
			callback(error as Error, "", "");
		}
	};
	Object.defineProperty(execFile, Symbol.for("nodejs.util.promisify.custom"), {
		value: async (command: string, args: string[]) => ({
			stdout: mocks.exec(command, args),
			stderr: "",
		}),
	});
	return { ...actual, execFile };
});

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "cline-clipboard-command-"));
	mocks.remote = false;
	mocks.exec.mockReset().mockReturnValue("");
});
afterEach(async () => rm(root, { recursive: true, force: true }));

it("uses actual native clipboard MIME requests and rejects cut selections", async () => {
	mocks.exec.mockImplementation((_command, args: string[]) => {
		if (args.includes("x-special/gnome-copied-files"))
			return "copy\nfile:///copied/a%20b";
		return "";
	});
	expect(await readCopiedFiles()).toEqual(["/copied/a b"]);
	expect(mocks.exec).toHaveBeenCalledWith(
		expect.stringMatching(/xclip|wl-paste/),
		expect.arrayContaining(["x-special/gnome-copied-files"]),
	);
	mocks.exec.mockReturnValue("1");
	await expect(readCopiedFiles()).rejects.toThrow("Cut files");
});

it("opens the containing directory through an argument array, including shell characters", async () => {
	const folder = join(root, "folder; harmless");
	await mkdir(folder);
	const file = join(folder, "a.txt");
	await writeFile(file, "a");
	await openContainingProjectFolder(root, file);
	expect(mocks.exec).toHaveBeenLastCalledWith("xdg-open", [folder]);
	await openContainingProjectFolder(root, folder);
	expect(mocks.exec).toHaveBeenLastCalledWith("xdg-open", [root]);
	await expect(
		openContainingProjectFolder(root, join(tmpdir(), "outside", "file")),
	).rejects.toThrow();
});

it("requires a trusted local connection before reading the clipboard or opening a folder", async () => {
	const context = createSidecarContext(root);
	const args = { workspaceRoot: root, path: root };
	const options = {
		connection: { send: vi.fn(), data: { canApproveTools: true } },
	};
	for (const command of [
		"paste_project_entries",
		"open_containing_project_folder",
	]) {
		await expect(handleCommand(context, command, args)).rejects.toThrow(
			"trusted",
		);
		mocks.remote = true;
		await expect(
			handleCommand(context, command, args, options),
		).rejects.toThrow("local");
		mocks.remote = false;
	}
	expect(mocks.exec).not.toHaveBeenCalled();
});
