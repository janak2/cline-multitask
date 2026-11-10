import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	canReplaceFailedTurn,
	reuseUnchangedHistory,
} from "./history-reconciliation";

const row = (
	id: string,
	role: ChatMessage["role"],
	runCount?: number,
): ChatMessage => ({
	id,
	role,
	sessionId: "s",
	content: "same text",
	createdAt: 1,
	meta: runCount ? { runCount } : undefined,
});

describe("failed turn history reconciliation", () => {
	it("reuses unchanged rows but applies content and nested metadata changes", () => {
		const current = [row("u1", "user", 1), row("a1", "assistant")];
		expect(reuseUnchangedHistory(current, structuredClone(current))).toBe(
			current,
		);
		const updated = structuredClone(current);
		updated[1].content = "new answer";
		const result = reuseUnchangedHistory(current, updated);
		expect(result[0]).toBe(current[0]);
		expect(result[1]).toBe(updated[1]);
		const metadata = structuredClone(current);
		metadata[0].meta = { runCount: 2 };
		expect(reuseUnchangedHistory(current, metadata)[0]).toBe(metadata[0]);
		expect(reuseUnchangedHistory(current, [current[1], current[0]])).toEqual([
			current[1],
			current[0],
		]);
		expect(reuseUnchangedHistory(current, [])).toEqual([]);
	});
	it("rejects an earlier error while a repeated prompt has a new live failure", () => {
		const old = [row("u1", "user", 4), row("e1", "error", 4)];
		const current = [
			...old,
			row("u2", "user"),
			row("partial", "assistant"),
			row("tool", "tool"),
			row("live", "error"),
		];
		expect(canReplaceFailedTurn(current, old)).toBe(false);
		expect(canReplaceFailedTurn(current, [...old, row("u2", "user", 5)])).toBe(
			false,
		);
		expect(
			canReplaceFailedTurn(current, [
				...old,
				row("u2", "user", 5),
				row("e2", "error", 5),
			]),
		).toBe(true);
	});
	it("rejects an earlier error ID even for a continuation in the same user run", () => {
		const old = [row("u1", "user"), row("e1", "error")];
		expect(canReplaceFailedTurn([...old, row("live", "error")], old)).toBe(
			false,
		);
	});
});
