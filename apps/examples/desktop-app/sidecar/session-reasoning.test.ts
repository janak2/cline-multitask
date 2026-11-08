import { describe, expect, it } from "vitest";
import { readSessionReasoning } from "../session-reasoning";

describe("session reasoning metadata", () => {
	it("ignores unset or invalid settings", () => {
		for (const metadata of [
			null,
			{},
			{ reasoning: null },
			{ reasoning: { thinking: "true", reasoningEffort: "invalid" } },
		]) {
			expect(readSessionReasoning(metadata)).toBeUndefined();
		}
	});
	it("preserves None and valid efforts without unrelated metadata", () => {
		expect(
			readSessionReasoning({
				reasoning: { thinking: false, reasoningEffort: "high" },
				title: "A",
			}),
		).toEqual({ thinking: false, reasoningEffort: undefined });
		expect(
			readSessionReasoning({
				reasoning: { thinking: true, reasoningEffort: "max" },
			}),
		).toEqual({ thinking: true, reasoningEffort: "max" });
		expect(
			readSessionReasoning({ thinking: true, reasoningEffort: "medium" }),
		).toEqual({ thinking: true, reasoningEffort: "medium" });
	});
});
