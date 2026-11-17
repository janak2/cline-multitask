import {
	createClaudeCode,
	type PermissionMode,
} from "ai-sdk-provider-claude-code";
import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDER_COLLECTIONS_BY_ID } from "./builtins";

describe("installed Claude Code permission modes", () => {
	it("accepts every advertised menu mode in the installed SDK without spawning a session", () => {
		const fields =
			BUILTIN_PROVIDER_COLLECTIONS_BY_ID["claude-code"].provider.metadata
				?.configFields;
		expect(fields).toBeDefined();
		const supported = [
			"default",
			"acceptEdits",
			"bypassPermissions",
			"plan",
			"dontAsk",
			"auto",
		] satisfies PermissionMode[];
		for (const permissionMode of supported) {
			expect(() =>
				createClaudeCode({ defaultSettings: { permissionMode } })("sonnet"),
			).not.toThrow();
		}
		if (!Array.isArray(fields)) throw new Error("Missing permission fields");
		const field = fields.find(
			(entry) => entry.chatControl === "permission-mode",
		);
		expect(field?.defaultValue).toBe("acceptEdits");
		expect(field?.options?.map((option) => option.value).sort()).toEqual(
			[...supported].sort(),
		);
	});
});
