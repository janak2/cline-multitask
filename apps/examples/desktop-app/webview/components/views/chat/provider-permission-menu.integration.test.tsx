// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderPermissionMenu } from "./provider-permission-menu";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: mocks.load,
	subscribeToProviderCatalogInvalidation: () => () => {},
	invalidateProviderCatalogCache: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke: vi.fn() } }));

it("shows the real desktop trigger and opens all six modes when current catalog metadata arrives", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollIntoView = vi.fn();
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const permission = {
		path: "claudeCode.permissionMode",
		label: "Claude Code permissions",
		type: "select",
		chatControl: "permission-mode",
		defaultValue: "bypassPermissions",
		options: [
			"default",
			"acceptEdits",
			"bypassPermissions",
			"plan",
			"dontAsk",
			"auto",
		].map((value) => ({ value, label: value })),
	};
	mocks.load.mockResolvedValue({
		providers: [{ id: "claude-code", configFields: [] }],
	});
	try {
		await act(async () =>
			root.render(<ProviderPermissionMenu providerId="claude-code" />),
		);
		expect(container.querySelector('[role="combobox"]')).toBeNull();
		await act(async () =>
			root.render(<ProviderPermissionMenu providerId="other" />),
		);
		mocks.load.mockResolvedValue({
			providers: [{ id: "claude-code", configFields: [permission] }],
		});
		await act(async () =>
			root.render(<ProviderPermissionMenu providerId="claude-code" />),
		);
		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Claude Code permissions"]',
		);
		expect(trigger).not.toBeNull();
		expect(trigger?.textContent).toContain("bypassPermissions");
		await act(async () =>
			trigger?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
			),
		);
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(6);
	} finally {
		await act(async () => root.unmount());
		container.remove();
		vi.restoreAllMocks();
	}
});
