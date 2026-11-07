import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutIdleBranch } from "./branch-checkout";

let cwd: string;
function git(path: string, args: string[]) {
	return execFileSync("git", args, {
		cwd: path,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "cline-branch-checkout-"));
	git(cwd, ["init", "-b", "main"]);
	writeFileSync(join(cwd, "file"), "original");
	git(cwd, ["add", "file"]);
	git(cwd, [
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"commit",
		"-m",
		"fixture",
	]);
	git(cwd, ["branch", "feature"]);
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("idle branch checkout", () => {
	it("switches an idle clean checkout", async () => {
		await checkoutIdleBranch({
			cwd,
			branch: "feature",
			git: async (...args) => git(...args),
			sessions: async () => [],
		});
		expect(git(cwd, ["branch", "--show-current"]).trim()).toBe("feature");
	});
	it.each([
		"running",
		"starting",
		"stopping",
		"pending",
	])("blocks %s tasks and teammates in subdirectories", async (status) => {
		mkdirSync(join(cwd, "sub"));
		await expect(
			checkoutIdleBranch({
				cwd,
				branch: "feature",
				git: async (...args) => git(...args),
				sessions: async () => [
					{ sessionId: "lead__teamtask__child", cwd: join(cwd, "sub"), status },
				],
			}),
		).rejects.toThrow("running task or teammate");
		expect(git(cwd, ["branch", "--show-current"]).trim()).toBe("main");
	});
	it("blocks busy sessions even with an idle status", async () => {
		await expect(
			checkoutIdleBranch({
				cwd,
				branch: "feature",
				git: async (...args) => git(...args),
				sessions: async () => [
					{ sessionId: "busy", cwd, status: "idle", busy: true },
				],
			}),
		).rejects.toThrow("running task");
	});
	it("preserves dirty tracked and untracked files", async () => {
		writeFileSync(join(cwd, "file"), "user edits");
		writeFileSync(join(cwd, "untracked"), "keep");
		await expect(
			checkoutIdleBranch({
				cwd,
				branch: "feature",
				git: async (...args) => git(...args),
				sessions: async () => [],
			}),
		).rejects.toThrow("uncommitted changes");
		expect(readFileSync(join(cwd, "file"), "utf8")).toBe("user edits");
		expect(readFileSync(join(cwd, "untracked"), "utf8")).toBe("keep");
		expect(git(cwd, ["branch", "--show-current"]).trim()).toBe("main");
	});
	it("allows agents in an independent worktree but preserves Git's occupied-branch refusal", async () => {
		const path = join(cwd, "other");
		git(cwd, ["worktree", "add", "--detach", path, "HEAD"]);
		// The worktree lives inside the fixture; ignore its directory in the parent.
		writeFileSync(join(cwd, ".git", "info", "exclude"), "other/\n");
		await checkoutIdleBranch({
			cwd,
			branch: "feature",
			git: async (...args) => git(...args),
			sessions: async () => [
				{ sessionId: "other", cwd: path, status: "running" },
			],
		});
		expect(git(cwd, ["branch", "--show-current"]).trim()).toBe("feature");
		git(path, ["checkout", "main"]);
		await expect(
			checkoutIdleBranch({
				cwd,
				branch: "main",
				git: async (...args) => git(...args),
				sessions: async () => [],
			}),
		).rejects.toThrow(/already.*(checked out|used by worktree)/);
	});
	it("fails closed when session discovery fails", async () => {
		await expect(
			checkoutIdleBranch({
				cwd,
				branch: "feature",
				git: async (...args) => git(...args),
				sessions: async () => {
					throw new Error("Hub unavailable");
				},
			}),
		).rejects.toThrow("Hub unavailable");
		expect(git(cwd, ["branch", "--show-current"]).trim()).toBe("main");
	});
	it("fails closed for a running session with an unknown checkout", async () => {
		await expect(
			checkoutIdleBranch({
				cwd,
				branch: "feature",
				git: async (...args) => git(...args),
				sessions: async () => [{ sessionId: "unknown", status: "running" }],
			}),
		).rejects.toThrow("Cannot verify");
	});
});
