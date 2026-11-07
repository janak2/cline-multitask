import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	clearLiveModelsCatalogCache,
	resetClineRecommendedModelsCacheForTests,
} from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudSessionManager } from "./cloud-sessions";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import {
	getDesktopFeatureFlagsService,
	resetDesktopFeatureFlagsForTesting,
} from "./feature-flags";
import { recordHubActivity } from "./hub-admin";
import {
	LOCAL_ENVIRONMENT_ID,
	type SessionRuntimeBinding,
	type SidecarContext,
} from "./types";

function createContext(): {
	ctx: SidecarContext;
	events: Array<{ name: string; payload: Record<string, unknown> }>;
} {
	const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
	const ctx = createSidecarContext("/local/workspace");
	ctx.wsClients.add({
		send: (message) => events.push(JSON.parse(message).event),
	});
	return { ctx, events };
}

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-commands-settings-"));
	process.env.CLINE_DATA_DIR = dataDir;
	resetDesktopFeatureFlagsForTesting();
});

afterEach(() => {
	clearLiveModelsCatalogCache();
	resetClineRecommendedModelsCacheForTests();
	vi.unstubAllGlobals();
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_DATA_DIR;
	resetDesktopFeatureFlagsForTesting();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("desktop settings commands", () => {
	it("only returns hub notification content to trusted desktop connections", async () => {
		const { ctx } = createContext();
		const command = vi
			.fn()
			.mockResolvedValue({ ok: true, payload: { clients: [] } });
		ctx.runtimeBindings.set(LOCAL_ENVIRONMENT_ID, {
			hubClient: { command, getUrl: () => "ws://127.0.0.1:1234/hub" },
		} as unknown as SessionRuntimeBinding);
		recordHubActivity(ctx, {
			event: "ui.notify",
			payload: { title: "Task completed", body: "Private task reply" },
		});
		await expect(handleCommand(ctx, "get_hub_status")).rejects.toThrow(
			"hub status requires a trusted desktop connection",
		);
		await expect(
			handleCommand(ctx, "get_hub_status", undefined, {
				connection: { send: vi.fn(), data: { canApproveTools: false } },
			}),
		).rejects.toThrow("hub status requires a trusted desktop connection");
		expect(command).not.toHaveBeenCalled();
		const result = await handleCommand(ctx, "get_hub_status", undefined, {
			connection: { send: vi.fn(), data: { canApproveTools: true } },
		});
		expect(command).toHaveBeenCalledWith("client.list");
		expect(result).toMatchObject({
			events: [{ title: "Task completed", detail: "Private task reply" }],
		});
	});

	it("rejects hub restarts from untrusted connections", async () => {
		const { ctx } = createContext();
		await expect(handleCommand(ctx, "restart_hub")).rejects.toThrow(
			"trusted desktop connection",
		);
	});

	it("rejects phone access commands from untrusted connections", async () => {
		const { ctx } = createContext();
		for (const command of ["get_phone_access", "set_phone_access_enabled"]) {
			await expect(
				handleCommand(
					ctx,
					command,
					{ enabled: false },
					{
						connection: { send: vi.fn(), data: { canApproveTools: false } },
					},
				),
			).rejects.toThrow("phone access requires a trusted desktop connection");
		}
	});
	it("lists only current gateway transcription models for voice input", async () => {
		const { ctx } = createContext();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					data: [
						{
							id: "stt",
							modalities: { input: ["audio"], output: ["text"] },
							supported_specifications: ["v4"],
						},
						{
							id: "transcribe-chat",
							type: "language",
							modalities: { input: ["text", "audio"], output: ["text"] },
							supported_specifications: ["v4"],
						},
					],
				}),
			),
		);
		const result = (await handleCommand(ctx, "list_transcription_models", {
			provider: "vercel-ai-gateway",
		})) as { models: Array<{ id: string }> };
		expect(result.models.map((model) => model.id)).toEqual(["stt"]);
	});

	it("uses the same activity order before limiting history and retains live activity during a list failure", async () => {
		const { ctx } = createContext();
		const row = {
			status: "completed",
			provider: "cline",
			model: "test",
			prompt: "Hello",
			cwd: "/workspace",
			workspaceRoot: "/workspace",
		};
		const active = {
			...row,
			sessionId: "active",
			startedAt: "2026-07-20T10:00:00.000Z",
		};
		const idle = {
			...row,
			sessionId: "idle",
			startedAt: "2026-07-21T10:00:00Z",
			updatedAt: "2026-07-25T10:00:00Z",
		};
		const list = vi.fn().mockResolvedValue([active, idle]);
		ctx.runtimeBindings.set("local", {
			environmentId: "local",
			kind: "local",
			sessionManager: { list },
		} as unknown as SessionRuntimeBinding);
		ctx.liveSessions.set("active", {
			config: row,
			prompt: "Hello",
			messages: [],
			promptsInQueue: [],
			busy: true,
			status: "running",
			startedAt: Date.parse(active.startedAt),
			lastActivityAt: Date.parse("2026-07-22T10:00:00Z"),
		});
		for (const fails of [false, true, false]) {
			if (fails) list.mockRejectedValue(new Error("temporary list failure"));
			else list.mockResolvedValue([active, idle]);
			const result = await handleCommand(ctx, "list_discovered_sessions", {
				limit: 1,
			});
			expect(result).toMatchObject([
				{
					sessionId: "active",
					startedAt: active.startedAt,
					lastActivityAt: "2026-07-22T10:00:00.000Z",
				},
			]);
		}
	});

	it.each([
		"list_chat_sessions",
		"list_discovered_sessions",
		"search_sessions",
	])("hides cloud rows from %s unless the rollout flag is enabled", async (command) => {
		const { ctx } = createContext();
		for (const target of ["local", "cloud"] as const) {
			ctx.liveSessions.set(target, {
				config: { executionTarget: target, provider: "cline", model: "test" },
				prompt: "match",
				messages: [],
				promptsInQueue: [],
				busy: false,
				status: "completed",
				startedAt: Date.now(),
			});
		}
		const cloudRows = [
			{ sessionId: "cloud", origin: "cloud", prompt: "match" },
		];
		const discovery = vi
			.spyOn(getCloudSessionManager(ctx), "listForDiscovery")
			.mockResolvedValue(cloudRows);
		const flags = getDesktopFeatureFlagsService();
		flags.hydrateCache({
			userId: null,
			updateTime: Date.now(),
			flagsPayload: { featureFlags: { "code-cloud-agents": true } },
		});
		const rows = async () =>
			(
				(await handleCommand(ctx, command, { query: "match" })) as Array<{
					sessionId: string;
				}>
			)
				.map((row) => row.sessionId)
				.sort();

		expect(await rows()).toEqual(["cloud", "local"]);
		discovery.mockImplementationOnce(async () => {
			process.env.CLINE_CODE_CLOUD_AGENTS = "0";
			return cloudRows;
		});
		expect(await rows()).toEqual(["local"]);
		delete process.env.CLINE_CODE_CLOUD_AGENTS;
		discovery.mockClear();
		flags.hydrateCache({
			userId: null,
			updateTime: Date.now(),
			flagsPayload: { featureFlags: { "code-cloud-agents": false } },
		});
		expect(await rows()).toEqual(["local"]);
		expect(discovery).not.toHaveBeenCalled();
		expect(ctx.liveSessions.has("cloud")).toBe(true);
	});

	it("routes local model discovery through the local hub without cloud-only models", async () => {
		const { ctx } = createContext();
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: { providerId: "cline", models: [] },
		});
		ctx.runtimeBindings.set(LOCAL_ENVIRONMENT_ID, {
			hubClient: { command },
		} as unknown as SessionRuntimeBinding);
		ctx.activeEnvironmentId = "ssh-remote";
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		await handleCommand(ctx, "list_provider_models", {
			provider: "cline",
			includeCloudModels: true,
		});
		expect(command).toHaveBeenLastCalledWith(
			"providers.models.list",
			{ providerId: "cline" },
			undefined,
			{ retryAfterDispatch: false },
		);
		process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		await handleCommand(ctx, "list_provider_models", {
			provider: "cline",
			includeCloudModels: true,
		});
		expect(command).toHaveBeenLastCalledWith(
			"providers.models.list",
			{ providerId: "cline" },
			undefined,
			{ retryAfterDispatch: false },
		);
	});
});
