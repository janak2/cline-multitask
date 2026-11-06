import { describe, expect, it, vi } from "vitest";
import {
	type ChatCommandState,
	chatCommandHost,
	createChatCommandHost,
} from "../../utils/chat-commands";
import type { Config } from "../../utils/types";
import {
	type InteractiveChatCommandRuntime,
	runInteractiveChatCommand,
} from "./chat-command-runner";

function makeConfig(): Config {
	return {
		apiKey: "",
		providerId: "cline",
		modelId: "openai/gpt-5.3-codex",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: false,
		defaultToolAutoApprove: false,
		toolPolicies: {},
		cwd: process.cwd(),
	};
}

function makeState(config: Config): ChatCommandState {
	return {
		enableTools: config.enableTools,
		autoApproveTools: config.defaultToolAutoApprove,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot?.trim() || config.cwd,
	};
}

function makeRuntime(): InteractiveChatCommandRuntime {
	return {
		forkCurrentSession: vi.fn(async () => undefined),
		getActiveSessionId: vi.fn(() => "session-1"),
		resetForNewSession: vi.fn(async () => {}),
		restartEmpty: vi.fn(async () => {}),
		restartWithCurrentMessages: vi.fn(async () => {}),
		stopTeammates: vi.fn(async () => {}),
	};
}

function runMultitaskCommand(
	prompt: string,
	config: Config,
	runtime: InteractiveChatCommandRuntime,
	options: {
		setMultitask?: (enabled: boolean) => void;
		activeTeammateRuns?: number;
	} = {},
) {
	return runInteractiveChatCommand({
		prompt,
		enabled: true,
		config,
		host: chatCommandHost,
		chatCommandState: makeState(config),
		autoApproveAllRef: { current: false },
		setInteractiveAutoApprove: () => {},
		sessionRuntime: runtime,
		setMultitask: options.setMultitask ?? (() => {}),
		getActiveTeammateRuns: () => options.activeTeammateRuns ?? 0,
		stop: () => {},
	});
}

describe("runInteractiveChatCommand", () => {
	it("handles missing team prompt body as command usage", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		const result = await runInteractiveChatCommand({
			prompt: "/team",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			setMultitask: () => {},
			getActiveTeammateRuns: () => 0,
			stop: () => {},
		});

		expect(result).toEqual({
			handled: true,
			turnResult: {
				usage: { inputTokens: 0, outputTokens: 0 },
				iterations: 0,
				commandOutput:
					"Usage: /team <task description>\nStarts a team of agents for the given task.",
			},
		});
		expect(runtime.restartEmpty).not.toHaveBeenCalled();
	});

	it("rewrites team prompts and enables teams before model submission", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		const result = await runInteractiveChatCommand({
			prompt: "/team inspect the TUI",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			setMultitask: () => {},
			getActiveTeammateRuns: () => 0,
			stop: () => {},
		});

		expect(result.handled).toBe(false);
		if (!result.handled) {
			expect(result.input).toContain("spawn a team of agents");
			expect(result.input).toContain("inspect the TUI");
		}
		expect(config.enableAgentTeams).toBe(true);
		expect(config.teamName).toBeTruthy();
		expect(runtime.restartEmpty).toHaveBeenCalledOnce();
	});

	it("resets slash new without eagerly restarting the runtime", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		const result = await runInteractiveChatCommand({
			prompt: "/new",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			setMultitask: () => {},
			getActiveTeammateRuns: () => 0,
			stop: () => {},
		});

		expect(result).toEqual({
			handled: true,
			turnResult: {
				usage: { inputTokens: 0, outputTokens: 0 },
				iterations: 0,
				commandOutput: "Started a fresh session.",
			},
		});
		expect(runtime.resetForNewSession).toHaveBeenCalledOnce();
		expect(runtime.restartEmpty).not.toHaveBeenCalled();
	});

	it("applies chat command state updates and returns command output", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const state = makeState(config);
		const autoApproveAllRef = { current: false };
		const setInteractiveAutoApprove = vi.fn((enabled: boolean) => {
			autoApproveAllRef.current = enabled;
		});

		const result = await runInteractiveChatCommand({
			prompt: "/yolo on",
			enabled: true,
			config,
			host: chatCommandHost,
			chatCommandState: state,
			autoApproveAllRef,
			setInteractiveAutoApprove,
			sessionRuntime: runtime,
			setMultitask: () => {},
			getActiveTeammateRuns: () => 0,
			stop: () => {},
		});

		expect(result).toEqual({
			handled: true,
			turnResult: {
				usage: { inputTokens: 0, outputTokens: 0 },
				iterations: 0,
				commandOutput: "yolo=on",
			},
		});
		expect(state.autoApproveTools).toBe(true);
		expect(setInteractiveAutoApprove).toHaveBeenCalledWith(true);
	});

	it("returns plugin command submit prompts as model input", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const onCommandOutput = vi.fn();
		const host = createChatCommandHost().register("command", {
			names: ["/goal"],
			run: async ({ args }, context) => {
				await context.reply(`Goal guard set: ${args.join(" ")}`);
				await context.submitPrompt?.(args.join(" "));
			},
		});

		const result = await runInteractiveChatCommand({
			prompt: "/goal fix tests",
			enabled: true,
			config,
			host,
			chatCommandState: makeState(config),
			autoApproveAllRef: { current: false },
			setInteractiveAutoApprove: () => {},
			sessionRuntime: runtime,
			setMultitask: () => {},
			getActiveTeammateRuns: () => 0,
			stop: () => {},
			onCommandOutput,
		});

		expect(result).toEqual({
			handled: false,
			input: "fix tests",
			commandOutput: "Goal guard set: fix tests",
		});
		expect(onCommandOutput).toHaveBeenCalledWith("Goal guard set: fix tests");
	});

	it("turns multitask on and off without a model call", async () => {
		const config = { ...makeConfig(), enableAgentTeams: true };
		const runtime = makeRuntime();
		const setMultitask = vi.fn();

		const on = await runMultitaskCommand("/multitask", config, runtime, {
			setMultitask,
		});
		const off = await runMultitaskCommand("/multitask off", config, runtime, {
			setMultitask,
			activeTeammateRuns: 2,
		});

		expect(on).toMatchObject({
			handled: true,
			turnResult: { commandOutput: "Multitask mode is on." },
		});
		expect(off).toMatchObject({
			handled: true,
			turnResult: {
				commandOutput:
					"Multitask mode is off. 2 teammate run(s) are still going; your next message waits for them.",
			},
		});
		expect(setMultitask.mock.calls).toEqual([[true], [false]]);
		expect(runtime.restartWithCurrentMessages).not.toHaveBeenCalled();
	});

	it("enables teams for multitask while keeping the conversation", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();

		await runMultitaskCommand("/multitask on", config, runtime);

		expect(config.enableAgentTeams).toBe(true);
		expect(config.teamName).toBeTruthy();
		expect(runtime.restartWithCurrentMessages).toHaveBeenCalledOnce();
		expect(runtime.restartEmpty).not.toHaveBeenCalled();
	});

	it("turns multitask on and sends a task in one go", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const setMultitask = vi.fn();

		const result = await runMultitaskCommand(
			"/multitask add dark mode",
			config,
			runtime,
			{ setMultitask },
		);

		expect(result).toEqual({
			handled: false,
			input: "add dark mode",
			commandOutput: "Multitask mode is on.",
		});
		expect(setMultitask.mock.calls).toEqual([[true]]);
		expect(config.enableAgentTeams).toBe(true);
		expect(runtime.restartWithCurrentMessages).toHaveBeenCalledOnce();
	});

	it("stops teammates without changing the mode", async () => {
		const config = makeConfig();
		const runtime = makeRuntime();
		const setMultitask = vi.fn();

		const result = await runMultitaskCommand(
			"/multitask stop",
			config,
			runtime,
			{
				setMultitask,
			},
		);

		expect(result).toMatchObject({
			handled: true,
			turnResult: { commandOutput: "Stopped all background teammates." },
		});
		expect(runtime.stopTeammates).toHaveBeenCalledOnce();
		expect(setMultitask).not.toHaveBeenCalled();
	});
});
