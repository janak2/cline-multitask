import type { ChatMessage } from "@/lib/chat-schema";

function sameHistoryValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (!left || !right || typeof left !== "object" || typeof right !== "object")
		return false;
	const leftEntries = Object.entries(left);
	const rightEntries = Object.entries(right);
	return (
		leftEntries.length === rightEntries.length &&
		leftEntries.every(
			([key, value]) =>
				Object.hasOwn(right, key) &&
				sameHistoryValue(value, Reflect.get(right, key)),
		)
	);
}

export function reuseUnchangedHistory(
	current: ChatMessage[],
	incoming: ChatMessage[],
): ChatMessage[] {
	if (current.length === 0) return incoming;
	const byId = new Map(current.map((message) => [message.id, message]));
	const next = incoming.map((message) => {
		const previous = byId.get(message.id);
		return previous && sameHistoryValue(previous, message) ? previous : message;
	});
	return next.length === current.length &&
		next.every((message, index) => message === current[index])
		? current
		: next;
}

function latestRunCount(messages: ChatMessage[]): number {
	let count = 0;
	for (const message of messages) {
		const stored = message.meta?.runCount ?? message.meta?.checkpoint?.runCount;
		if (stored !== undefined) {
			count = Math.max(count, stored);
		} else if (message.role === "user") {
			count += message.meta?.userRunSpan ?? 1;
		}
	}
	return count;
}

/** A prior run's persisted failure is not evidence that this run has flushed. */
export function canReplaceFailedTurn(
	current: ChatMessage[],
	history: ChatMessage[],
): boolean {
	const liveError = current.at(-1);
	if (liveError?.role !== "error") return true;
	const savedError = history.at(-1);
	if (savedError?.role !== "error") return false;
	if (latestRunCount(history) < latestRunCount(current)) return false;
	// An earlier failure can share the same text and user-run count (e.g. a
	// continuation without a new prompt). Its stable ID still identifies it.
	return !current.slice(0, -1).some((message) => message.id === savedError.id);
}
