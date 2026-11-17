import process from "node:process";
import {
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	Llms,
	listLocalProviders,
	loginAndSaveLocalProviderOAuthCredentials,
	markLocalProviderEnabled,
	normalizeOAuthProvider,
	saveLocalProviderSettings,
} from "@cline/core";
import { isChatCompatibleModel } from "@cline/shared";
import type { ProviderListItem } from "@cline/core";
import type {
	WebviewInboundMessage,
	WebviewProviderModel,
	WebviewProviderPermissionMode,
} from "../webview-protocol";
import { providerSettingsManager, workspaceRoot } from "./deps";
import type { HubContext } from "./state";
import type { BrowserPeer, ProviderSettingsUpdate } from "./types";
import { openExternalUrl } from "./utils";

export function resolveBrowserDefaults(ctx: HubContext): {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
} {
	const lastUsed = providerSettingsManager.getLastUsedProviderSettings();
	return {
		provider:
			lastUsed?.provider ??
			ctx.lastSessionContext?.providerId ??
			process.env.CLINE_PROVIDER?.trim(),
		model:
			lastUsed?.model ??
			ctx.lastSessionContext?.modelId ??
			process.env.CLINE_MODEL?.trim(),
		workspaceRoot: ctx.lastSessionContext?.workspaceRoot ?? workspaceRoot,
		cwd:
			ctx.lastSessionContext?.cwd ??
			ctx.lastSessionContext?.workspaceRoot ??
			workspaceRoot,
	};
}

/** The provider's chat permission-mode menu, when its metadata declares one. */
export function toPermissionMode(
	item: Pick<ProviderListItem, "configFields" | "configValues">,
): WebviewProviderPermissionMode | undefined {
	const field = item.configFields?.find(
		(entry) =>
			entry.chatControl === "permission-mode" && entry.type === "select",
	);
	const options = (field?.options ?? []).flatMap((option) =>
		typeof option.value === "string"
			? [{ label: option.label, value: option.value }]
			: [],
	);
	if (!field || options.length === 0) return undefined;
	const stored = item.configValues?.[field.path] ?? field.defaultValue;
	return {
		path: field.path,
		label: field.label,
		...(field.description ? { description: field.description } : {}),
		options,
		...(typeof stored === "string" &&
		options.some((option) => option.value === stored)
			? { value: stored }
			: {}),
	};
}

/** Nested settings patch for a dotted config path, e.g. claudeCode.permissionMode. */
export function toPermissionSettingsPatch(
	path: string,
	value: string,
): ProviderSettingsUpdate {
	const segments = path.split(".").filter(Boolean);
	let patch: Record<string, unknown> = { [segments.at(-1) ?? path]: value };
	for (const segment of segments.slice(0, -1).reverse()) {
		patch = { [segment]: patch };
	}
	// The path and value were validated against the provider's own metadata.
	return patch as ProviderSettingsUpdate;
}

async function listPermissionModes(): Promise<
	Map<string, WebviewProviderPermissionMode>
> {
	try {
		const catalog = await listLocalProviders(providerSettingsManager, {
			isClinePassEnabled: true,
		});
		const modes = new Map<string, WebviewProviderPermissionMode>();
		for (const item of catalog.providers) {
			const mode = toPermissionMode(item);
			if (mode) modes.set(item.id, mode);
		}
		return modes;
	} catch {
		// The menu is optional; never block the provider list on it.
		return new Map();
	}
}

export async function loadProviders(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const state = providerSettingsManager.read();
	const permissionModes = await listPermissionModes();
	const defaults = resolveBrowserDefaults(ctx);
	const ids = Llms.getProviderIds().sort((a, b) => a.localeCompare(b));
	const providers = (
		await Promise.all(
			ids.map(async (id) => {
				const info = await Llms.getProvider(id);
				const enabled =
					Boolean(state.providers[id]?.settings) || id === defaults.provider;
				const permissionMode = permissionModes.get(id);
				return {
					id,
					name: info?.name ?? id,
					enabled,
					defaultModelId: info?.defaultModelId,
					...(permissionMode ? { permissionMode } : {}),
				};
			}),
		)
	).filter((provider) => provider.enabled);
	ctx.send(peer, { type: "providers", providers });
	const selected =
		(defaults.provider &&
			providers.find((provider) => provider.id === defaults.provider)) ||
		providers[0];
	if (selected) {
		// Endpoint-owned model lists (LiteLLM etc.) reject when the host is
		// unreachable; report it without aborting the rest of peer setup.
		await loadModels(ctx, peer, selected.id).catch((error: unknown) => {
			ctx.send(peer, {
				type: "error",
				text: error instanceof Error ? error.message : String(error),
			});
		});
	}
}

export async function loadModels(
	ctx: HubContext,
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const provider = providerId.trim();
	if (!provider) return;
	const payload = await getLocalProviderModels(
		provider,
		providerSettingsManager.getProviderConfig(provider, {
			includeKnownModels: false,
		}),
	);
	const models: WebviewProviderModel[] = payload.models
		.filter((model) =>
			isChatCompatibleModel({
				operation: model.operation,
				modalities: {
					input: model.inputModalities,
					output: model.outputModalities,
				},
			}),
		)
		.map((model) => ({
			id: model.id,
			name: model.name,
			operation: model.operation,
			supportsReasoning: model.supportsReasoning,
			supportsThinking: model.supportsReasoning,
			inputModalities: model.inputModalities,
			outputModalities: model.outputModalities,
		}));
	ctx.send(peer, { type: "models", providerId: provider, models });
}

export async function sendProviderCatalog(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const payload = await listLocalProviders(providerSettingsManager, {
		isClinePassEnabled: true,
	});
	ctx.send(peer, {
		type: "provider_catalog",
		providers: payload.providers,
		settingsPath: payload.settingsPath,
	});
}

export async function saveProviderSettings(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: Extract<WebviewInboundMessage, { type: "saveProviderSettings" }>,
): Promise<void> {
	const result = await saveLocalProviderSettings(providerSettingsManager, {
		providerId: frame.providerId,
		enabled: frame.enabled,
		apiKey: frame.apiKey,
		baseUrl: frame.baseUrl,
	});
	ctx.send(peer, {
		type: "provider_settings_saved",
		providerId: result.providerId,
		enabled: result.enabled,
	});
	await sendProviderCatalog(ctx, peer);
	await loadProviders(ctx, peer);
}

export async function setProviderPermissionMode(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: Extract<WebviewInboundMessage, { type: "setProviderPermissionMode" }>,
): Promise<void> {
	const mode = (await listPermissionModes()).get(frame.providerId);
	if (!mode?.options.some((option) => option.value === frame.value)) {
		throw new Error(
			`Unsupported permission mode for ${frame.providerId}: ${frame.value}`,
		);
	}
	await saveLocalProviderSettings(providerSettingsManager, {
		...toPermissionSettingsPatch(mode.path, frame.value),
		providerId: frame.providerId,
	});
	await loadProviders(ctx, peer);
}

export async function runProviderOAuthLogin(
	ctx: HubContext,
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const normalized = normalizeOAuthProvider(providerId);
	const saved = await loginAndSaveLocalProviderOAuthCredentials(
		providerSettingsManager,
		normalized,
		openExternalUrl,
	);
	if (saved.provider !== normalized) {
		markLocalProviderEnabled(providerSettingsManager, normalized, {
			tokenSource: "oauth",
		});
	}
	ctx.send(peer, {
		type: "provider_oauth_login_done",
		providerId: normalized,
		accessTokenPresent:
			(saved.auth?.accessToken?.trim() ?? saved.apiKey?.trim() ?? "").length >
			0,
	});
	await sendProviderCatalog(ctx, peer);
	await loadProviders(ctx, peer);
}
