import type {
	LanguageModelV4,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import {
	claudeCodeOutputMiddleware,
	formatClaudeCodeNotice,
} from "./claude-code-output";

describe("Claude Code output", () => {
	it("shows usage limit warnings and their exact reset time", () => {
		expect(
			formatClaudeCodeNotice({
				type: "rate_limit_event",
				rate_limit_info: {
					status: "rejected",
					rateLimitType: "five_hour",
					resetsAt: 0,
				},
			}),
		).toContain("rejected: five_hour\nResets at 1970-01-01T00:00:00.000Z");
		expect(
			formatClaudeCodeNotice({
				type: "rate_limit_event",
				rate_limit_info: { status: "allowed" },
			}),
		).toBeUndefined();
		expect(
			formatClaudeCodeNotice({
				type: "system",
				subtype: "permission_denied",
				tool_name: "Write",
				message: "Write was denied",
			}),
		).toContain("Write was denied");
	});

	it.each([
		[
			{
				type: "system",
				subtype: "informational",
				content: "Usage limit reached",
				level: "warning",
			},
			"Usage limit reached",
		],
		[
			{
				type: "system",
				subtype: "local_command_output",
				content: "Command output",
			},
			"Command output",
		],
		[{ type: "system", subtype: "notification", text: "Waiting" }, "Waiting"],
		[
			{
				type: "auth_status",
				output: ["Signing in"],
				error: "Authentication failed",
			},
			"Authentication failed",
		],
		[
			{
				type: "system",
				subtype: "api_retry",
				attempt: 1,
				max_retries: 3,
				retry_delay_ms: 1000,
				error: "overloaded",
			},
			"Retry 1/3 in 1000ms: overloaded",
		],
		[
			{
				type: "system",
				subtype: "status",
				status: "compacting",
				compact_error: "Cannot compact",
			},
			"Cannot compact",
		],
		[
			{
				type: "system",
				subtype: "task_progress",
				description: "Checking files",
				summary: "Found a bug",
			},
			"Found a bug",
		],
		[
			{
				type: "system",
				subtype: "hook_response",
				hook_name: "Check",
				stdout: "Output",
				stderr: "Failed",
				outcome: "error",
			},
			"Failed",
		],
		[
			{ type: "tool_use_summary", summary: "Read three files" },
			"Read three files",
		],
	])("shows user-facing output from %j", (message, expected) => {
		expect(formatClaudeCodeNotice(message)).toContain(expected);
	});

	it("does not duplicate normal output or expose init credentials and protocol messages", () => {
		for (const message of [
			{
				type: "assistant",
				message: { content: [{ type: "text", text: "Answer" }] },
			},
			{
				type: "user",
				message: { content: [{ type: "tool_result", content: "Result" }] },
			},
			{ type: "stream_event", event: { type: "content_block_delta" } },
			{ type: "system", subtype: "init", apiKeySource: "secret" },
			{
				type: "system",
				subtype: "task_started",
				skip_transcript: true,
				description: "Housekeeping",
			},
			null,
		]) {
			expect(formatClaudeCodeNotice(message)).toBeUndefined();
		}
	});

	it("streams notices in order alongside thinking, tools, failures, and text", async () => {
		let includeRawChunks: boolean | undefined;
		const parts: LanguageModelV4StreamPart[] = [
			{ type: "reasoning-start", id: "r" },
			{ type: "reasoning-delta", id: "r", delta: "Thinking" },
			{ type: "reasoning-end", id: "r" },
			{
				type: "tool-call",
				toolCallId: "t",
				toolName: "Bash",
				input: '{"command":"false"}',
				providerExecuted: true,
			},
			{
				type: "raw",
				rawValue: {
					type: "system",
					subtype: "hook_progress",
					stderr: "Hook warning",
				},
			},
			{
				type: "tool-result",
				toolCallId: "t",
				toolName: "Bash",
				result: "Failed",
				isError: true,
			},
			{ type: "text-start", id: "answer" },
			{ type: "text-delta", id: "answer", delta: "Done" },
			{ type: "text-end", id: "answer" },
		];
		const model: LanguageModelV4 = {
			specificationVersion: "v4",
			provider: "test",
			modelId: "test",
			supportedUrls: {},
			doGenerate: async () => {
				throw new Error("Not used");
			},
			doStream: async (params) => {
				includeRawChunks = params.includeRawChunks;
				return {
					stream: new ReadableStream({
						start(controller) {
							for (const part of parts) controller.enqueue(part);
							controller.close();
						},
					}),
				};
			},
		};
		const wrapped = wrapLanguageModel({
			model,
			middleware: claudeCodeOutputMiddleware,
		});
		const { stream } = await wrapped.doStream({ prompt: [] });
		const output: LanguageModelV4StreamPart[] = [];
		for await (const part of stream) output.push(part);
		expect(includeRawChunks).toBe(true);
		expect(output).toEqual([
			...parts.slice(0, 4),
			{ type: "text-start", id: "claude-code-notice-0" },
			{
				type: "text-delta",
				id: "claude-code-notice-0",
				delta: expect.stringContaining("Hook warning"),
			},
			{ type: "text-end", id: "claude-code-notice-0" },
			...parts.slice(5),
		]);
	});
});
