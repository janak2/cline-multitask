import type { TeamEvent } from "@cline/core";

/** Keeps `active` in step with the queued and running teammate runs. */
export function trackActiveTeamRuns(
	active: Set<string>,
	event: TeamEvent,
): void {
	switch (event.type) {
		case "run_queued":
		case "run_started":
			active.add(event.run.id);
			break;
		case "run_completed":
		case "run_failed":
		case "run_cancelled":
		case "run_interrupted":
			active.delete(event.run.id);
			break;
	}
}

/** Shown before a Plan/Act or model switch restarts the session. */
export function formatTeammateRestartWarning(
	activeRuns: number,
): string | undefined {
	return activeRuns > 0
		? `${activeRuns} teammate run(s) are active. Switching restarts the session; they will be interrupted and resumed where possible.`
		: undefined;
}

export const MULTITASK_COMMAND_USAGE =
	"Usage: /multitask [on|off|stop]\nRuns big tasks on background teammates so you can keep chatting. /multitask stop stops all teammates.";

export function parseMultitaskCommand(
	input: string,
):
	| { kind: "none" }
	| { kind: "usage" }
	| { kind: "stop" }
	| { kind: "set"; enabled: boolean } {
	const match = /^\/multitask\b([\s\S]*)$/i.exec(input.trim());
	if (!match) return { kind: "none" };
	const arg = match[1].trim().toLowerCase();
	if (arg === "" || arg === "on") return { kind: "set", enabled: true };
	if (arg === "off") return { kind: "set", enabled: false };
	if (arg === "stop") return { kind: "stop" };
	return { kind: "usage" };
}
