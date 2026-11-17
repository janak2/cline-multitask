// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/provider-schema";
import { ProviderPermissionMenu } from "./provider-permission-menu";

const mocks = vi.hoisted(() => ({
	load: vi.fn(),
	invoke: vi.fn(),
	invalidate: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: mocks.load,
	invalidateProviderCatalogCache: mocks.invalidate,
	subscribeToProviderCatalogInvalidation: () => () => {},
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		value,
		disabled,
		onValueChange,
	}: {
		children: React.ReactNode;
		value: string;
		disabled: boolean;
		onValueChange: (value: string) => void;
	}) => (
		<select
			aria-label="Permissions"
			value={value}
			disabled={disabled}
			onChange={(event) => onValueChange(event.target.value)}
		>
			{children}
		</select>
	),
	SelectTrigger: () => null,
	SelectValue: () => null,
	SelectContent: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
	SelectItem: ({
		children,
		value,
	}: {
		children: React.ReactNode;
		value: string;
	}) => <option value={value}>{children}</option>,
}));

let container: HTMLDivElement;
let root: Root;
const provider: Provider = {
	id: "catalog-provider",
	name: "Claude Code",
	color: "",
	letter: "C",
	enabled: true,
	models: 1,
	configFields: [
		{
			path: "claudeCode.permissionMode",
			label: "Claude Code permissions",
			type: "select",
			chatControl: "permission-mode",
			defaultValue: "bypassPermissions",
			description: "Bypass skips tool approval checks",
			options: [
				{ label: "Accept edits", value: "acceptEdits" },
				{
					label: "Bypass — skip tool approval checks",
					value: "bypassPermissions",
				},
			],
		},
	],
};
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.load.mockResolvedValue({
		providers: [provider, { ...provider, id: "other", configFields: [] }],
	});
	mocks.invoke.mockReset().mockResolvedValue({});
	mocks.invalidate.mockClear();
	mocks.toast.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(id = provider.id) {
	await act(async () =>
		root.render(<ProviderPermissionMenu providerId={id} />),
	);
}

it("restores a saved mode into session configuration without persisting again", async () => {
	const onChange = vi.fn();
	mocks.load.mockResolvedValue({
		providers: [
			{
				...provider,
				configValues: { "claudeCode.permissionMode": "dontAsk" },
				configFields: [
					{
						...provider.configFields?.[0],
						path: "claudeCode.permissionMode",
						label: "Permissions",
						type: "select",
						chatControl: "permission-mode",
						options: [{ label: "Don't ask", value: "dontAsk" }],
					},
				],
			},
		],
	});
	await act(async () =>
		root.render(
			<ProviderPermissionMenu providerId={provider.id} onChange={onChange} />,
		),
	);
	expect(onChange).toHaveBeenCalledWith({
		claudeCode: { permissionMode: "dontAsk" },
	});
	expect(mocks.invoke).not.toHaveBeenCalled();
});
it("uses catalog metadata, defaults to bypass and never saves automatically", async () => {
	await render();
	expect(container.querySelector("select")?.value).toBe("bypassPermissions");
	expect(mocks.invoke).not.toHaveBeenCalled();
	expect(container.textContent).toContain("skip tool approval checks");
});
it("hides the menu for unrelated providers and when switching away", async () => {
	await render();
	await render("other");
	expect(container.querySelector("select")).toBeNull();
	expect(mocks.invoke).not.toHaveBeenCalled();
});
it("persists explicit selection through the existing provider settings path and restores catalog values", async () => {
	await render();
	await act(async () => {
		const select = container.querySelector("select");
		if (!select) throw new Error("Missing menu");
		select.value = "bypassPermissions";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
		"save_provider_settings",
		{
			provider: provider.id,
			settings: { claudeCode: { permissionMode: "bypassPermissions" } },
		},
	);
	expect(container.querySelector("select")?.value).toBe("bypassPermissions");
	await render("other");
	mocks.load.mockResolvedValue({
		providers: [
			{
				...provider,
				configValues: { "claudeCode.permissionMode": "bypassPermissions" },
			},
		],
	});
	await render();
	expect(container.querySelector("select")?.value).toBe("bypassPermissions");
});
it("keeps the previous mode if persistence fails", async () => {
	mocks.load.mockResolvedValue({
		providers: [
			{
				...provider,
				configValues: { "claudeCode.permissionMode": "acceptEdits" },
			},
		],
	});
	mocks.invoke.mockRejectedValueOnce(new Error("save failed"));
	await render();
	await act(async () => {
		const select = container.querySelector("select");
		if (!select) throw new Error("Missing menu");
		select.value = "bypassPermissions";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(container.querySelector("select")?.value).toBe("acceptEdits");
	expect(mocks.toast).toHaveBeenCalled();
});
