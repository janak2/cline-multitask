import { describe, expect, it } from "vitest";
import {
	buildGatewayProviderOptions,
	resolveConnectionProviderConfig,
} from "./handler-factory";
import { safeParseSettings, toProviderConfig } from "./provider-settings";

describe("Claude Code permission settings", () => {
	it.each([
		"default",
		"acceptEdits",
		"bypassPermissions",
		"plan",
		"dontAsk",
		"auto",
	])("round-trips and forwards %s", (permissionMode) => {
		const parsed = safeParseSettings(
			JSON.parse(
				JSON.stringify({
					provider: "claude-code",
					claudeCode: { permissionMode },
				}),
			),
		);
		if (!parsed.success) throw new Error("Settings rejected");
		const config = toProviderConfig(parsed.data);
		const connection = resolveConnectionProviderConfig({
			providerId: "claude-code",
			modelId: "sonnet",
			providerConfig: config,
		});
		expect(buildGatewayProviderOptions(connection)?.defaultSettings).toEqual({
			permissionMode,
		});
	});
	it("leaves the default to the SDK adapter and rejects unsupported modes", () => {
		expect(
			buildGatewayProviderOptions(toProviderConfig({ provider: "claude-code" }))
				?.defaultSettings,
		).toBeUndefined();
		expect(
			safeParseSettings({
				provider: "claude-code",
				claudeCode: { permissionMode: "delegate" },
			}).success,
		).toBe(false);
	});
	it("does not forward Claude Code settings to another provider", () => {
		expect(
			buildGatewayProviderOptions(
				toProviderConfig({
					provider: "anthropic",
					claudeCode: { permissionMode: "bypassPermissions" },
				}),
			)?.defaultSettings,
		).toBeUndefined();
	});
});
