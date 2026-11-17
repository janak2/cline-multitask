import { describe, expect, it } from "vitest";
import { toPermissionMode, toPermissionSettingsPatch } from "./providers";

const permissionField = {
	chatControl: "permission-mode" as const,
	path: "claudeCode.permissionMode",
	label: "Permissions",
	type: "select" as const,
	description: "How Claude Code asks before using tools",
	defaultValue: "bypassPermissions",
	options: [
		{ label: "Accept edits", value: "acceptEdits" },
		{ label: "Bypass", value: "bypassPermissions" },
	],
};

describe("phone permission-mode menu", () => {
	it("exposes the provider's permission field with its saved value", () => {
		expect(
			toPermissionMode({
				configFields: [permissionField],
				configValues: { "claudeCode.permissionMode": "acceptEdits" },
			}),
		).toEqual({
			path: "claudeCode.permissionMode",
			label: "Permissions",
			description: "How Claude Code asks before using tools",
			options: permissionField.options,
			value: "acceptEdits",
		});
	});

	it("falls back to the default and ignores values outside the options", () => {
		expect(toPermissionMode({ configFields: [permissionField] })?.value).toBe(
			"bypassPermissions",
		);
		expect(
			toPermissionMode({
				configFields: [permissionField],
				configValues: { "claudeCode.permissionMode": "unknown" },
			}),
		).not.toHaveProperty("value");
	});

	it("shows no menu for providers without a permission field", () => {
		expect(toPermissionMode({ configFields: [] })).toBeUndefined();
		expect(
			toPermissionMode({
				configFields: [{ ...permissionField, chatControl: undefined }],
			}),
		).toBeUndefined();
	});

	it("builds the nested settings patch the desktop menu saves", () => {
		expect(
			toPermissionSettingsPatch("claudeCode.permissionMode", "acceptEdits"),
		).toEqual({ claudeCode: { permissionMode: "acceptEdits" } });
	});
});
