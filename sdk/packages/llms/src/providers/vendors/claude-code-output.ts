import type { LanguageModelV4Middleware } from "@ai-sdk/provider";

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}

function text(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
	return "";
}

export function formatClaudeCodeNotice(value: unknown): string | undefined {
	const message = record(value);
	if (!message) return;
	const kind = message.type === "system" ? message.subtype : message.type;
	let body: string;
	switch (kind) {
		case "informational":
		case "local_command_output":
			body = text(message.content);
			break;
		case "notification":
			body = text(message.text);
			break;
		case "permission_denied":
			body = [
				text(message.tool_name),
				text(message.message),
				text(message.decision_reason),
			]
				.filter(Boolean)
				.join("\n");
			break;
		case "rate_limit_event": {
			const info = record(message.rate_limit_info);
			if (!info || info.status === "allowed") return;
			body = [text(info.status), text(info.rateLimitType)]
				.filter(Boolean)
				.join(": ");
			if (typeof info.resetsAt === "number" && Number.isFinite(info.resetsAt)) {
				const reset = new Date(info.resetsAt * 1000);
				if (Number.isFinite(reset.getTime()))
					body += `\nResets at ${reset.toISOString()}`;
			}
			break;
		}
		case "tool_progress":
			body = `${text(message.tool_name)} running (${message.elapsed_time_seconds}s)`;
			break;
		case "auth_status":
			body = [text(message.output), text(message.error)]
				.filter(Boolean)
				.join("\n");
			break;
		case "api_retry":
			body = `Retry ${message.attempt}/${message.max_retries} in ${message.retry_delay_ms}ms: ${text(message.error)}`;
			break;
		case "status":
			body = [text(message.status), text(message.compact_error)]
				.filter(Boolean)
				.join("\n");
			break;
		case "task_started":
		case "task_progress":
		case "task_notification":
			if (message.skip_transcript === true) return;
			body = [
				text(message.description),
				text(message.summary),
				text(message.status),
			]
				.filter(Boolean)
				.join("\n");
			break;
		case "hook_started":
		case "hook_progress":
		case "hook_response":
			body = [
				text(message.hook_name),
				text(message.stdout),
				text(message.stderr),
				text(message.output),
				text(message.outcome),
			]
				.filter(Boolean)
				.join("\n");
			break;
		case "tool_use_summary":
			body = text(message.summary);
			break;
		default:
			return;
	}
	return body ? `\n\n[Claude Code: ${kind}]\n${body}\n\n` : undefined;
}

export const claudeCodeOutputMiddleware: LanguageModelV4Middleware = {
	specificationVersion: "v4",
	transformParams: async ({ params }) => ({
		...params,
		includeRawChunks: true,
	}),
	wrapStream: async ({ doStream }) => {
		const result = await doStream();
		let noticeIndex = 0;
		return {
			...result,
			stream: result.stream.pipeThrough(
				new TransformStream({
					transform(part, controller) {
						if (part.type === "raw") {
							const notice = formatClaudeCodeNotice(part.rawValue);
							if (notice) {
								const id = `claude-code-notice-${noticeIndex++}`;
								controller.enqueue({ type: "text-start", id });
								controller.enqueue({ type: "text-delta", id, delta: notice });
								controller.enqueue({ type: "text-end", id });
							}
							return;
						}
						controller.enqueue(part);
					},
				}),
			),
		};
	},
};
