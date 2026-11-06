import type { TeamEvent } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { useAgentEventHandlers } from "./use-agent-events";

vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
}));

function runEvent(
	type: "run_queued" | "run_started" | "run_completed" | "run_cancelled",
	id: string,
) {
	return {
		type,
		run: {
			id,
			agentId: "ui-dev",
			status: "running",
			message: "task",
			priority: 0,
			retryCount: 0,
			maxRetries: 0,
			startedAt: new Date(),
		},
		...(type === "run_cancelled" ? { reason: "stopped_by_user" } : {}),
	} as TeamEvent;
}

describe("useAgentEventHandlers", () => {
	it("counts queued and running teammate runs until they end", () => {
		const setActiveTeammateRuns = vi.fn();
		// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise the handlers without a renderer.
		const handlers = useAgentEventHandlers({
			appendEntry: vi.fn(),
			updateLastEntry: vi.fn(),
			updateEntry: vi.fn(),
			closeInlineStream: vi.fn(),
			activeInlineStreamRef: { current: undefined },
			setIsRunning: vi.fn(),
			setIsStreaming: vi.fn(),
			addUsageDelta: vi.fn(),
			setActiveTeammateRuns,
			onTurnErrorReported: vi.fn(),
			verbose: false,
		});

		handlers.handleTeamEvent(runEvent("run_queued", "run_1"));
		handlers.handleTeamEvent(runEvent("run_started", "run_1"));
		handlers.handleTeamEvent(runEvent("run_started", "run_2"));
		handlers.handleTeamEvent(runEvent("run_completed", "run_1"));
		handlers.handleTeamEvent(runEvent("run_cancelled", "run_2"));

		expect(setActiveTeammateRuns.mock.calls.map(([count]) => count)).toEqual([
			1, 1, 2, 1, 0,
		]);
	});
});
