import { SessionNotFoundError } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { sendMessage } from "./sessions";
import { HubContext } from "./state";
import type { BrowserPeer } from "./types";

vi.mock("./deps", () => ({
	providerSettingsManager: {},
	workspaceRoot: "/workspace",
}));

function setup() {
	const ctx = new HubContext();
	const messages = [
		{ id: "saved", role: "user", content: "Original question" },
	];
	const compaction = { version: 1, messages: [], source_message_count: 1 };
	const cline = {
		send: vi.fn().mockResolvedValue(undefined),
		get: vi.fn().mockResolvedValue({
			sessionId: "saved",
			source: "desktop",
			provider: "provider",
			model: "model",
			cwd: "/workspace",
			workspaceRoot: "/workspace",
			enableTools: false,
			enableSpawn: false,
			enableTeams: true,
			teamName: "kept-team",
			metadata: {
				systemPrompt: "Saved instructions",
				reasoning: { thinking: true, reasoningEffort: "high" },
				autoApproveTools: false,
				checkpointEnabled: false,
				title: "Kept title",
				context: { instruction: "Kept context" },
			},
		}),
		readMessages: vi.fn().mockResolvedValue(messages),
		readSessionCompactionState: vi.fn().mockResolvedValue(compaction),
		start: vi.fn().mockResolvedValue({ sessionId: "saved" }),
	};
	ctx.cline = cline as unknown as HubContext["cline"];
	const peer = { selectedSessionId: "saved" } as BrowserPeer;
	return { ctx, cline, peer, messages, compaction };
}

describe("phone send recovery", () => {
	it("does not inspect or restart an already-live session", async () => {
		const { ctx, cline, peer } = setup();
		await sendMessage(ctx, peer, "next");
		expect(cline.send).toHaveBeenCalledTimes(1);
		expect(cline.get).not.toHaveBeenCalled();
		expect(cline.start).not.toHaveBeenCalled();
	});

	it("restores saved history/settings/context/compaction under the same ID and retries identical input once", async () => {
		const { ctx, cline, peer, messages, compaction } = setup();
		cline.send.mockRejectedValueOnce(new SessionNotFoundError("saved"));
		const attachments = { userImages: ["data:image/png;base64,AQID"] };
		await sendMessage(
			ctx,
			peer,
			"pending prompt",
			{ mode: "plan" },
			attachments,
		);
		expect(cline.start).toHaveBeenCalledWith(
			expect.objectContaining({
				resumeIfMissing: true,
				initialMessages: messages,
				initialCompactionState: compaction,
				config: expect.objectContaining({
					sessionId: "saved",
					providerId: "provider",
					modelId: "model",
					systemPrompt: "Saved instructions",
					reasoningEffort: "high",
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: true,
					teamName: "kept-team",
					checkpoint: { enabled: false },
				}),
				sessionMetadata: expect.objectContaining({
					title: "Kept title",
					context: { instruction: "Kept context" },
				}),
				toolPolicies: { "*": { autoApprove: false } },
			}),
		);
		expect(cline.start.mock.calls[0][0].prompt).toBeUndefined();
		expect(messages).toHaveLength(1);
		expect(cline.send).toHaveBeenCalledTimes(2);
		expect(cline.send.mock.calls[0]).toEqual(cline.send.mock.calls[1]);
		expect(cline.send.mock.calls[1][0]).toMatchObject({
			prompt: "pending prompt",
			userImages: attachments.userImages,
		});
	});

	it("shares restoration even when a concurrent missing-session reply arrives after restore completes", async () => {
		const { ctx, cline, peer } = setup();
		let rejectLate!: (error: unknown) => void;
		cline.send.mockRejectedValueOnce(new SessionNotFoundError("saved"));
		cline.send.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectLate = reject;
				}),
		);
		const first = sendMessage(ctx, peer, "first");
		const second = sendMessage(ctx, peer, "second");
		await first;
		rejectLate(new SessionNotFoundError("saved"));
		await second;
		expect(cline.start).toHaveBeenCalledTimes(1);
		expect(cline.send.mock.calls.map(([input]) => input.prompt)).toEqual([
			"first",
			"second",
			"first",
			"second",
		]);
	});

	it("shares an in-flight restore across two requests without sharing their prompts", async () => {
		const { ctx, cline, peer } = setup();
		let finish!: (value: { sessionId: string }) => void;
		cline.start.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		cline.send.mockRejectedValueOnce(new SessionNotFoundError("saved"));
		cline.send.mockRejectedValueOnce(new SessionNotFoundError("saved"));
		const first = sendMessage(ctx, peer, "first");
		const second = sendMessage(ctx, peer, "second");
		await vi.waitFor(() => expect(cline.start).toHaveBeenCalledTimes(1));
		expect(cline.send).toHaveBeenCalledTimes(2);
		finish({ sessionId: "saved" });
		await Promise.all([first, second]);
		expect(cline.start).toHaveBeenCalledTimes(1);
		expect(cline.send.mock.calls.map(([input]) => input.prompt)).toEqual([
			"first",
			"second",
			"first",
			"second",
		]);
	});

	it.each([
		new Error("session not found: saved"),
		Object.assign(new Error("network"), { code: "transport_closed" }),
		new Error("unauthorized"),
	])("does not retry ambiguous or unrelated errors: %s", async (error) => {
		const { ctx, cline, peer } = setup();
		cline.send.mockRejectedValue(error);
		await expect(sendMessage(ctx, peer, "pending")).rejects.toBe(error);
		expect(cline.start).not.toHaveBeenCalled();
		expect(cline.send).toHaveBeenCalledTimes(1);
	});

	it.each([
		"missing",
		"empty",
		"restore-failed",
	])("reports %s recovery failure without retrying the prompt", async (failure) => {
		const { ctx, cline, peer } = setup();
		cline.send.mockRejectedValue(new SessionNotFoundError("saved"));
		if (failure === "missing") cline.get.mockResolvedValue(undefined);
		if (failure === "empty") cline.readMessages.mockResolvedValue([]);
		if (failure === "restore-failed")
			cline.start.mockRejectedValue(new Error("Cannot restore"));
		await expect(
			sendMessage(ctx, peer, "pending", {}, { userImages: ["photo"] }),
		).rejects.toThrow("Your message and attachments have not been sent");
		expect(cline.send).toHaveBeenCalledTimes(1);
	});

	it("does not restore or retry again if the one retry fails", async () => {
		const { ctx, cline, peer } = setup();
		cline.send.mockRejectedValue(new SessionNotFoundError("saved"));
		await expect(sendMessage(ctx, peer, "pending")).rejects.toThrow(
			"session not found",
		);
		expect(cline.send).toHaveBeenCalledTimes(2);
		expect(cline.start).toHaveBeenCalledTimes(1);
	});

	it("allows a later recovery after the runtime goes missing again", async () => {
		const { ctx, cline, peer } = setup();
		cline.send.mockRejectedValueOnce(new SessionNotFoundError("saved"));
		await sendMessage(ctx, peer, "first");
		cline.send.mockRejectedValueOnce(new SessionNotFoundError("saved"));
		await sendMessage(ctx, peer, "later");
		expect(cline.start).toHaveBeenCalledTimes(2);
		expect(cline.send).toHaveBeenCalledTimes(4);
	});
});
