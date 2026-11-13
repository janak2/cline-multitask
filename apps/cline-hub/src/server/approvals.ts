import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
import type { WebviewInboundMessage } from "../webview-protocol";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import type { BrowserPeer } from "./types";

function createApprovalId(): string {
	return `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resolveToolApproval(
	ctx: HubContext,
	approvalId: string,
	result: ToolApprovalResult,
): boolean {
	const pending = ctx.pendingToolApprovals.get(approvalId);
	if (!pending) return false;
	ctx.pendingToolApprovals.delete(approvalId);
	ctx.sendToSelectedPeers(pending.sessionId, {
		type: "approval_resolved",
		approvalId,
		approved: result.approved,
		reason: result.reason,
	});
	pending.resolve(result);
	return true;
}

export function rejectPendingApprovalsForSession(
	ctx: HubContext,
	sessionId: string,
	reason: string,
): void {
	for (const [approvalId, pending] of [...ctx.pendingToolApprovals.entries()]) {
		if (pending.sessionId === sessionId) {
			resolveToolApproval(ctx, approvalId, { approved: false, reason });
		}
	}
}

export function rejectAllPendingApprovals(
	ctx: HubContext,
	reason: string,
): void {
	for (const approvalId of [...ctx.pendingToolApprovals.keys()]) {
		resolveToolApproval(ctx, approvalId, { approved: false, reason });
	}
}

/**
 * Re-sends a session's open approval requests to a page that just opened it,
 * e.g. the phone reconnecting after the user switched apps. Approvals wait
 * until someone answers them; a dropped connection does not reject them.
 */
export function resendPendingApprovals(
	ctx: HubContext,
	peer: BrowserPeer,
	sessionId: string,
): void {
	for (const [approvalId, pending] of ctx.pendingToolApprovals) {
		if (pending.sessionId !== sessionId) continue;
		ctx.send(peer, {
			type: "approval_request",
			approvalId,
			...pending.request,
		});
	}
}

export function requestToolApprovalFromWebview(
	ctx: HubContext,
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!ctx.hasSelectedPeer(request.sessionId)) {
		return Promise.resolve({
			approved: false,
			reason: "No Cline Hub webview is attached to this session.",
		});
	}

	const approvalId = createApprovalId();
	ctx.pushEvent(
		"Tool approval requested",
		`${request.toolName} is waiting for approval`,
		"warn",
	);
	broadcastHubState(ctx);

	// No time limit: the request waits until someone approves or rejects it.
	return new Promise((resolve) => {
		const details = {
			sessionId: request.sessionId,
			agentId: request.agentId,
			conversationId: request.conversationId,
			iteration: request.iteration,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			input: request.input,
			policy: request.policy as Record<string, unknown> | undefined,
		};
		ctx.pendingToolApprovals.set(approvalId, {
			sessionId: request.sessionId,
			resolve,
			request: details,
		});
		ctx.sendToSelectedPeers(request.sessionId, {
			type: "approval_request",
			approvalId,
			...details,
		});
	});
}

export function handleToolApprovalResponse(
	ctx: HubContext,
	frame: Extract<WebviewInboundMessage, { type: "approval_response" }>,
): void {
	const approvalId = frame.approvalId.trim();
	if (!approvalId) return;
	const resolved = resolveToolApproval(ctx, approvalId, {
		approved: frame.approved,
		reason:
			frame.reason ??
			(frame.approved ? "Approved in Cline Hub." : "Rejected in Cline Hub."),
	});
	if (!resolved) {
		console.warn(`Ignoring unknown tool approval response: ${approvalId}`);
	}
}
