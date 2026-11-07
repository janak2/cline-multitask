import { ChatMessageMediaSchema } from "./chat-schema";

export function readPluginIssueWarning(chunk: string): string | undefined {
	try {
		const parsed = JSON.parse(chunk);
		return parsed?.metadata?.pluginIssue && typeof parsed.message === "string"
			? parsed.message.trim() || undefined
			: undefined;
	} catch {
		return undefined;
	}
}

/** Output rendered in the conversation, rather than transport bookkeeping. */
export function isVisibleChatOutput(stream?: string, chunk?: string): boolean {
	if (!chunk?.trim()) return false;
	if (stream === "chat_text") return true;
	if (stream === "chat_core_log") return Boolean(readPluginIssueWarning(chunk));
	let parsed: {
		text?: string;
		redacted?: boolean;
		toolCallId?: string;
		update?: { stream?: string; chunk?: string };
		reason?: string;
	};
	try {
		parsed = JSON.parse(chunk);
	} catch {
		return stream === "chat_reasoning";
	}
	if (!parsed || typeof parsed !== "object") return false;
	switch (stream) {
		case "chat_reasoning":
			return Boolean(
				(typeof parsed.text === "string" && parsed.text.trim()) ||
					parsed.redacted === true,
			);
		case "chat_media":
			return ChatMessageMediaSchema.safeParse(parsed).success;
		case "chat_tool_call_start":
		case "chat_tool_call_end":
			return (
				typeof parsed.toolCallId === "string" && Boolean(parsed.toolCallId)
			);
		case "chat_tool_call_update":
			return Boolean(
				parsed.toolCallId &&
					(parsed.update?.stream === "stdout" ||
						parsed.update?.stream === "stderr") &&
					typeof parsed.update.chunk === "string" &&
					parsed.update.chunk.trim(),
			);
		case "chat_done":
			// Failed turns append a visible error bubble, even without error details.
			return parsed.reason === "error";
		default:
			return false;
	}
}

export function readOutputToolCallId(chunk?: string): string | undefined {
	try {
		const parsed = JSON.parse(chunk ?? "");
		return typeof parsed?.toolCallId === "string"
			? parsed.toolCallId
			: undefined;
	} catch {
		return undefined;
	}
}
