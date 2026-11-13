import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./state-payloads", () => ({ broadcastHubState: vi.fn() }));

import {
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
