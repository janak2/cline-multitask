import process from "node:process";
import {
	type ClineCoreStartInput,
	type SessionRecord,
	SessionSource,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import type { WebviewConfig, WebviewReasonLevel } from "../webview-protocol";
import {
	rejectPendingApprovalsForSession,
	resendPendingApprovals,
} from "./approvals";
import { providerSettingsManager, workspaceRoot } from "./deps";
import {
	loadProviders,
	resolveBrowserDefaults,
	sendProviderCatalog,
} from "./providers";
import {
	mapHistoryToWebviewMessages,
	trackSession,
	webviewSessionsPayload,
} from "./session-mapping";
import type { HubContext } from "./state";
import { broadcastHubState, hubStatePayload } from "./state-payloads";
import type { BrowserPeer, SessionContext } from "./types";
import { asNumber, asString } from "./utils";

function toRuntimeReasoningOptions(
	reasonLevel?: WebviewReasonLevel,
): Pick<ClineCoreStartInput["config"], "reasoningEffort" | "thinking"> {
	if (reasonLevel === undefined) return {};
	if (reasonLevel === "none") return { thinking: false };
	return { thinking: true, reasoningEffort: reasonLevel };
}

function asWebviewReasonLevel(value: unknown): WebviewReasonLevel | undefined {
	return value === "none" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
		? value
		: undefined;
}

/**
 * Reads a session's saved thinking level. Hub sessions store `reasonLevel`;
 * desktop sessions store `reasoning: { thinking, reasoningEffort }`.
 */
export function readSessionReasonLevel(
	metadata: unknown,
): WebviewReasonLevel | undefined {
	if (!metadata || typeof metadata !== "object") return undefined;
	const record = metadata as Record<string, unknown>;
	const direct = asWebviewReasonLevel(record.reasonLevel);
	if (direct) return direct;
	const reasoning = record.reasoning;
	if (!reasoning || typeof reasoning !== "object") return undefined;
	const { thinking, reasoningEffort } = reasoning as Record<string, unknown>;
	if (thinking === false) return "none";
	return asWebviewReasonLevel(reasoningEffort);
}

export function resolveLaunchContext(
	ctx: HubContext,
	override?: Partial<SessionContext> & WebviewConfig,
): SessionContext {
	const providerId =
		override?.provider ??
		override?.providerId ??
		ctx.lastSessionContext?.providerId ??
		providerSettingsManager.getLastUsedProviderSettings()?.provider ??
		process.env.CLINE_PROVIDER?.trim() ??
		"";
	const modelId =
		override?.model ??
		override?.modelId ??
		ctx.lastSessionContext?.modelId ??
		providerSettingsManager.getLastUsedProviderSettings()?.model ??
		process.env.CLINE_MODEL?.trim() ??
		"";
	const root =
		override?.workspaceRoot ??
		ctx.lastSessionContext?.workspaceRoot ??
		workspaceRoot;
	if (!providerId || !modelId) {
		throw new Error(
			"No provider/model available. Start a session in another Cline client first, or set CLINE_PROVIDER and CLINE_MODEL.",
		);
	}
	return {
		workspaceRoot: root,
		cwd: override?.cwd ?? ctx.lastSessionContext?.cwd ?? root,
		providerId,
		modelId,
	};
}

function buildSessionStartInput(
	context: SessionContext,
	options?: {
		mode?: "act" | "plan";
		systemPrompt?: string;
		maxIterations?: number;
		reasonLevel?: WebviewReasonLevel;
		enableTools?: boolean;
		enableSpawn?: boolean;
		enableTeams?: boolean;
		autoApproveTools?: boolean;
		teamName?: string;
		source?: SessionSource;
		sessionMetadata?: Record<string, unknown>;
		initialMessages?: MessageWithMetadata[];
	},
): ClineCoreStartInput {
	const mode = options?.mode === "plan" ? "plan" : "act";
	const reasoningOptions = toRuntimeReasoningOptions(options?.reasonLevel);
	return {
		source: options?.source ?? SessionSource.WEB,
		interactive: true,
		config: {
			workspaceRoot: context.workspaceRoot,
			cwd: context.cwd,
			providerId: context.providerId,
			modelId: context.modelId,
			systemPrompt: options?.systemPrompt ?? "",
			mode,
			...reasoningOptions,
			maxIterations: options?.maxIterations,
			enableTools: options?.enableTools !== false,
			enableSpawnAgent: options?.enableSpawn !== false,
			enableAgentTeams: options?.enableTeams === true,
			teamName: options?.teamName ?? "cline-hub",
			missionLogIntervalSteps: 3,
			missionLogIntervalMs: 120000,
			checkpoint: { enabled: true },
		},
		sessionMetadata: {
			source: options?.source ?? SessionSource.WEB,
			mode,
			systemPrompt: options?.systemPrompt,
			maxIterations: options?.maxIterations,
			reasonLevel: options?.reasonLevel,
			autoApproveTools: options?.autoApproveTools,
			...(options?.sessionMetadata ?? {}),
		},
		...(options?.initialMessages
			? { initialMessages: options.initialMessages }
			: {}),
		toolPolicies:
			options?.autoApproveTools === false
				? { "*": { autoApprove: false } }
				: { "*": { autoApprove: true } },
	};
}

function buildStartInputFromSession(
	session: SessionRecord,
	options?: {
		sessionMetadata?: Record<string, unknown>;
		initialMessages?: MessageWithMetadata[];
	},
) {
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? session.metadata
			: {};
	const mode = metadata.mode === "plan" ? "plan" : "act";
	return buildSessionStartInput(
		{
			workspaceRoot: session.workspaceRoot,
			cwd: session.cwd,
			providerId: session.provider,
			modelId: session.model,
		},
		{
			mode,
			systemPrompt: asString(metadata.systemPrompt),
			maxIterations: asNumber(metadata.maxIterations),
			reasonLevel: asWebviewReasonLevel(metadata.reasonLevel),
			enableTools: session.enableTools,
			enableSpawn: session.enableSpawn,
			enableTeams: session.enableTeams,
			autoApproveTools:
				typeof metadata.autoApproveTools === "boolean"
					? metadata.autoApproveTools
					: undefined,
			teamName: session.teamName,
			source: session.source,
			sessionMetadata: { ...metadata, ...(options?.sessionMetadata ?? {}) },
			initialMessages: options?.initialMessages,
		},
	);
}

async function loadHistoryFor(
	ctx: HubContext,
	sessionId: string,
): Promise<unknown[]> {
	if (!ctx.cline) return [];
	try {
		return (await ctx.cline.readMessages(sessionId)) as unknown[];
	} catch (error) {
		console.warn(`readMessages(${sessionId}) failed:`, error);
		return [];
	}
}

export async function selectSession(
	ctx: HubContext,
	peer: BrowserPeer,
	sessionId: string,
): Promise<void> {
	peer.selectedSessionId = sessionId;
	const tracked = ctx.sessions.get(sessionId);
	const history = await loadHistoryFor(ctx, sessionId);
	const record = await ctx.cline?.get(sessionId).catch(() => undefined);
	ctx.send(peer, { type: "session_started", sessionId });
	ctx.send(peer, {
		type: "session_hydrated",
		sessionId,
		status: tracked?.status,
		providerId: tracked?.provider,
		modelId: tracked?.model,
		reasonLevel: readSessionReasonLevel(record?.metadata),
		messages: mapHistoryToWebviewMessages(history),
	});
	resendPendingApprovals(ctx, peer, sessionId);
}

export async function createSession(
	ctx: HubContext,
	peer: BrowserPeer,
	prompt: string,
	config?: WebviewConfig,
	attachments?: { userImages?: string[] },
): Promise<void> {
	if (!ctx.cline) throw new Error("Hub is not connected.");
	const context = resolveLaunchContext(ctx, config);
	const mode = config?.mode === "plan" ? "plan" : "act";
	const result = await ctx.cline.start(
		buildSessionStartInput(context, {
			mode,
			systemPrompt: config?.systemPrompt,
			maxIterations: config?.maxIterations,
			reasonLevel: config?.reasonLevel,
			enableTools: config?.enableTools,
			enableSpawn: config?.enableSpawn,
			enableTeams: config?.enableTeams,
			autoApproveTools: config?.autoApproveTools,
		}),
	);
	peer.selectedSessionId = result.sessionId;
	ctx.sessions.set(result.sessionId, {
		sessionId: result.sessionId,
		status: "running",
		title: prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt,
		workspaceRoot: context.workspaceRoot,
		cwd: context.cwd,
		provider: context.providerId,
		model: context.modelId,
		source: SessionSource.WEB,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		prompt,
		agentCount: 1,
		participantCount: 1,
	});
	const tracked = ctx.sessions.get(result.sessionId);
	ctx.send(peer, { type: "session_started", sessionId: result.sessionId });
	ctx.send(peer, {
		type: "session_hydrated",
		sessionId: result.sessionId,
		status: tracked?.status,
		providerId: context.providerId,
		modelId: context.modelId,
		messages: [],
	});
	broadcastHubState(ctx);
	await ctx.cline.send({
		sessionId: result.sessionId,
		prompt,
		mode,
		userImages: attachments?.userImages,
	});
}

async function applySessionReasonLevel(
	ctx: HubContext,
	sessionId: string,
	reasonLevel: WebviewReasonLevel,
): Promise<void> {
	if (!ctx.cline) return;
	try {
		// Takes effect from the next turn of the running session.
		await ctx.cline.updateSessionConnection(
			sessionId,
			toRuntimeReasoningOptions(reasonLevel),
		);
	} catch (error) {
		console.warn(`updateSessionConnection(${sessionId}) failed:`, error);
	}
	try {
		// Saved so the level survives a restart and shows when the session reopens.
		const session = await ctx.cline.get(sessionId);
		const metadata =
			session?.metadata && typeof session.metadata === "object"
				? (session.metadata as Record<string, unknown>)
				: {};
		await ctx.cline.update(sessionId, {
			metadata: { ...metadata, reasonLevel },
		});
	} catch (error) {
		console.warn(`Saving thinking level for ${sessionId} failed:`, error);
	}
}

export async function sendMessage(
	ctx: HubContext,
	peer: BrowserPeer,
	text: string,
	config?: WebviewConfig,
	attachments?: { userImages?: string[] },
): Promise<void> {
	if (!ctx.cline) throw new Error("Hub is not connected.");
	if (!peer.selectedSessionId) {
		await createSession(ctx, peer, text, config, attachments);
		return;
	}
	// The browser only sends a thinking level when the user changed it for this
	// session, so a level set elsewhere is never silently overwritten.
	if (config?.reasonLevel !== undefined) {
		await applySessionReasonLevel(
			ctx,
			peer.selectedSessionId,
			config.reasonLevel,
		);
	}
	await ctx.cline.send({
		sessionId: peer.selectedSessionId,
		prompt: text,
		mode: config?.mode === "plan" ? "plan" : "act",
		userImages: attachments?.userImages,
	});
}

export async function deleteSession(
	ctx: HubContext,
	peer: BrowserPeer,
	sessionId: string,
): Promise<void> {
	if (!ctx.cline) throw new Error("Hub is not connected.");
	const deleted = await ctx.cline.delete(sessionId);
	if (!deleted) {
		ctx.send(peer, {
			type: "status",
			text: `Session ${sessionId} was not found.`,
		});
		return;
	}
	ctx.sessions.delete(sessionId);
	if (peer.selectedSessionId === sessionId) {
		peer.selectedSessionId = undefined;
		ctx.send(peer, { type: "reset_done" });
	}
	ctx.send(peer, { type: "status", text: `Deleted session ${sessionId}` });
	broadcastHubState(ctx);
}

export async function resetPeer(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	if (peer.selectedSessionId) {
		rejectPendingApprovalsForSession(
			ctx,
			peer.selectedSessionId,
			"Session detached before approval was resolved.",
		);
	}
	peer.selectedSessionId = undefined;
	ctx.send(peer, { type: "reset_done" });
	ctx.send(peer, webviewSessionsPayload(ctx));
}

export async function abortPeerTurn(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	if (!ctx.cline || !peer.selectedSessionId) return;
	rejectPendingApprovalsForSession(
		ctx,
		peer.selectedSessionId,
		"Turn aborted before approval was resolved.",
	);
	await ctx.cline.abort(peer.selectedSessionId);
	ctx.send(peer, { type: "status", text: "Abort requested." });
}

export async function forkPeerSession(
	ctx: HubContext,
	peer: BrowserPeer,
	syncHubClientsAndSessions: () => Promise<void>,
): Promise<void> {
	if (!ctx.cline) throw new Error("Hub is not connected.");
	const forkedFromSessionId = peer.selectedSessionId;
	if (!forkedFromSessionId) {
		ctx.send(peer, { type: "fork_error", text: "No active session to fork." });
		return;
	}
	try {
		const rawMessages = (await ctx.cline.readMessages(
			forkedFromSessionId,
		)) as MessageWithMetadata[];
		if (rawMessages.length === 0) {
			ctx.send(peer, {
				type: "fork_error",
				text: "Cannot fork an empty session.",
			});
			return;
		}
		const sourceSession = await ctx.cline.get(forkedFromSessionId);
		if (!sourceSession) {
			ctx.send(peer, {
				type: "fork_error",
				text: `Session ${forkedFromSessionId} was not found.`,
			});
			return;
		}
		const checkpointMetadata = sourceSession.metadata?.checkpoint;
		const result = await ctx.cline.start(
			buildStartInputFromSession(sourceSession, {
				initialMessages: rawMessages,
				sessionMetadata: {
					...(sourceSession.metadata ?? {}),
					fork: {
						forkedFromSessionId,
						forkedAt: new Date().toISOString(),
						source: sourceSession.source,
						...(checkpointMetadata !== undefined
							? { checkpoints: checkpointMetadata }
							: {}),
					},
				},
			}),
		);
		peer.selectedSessionId = result.sessionId;
		const newSession = await ctx.cline.get(result.sessionId);
		const tracked = newSession ? trackSession(newSession) : undefined;
		if (tracked) ctx.sessions.set(tracked.sessionId, tracked);
		ctx.send(peer, { type: "session_started", sessionId: result.sessionId });
		ctx.send(peer, {
			type: "session_hydrated",
			sessionId: result.sessionId,
			status: newSession?.status,
			providerId: newSession?.provider,
			modelId: newSession?.model,
			messages: mapHistoryToWebviewMessages(rawMessages),
		});
		ctx.send(peer, {
			type: "fork_done",
			forkedFromSessionId,
			newSessionId: result.sessionId,
		});
		await syncHubClientsAndSessions();
		broadcastHubState(ctx);
	} catch (error) {
		ctx.send(peer, {
			type: "fork_error",
			text: error instanceof Error ? error.message : String(error),
		});
	}
}

export async function restorePeerSession(
	ctx: HubContext,
	peer: BrowserPeer,
	checkpointRunCount: number,
	syncHubClientsAndSessions: () => Promise<void>,
): Promise<void> {
	if (!ctx.cline) throw new Error("Hub is not connected.");
	const sourceSessionId = peer.selectedSessionId;
	if (!sourceSessionId) {
		ctx.send(peer, { type: "error", text: "No active session to restore." });
		return;
	}
	const sourceSession = await ctx.cline.get(sourceSessionId);
	if (!sourceSession) {
		ctx.send(peer, {
			type: "error",
			text: `Session ${sourceSessionId} was not found.`,
		});
		return;
	}
	const result = await ctx.cline.restore({
		sessionId: sourceSessionId,
		checkpointRunCount,
		cwd: sourceSession.cwd,
		start: buildStartInputFromSession(sourceSession, {
			sessionMetadata: {
				...(sourceSession.metadata ?? {}),
				restoredFromSessionId: sourceSessionId,
				restoredCheckpointRunCount: checkpointRunCount,
			},
		}),
		restore: { messages: true, workspace: true },
	});
	if (!result.sessionId) {
		ctx.send(peer, {
			type: "error",
			text: "Checkpoint restore did not start a session.",
		});
		return;
	}
	peer.selectedSessionId = result.sessionId;
	const restoredSession = await ctx.cline.get(result.sessionId);
	const tracked = restoredSession ? trackSession(restoredSession) : undefined;
	if (tracked) ctx.sessions.set(tracked.sessionId, tracked);
	const messages =
		result.messages ?? (await loadHistoryFor(ctx, result.sessionId));
	ctx.send(peer, { type: "session_started", sessionId: result.sessionId });
	ctx.send(peer, {
		type: "session_hydrated",
		sessionId: result.sessionId,
		status: restoredSession?.status,
		providerId: restoredSession?.provider,
		modelId: restoredSession?.model,
		messages: mapHistoryToWebviewMessages(messages),
	});
	await syncHubClientsAndSessions();
	broadcastHubState(ctx);
}

export async function initializePeer(
	ctx: HubContext,
	peer: BrowserPeer,
	syncHubClientsAndSessions: () => Promise<void>,
): Promise<void> {
	await syncHubClientsAndSessions();
	ctx.send(peer, { type: "status", text: "Cline Hub is ready." });
	ctx.send(peer, { type: "defaults", defaults: resolveBrowserDefaults(ctx) });
	await loadProviders(ctx, peer);
	await sendProviderCatalog(ctx, peer);
	ctx.send(peer, webviewSessionsPayload(ctx));
	ctx.send(peer, hubStatePayload(ctx));
}
