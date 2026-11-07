import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import type { SessionRuntimeBinding } from "./types";

function fixture(sessions: unknown[] = []) {
	const ctx = createSidecarContext("/local");
	const command = vi.fn(async () => ({ ok: true, payload: { sessions } }));
	const update = vi.fn(async () => ({ updated: true }));
	ctx.runtimeBindings.set("ssh-test", {
		environmentId: "ssh-test",
		kind: "ssh",
		workspaceRoot: "/repo",
		hubClient: { command },
		sessionManager: {
			get: vi.fn(async () => ({
				metadata: {
					title: "Keep title",
					git: { url: "repo-url", branch: "main" },
				},
			})),
			update,
		},
	} as unknown as SessionRuntimeBinding);
	const run = vi.fn(async (_id: string, input: { args: string[] }) => ({
		stdout: input.args.includes("rev-parse") ? "/repo\n" : "",
		stderr: "",
		exitCode: 0,
	}));
	ctx.remoteEnvironments = { run } as unknown as NonNullable<
		typeof ctx.remoteEnvironments
	>;
	return { ctx, run, command, update };
}

describe("SSH conversation branch command", () => {
	it("uses the requested remote checkout and refreshes branch metadata without changing workspace", async () => {
		const { ctx, run, command, update } = fixture();
		await expect(
			handleCommand(ctx, "checkout_git_branch", {
				environmentId: "ssh-test",
				cwd: "/repo",
				branch: "feature",
				sessionId: "chat",
			}),
		).resolves.toMatchObject({ environmentId: "ssh-test", branch: "feature" });
		expect(command).toHaveBeenCalledWith("session.list", {
			limit: Number.MAX_SAFE_INTEGER,
		});
		expect(run).toHaveBeenCalledWith(
			"ssh-test",
			expect.objectContaining({
				cwd: "/repo",
				args: expect.arrayContaining(["git", "checkout", "feature"]),
			}),
		);
		expect(update).toHaveBeenCalledWith("chat", {
			metadata: {
				title: "Keep title",
				git: { url: "repo-url", branch: "feature" },
			},
		});
	});
	it("blocks running remote teammates before checkout", async () => {
		const { ctx, run } = fixture([
			{
				sessionId: "child",
				status: "running",
				cwd: "/repo/sub",
				parentSessionId: "chat",
			},
		]);
		await expect(
			handleCommand(ctx, "checkout_git_branch", {
				environmentId: "ssh-test",
				cwd: "/repo",
				branch: "feature",
			}),
		).rejects.toThrow("running task or teammate");
		expect(
			run.mock.calls.some(([, input]) => input.args.includes("checkout")),
		).toBe(false);
	});
	it("returns remote Git errors instead of swallowing them", async () => {
		const { ctx, run } = fixture();
		run.mockImplementation(async (_id, input) => {
			if (input.args.includes("checkout"))
				throw new Error("Branch is already used by a worktree");
			return {
				stdout: input.args.includes("rev-parse") ? "/repo\n" : "",
				stderr: "",
				exitCode: 0,
			};
		});
		await expect(
			handleCommand(ctx, "checkout_git_branch", {
				environmentId: "ssh-test",
				cwd: "/repo",
				branch: "feature",
			}),
		).rejects.toThrow("already used by a worktree");
	});
	it("fails closed if hub activity cannot be checked", async () => {
		const { ctx, command, run } = fixture();
		command.mockResolvedValue({ ok: false, payload: { sessions: [] } });
		await expect(
			handleCommand(ctx, "checkout_git_branch", {
				environmentId: "ssh-test",
				cwd: "/repo",
				branch: "feature",
			}),
		).rejects.toThrow("Could not verify running tasks");
		expect(
			run.mock.calls.some(([, input]) => input.args.includes("checkout")),
		).toBe(false);
	});
});
