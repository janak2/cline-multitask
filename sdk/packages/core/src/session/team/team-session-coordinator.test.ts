import { TeamMessageType } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { ActiveSession } from "../../types/session";
import {
	buildTeamRunDeliveryPrompt,
	dispatchTeamEventToBackend,
	trackTeamRunState,
} from "./team-session-coordinator";

describe("dispatchTeamEventToBackend", () => {
	it("persists intentionally aborted teammate tasks as cancelled", async () => {
		const invokeOptional = vi.fn(async () => {});
		const error = new DOMException("This operation was aborted", "AbortError");

		await dispatchTeamEventToBackend(
			"root-session",
			{
				type: TeamMessageType.TaskEnd,
				agentId: "teammate-1",
				status: "cancelled",
				error,
				messages: [],
			},
			invokeOptional,
		);

		expect(invokeOptional).toHaveBeenCalledWith(
			"onTeamTaskEnd",
			"root-session",
			"teammate-1",
			"cancelled",
			"[done] aborted",
			undefined,
			[],
		);
	});
});

function createRunState(activeRunIds: string[] = []) {
	return {
		activeTeamRunIds: new Set(activeRunIds),
		pendingTeamRunUpdates: [],
		teamRunWaiters: [],
	} as unknown as ActiveSession;
}

describe("trackTeamRunState", () => {
	it("keeps the trimmed result text of a completed run", () => {
		const session = createRunState(["run_1"]);

		trackTeamRunState(session, {
			type: TeamMessageType.RunCompleted,
			run: {
				id: "run_1",
				agentId: "ui-dev",
				status: "completed",
				message: "add dark mode",
				priority: 0,
				retryCount: 0,
				maxRetries: 0,
				startedAt: new Date(),
				result: {
					text: "x".repeat(5_000),
					iterations: 4,
					finishReason: "completed",
					durationMs: 1,
					usage: { inputTokens: 1, outputTokens: 1 },
				},
			},
		});

		expect(session.activeTeamRunIds.size).toBe(0);
		expect(session.pendingTeamRunUpdates[0]?.text).toHaveLength(4_000);
		expect(session.pendingTeamRunUpdates[0]?.text?.endsWith("...")).toBe(true);
	});
});

describe("buildTeamRunDeliveryPrompt", () => {
	it("lists status, error, result text and the remaining run count", () => {
		const prompt = buildTeamRunDeliveryPrompt(createRunState(["run_3"]), [
			{
				runId: "run_1",
				agentId: "ui-dev",
				status: "completed",
				text: "Added a dark mode toggle.",
			},
			{
				runId: "run_2",
				agentId: "tester",
				status: "failed",
				error: "tests timed out",
			},
		]);

		expect(prompt).toBe(
			"System-delivered teammate async run updates:\n- run_1 (ui-dev) -> completed\nResult:\nAdded a dark mode toggle.\n\n- run_2 (tester) -> failed error=tests timed out\n\n1 other teammate run(s) are still in progress. Their results will arrive the same way; do not wait for them. Tell the user the outcome briefly and decide whether follow-up work is needed.",
		);
	});

	it("says when no runs remain", () => {
		const prompt = buildTeamRunDeliveryPrompt(createRunState(), [
			{ runId: "run_1", agentId: "ui-dev", status: "cancelled" },
		]);

		expect(prompt).toContain("No teammate runs are in progress.");
	});
});
