import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./state-payloads", () => ({ broadcastHubState: vi.fn() }));

import {
	handleHubApprovalEvent,
	handleToolApprovalResponse,
	requestToolApprovalFromWebview,
	resendPendingApprovals,
} from "./approvals";
import { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function peerFor(sessionId: string) {
	const sent: Array<Record<string, unknown>> = [];
	const peer = {
		selectedSessionId: sessionId,
		socket: { send: (data: string) => sent.push(JSON.parse(data)) },
	} as unknown as BrowserPeer;
	return { peer, sent };
}

const request = {
	sessionId: "s1",
	agentId: "a",
	conversationId: "c",
	iteration: 1,
	toolCallId: "t1",
	toolName: "run_commands",
	input: { commands: ["ls"] },
} as Parameters<typeof requestToolApprovalFromWebview>[1];

afterEach(() => vi.useRealTimers());

describe("tool approvals", () => {
	it("wait with no time limit and survive the phone disconnecting", async () => {
		vi.useFakeTimers();
		const ctx = new HubContext();
		const first = peerFor("s1");
		ctx.peers.add(first.peer);
		let settled = false;
		const result = requestToolApprovalFromWebview(ctx, request).then(
			(value) => {
				settled = true;
				return value;
			},
		);
		const approvalId = String(first.sent[0]?.approvalId);
		expect(first.sent[0]).toMatchObject({
			type: "approval_request",
			toolName: "run_commands",
		});

		// The phone goes to the background and comes back much later.
		ctx.peers.delete(first.peer);
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(settled).toBe(false);

		const second = peerFor("s1");
		ctx.peers.add(second.peer);
		resendPendingApprovals(ctx, second.peer, "s1");
		expect(second.sent).toEqual([
			expect.objectContaining({ type: "approval_request", approvalId }),
		]);

		handleToolApprovalResponse(ctx, {
			type: "approval_response",
			approvalId,
			approved: true,
		});
		await expect(result).resolves.toMatchObject({ approved: true });
	});
});

describe("shared Hub approvals", () => {
	const event = {
		version: "v1" as const,
		event: "approval.requested" as const,
		sessionId: "s1",
		payload: {
			approvalId: "shared-1",
			...request,
			inputJson: JSON.stringify(request.input),
		},
	};
	it("shows desktop-origin requests once and clears them when desktop answers", () => {
		const ctx = new HubContext();
		const phone = peerFor("s1");
		ctx.peers.add(phone.peer);
		handleHubApprovalEvent(ctx, event);
		handleHubApprovalEvent(ctx, event);
		expect(phone.sent).toHaveLength(1);
		handleHubApprovalEvent(ctx, {
			...event,
			event: "approval.resolved",
			payload: { approvalId: "shared-1", approved: true },
		});
		expect(ctx.pendingToolApprovals.size).toBe(0);
		expect(phone.sent[1]).toMatchObject({
			type: "approval_resolved",
			approvalId: "shared-1",
			approved: true,
		});
	});
	it("retains requests without a selected phone and replays the shared ID", () => {
		const ctx = new HubContext();
		handleHubApprovalEvent(ctx, event);
		const phone = peerFor("s1");
		resendPendingApprovals(ctx, phone.peer, "s1");
		expect(phone.sent[0]).toMatchObject({
			type: "approval_request",
			approvalId: "shared-1",
		});
	});
	it("sends phone answers to the Hub and retains the request on failure", async () => {
		const ctx = new HubContext();
		const respondToApproval = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		ctx.uiClient = { respondToApproval } as unknown as NonNullable<
			HubContext["uiClient"]
		>;
		handleHubApprovalEvent(ctx, event);
		const frame = {
			type: "approval_response" as const,
			approvalId: "shared-1",
			approved: false,
		};
		await expect(handleToolApprovalResponse(ctx, frame)).rejects.toThrow(
			"offline",
		);
		expect(ctx.pendingToolApprovals.size).toBe(1);
		await handleToolApprovalResponse(ctx, frame);
		expect(respondToApproval).toHaveBeenLastCalledWith(
			"shared-1",
			false,
			undefined,
		);
		handleHubApprovalEvent(ctx, {
			...event,
			event: "approval.resolved",
			payload: { approvalId: "shared-1", approved: false },
		});
		expect(ctx.pendingToolApprovals.size).toBe(0);
	});
});
