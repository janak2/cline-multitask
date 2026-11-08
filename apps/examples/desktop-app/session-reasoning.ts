export type SessionReasoningSettings = {
	thinking?: boolean;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export function readSessionReasoning(
	metadata: unknown,
): SessionReasoningSettings | undefined {
	if (!metadata || typeof metadata !== "object") return undefined;
	const value = "reasoning" in metadata ? metadata.reasoning : metadata;
	if (!value || typeof value !== "object") return undefined;
	const thinking =
		"thinking" in value && typeof value.thinking === "boolean"
			? value.thinking
			: undefined;
	const effort = "reasoningEffort" in value ? value.reasoningEffort : undefined;
	const reasoningEffort =
		effort === "low" ||
		effort === "medium" ||
		effort === "high" ||
		effort === "xhigh" ||
		effort === "max"
			? effort
			: undefined;
	if (thinking === undefined && reasoningEffort === undefined) return undefined;
	return {
		thinking,
		reasoningEffort: thinking === false ? undefined : reasoningEffort,
	};
}
