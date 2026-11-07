// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PhoneAccessStatus } from "@/lib/phone-access";
import { PhoneAccessPanel } from "./phone-access-panel";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl,
}));

const URL = "http://my-laptop.example-tailnet.ts.net";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
	invoke.mockReset();
	openExternalUrl.mockReset();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(status: PhoneAccessStatus) {
	invoke.mockResolvedValue(status);
	await act(async () => root.unmount());
	root = createRoot(container);
	await act(async () => root.render(<PhoneAccessPanel />));
}

async function click(label: string) {
	const button = [...container.querySelectorAll("button")].find((button) =>
		button.textContent?.includes(label),
	);
	if (!button) throw new Error(`Missing button: ${label}`);
	await act(async () => button.click());
}

it("shows the QR code and copies the address while running", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true,
	});
	await render({ state: "running", url: URL, elsewhere: true });
	const qr = container.querySelector("img");
	expect(qr?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
	expect(decodeURIComponent(qr?.getAttribute("src") ?? "")).toContain("<svg");
	expect(container.textContent).toContain(URL);
	expect(container.textContent).toContain("Running from another Cline app");
	await click("Copy link");
	expect(writeText).toHaveBeenCalledWith(URL);
	expect(container.textContent).toContain("Copied");
});

it("names the missing setup step and checks again", async () => {
	const steps: Array<[PhoneAccessStatus, string]> = [
		[{ state: "setup-needed", missing: "install" }, "Install Tailscale"],
		[{ state: "setup-needed", missing: "sign-in" }, "sudo tailscale up"],
		[
			{ state: "setup-needed", missing: "turned-off" },
			"Tailscale is turned off",
		],
		[{ state: "setup-needed", missing: "magicdns" }, "Turn on MagicDNS"],
		[
			{ state: "setup-needed", missing: "operator" },
			"sudo tailscale set --operator=$USER",
		],
	];
	for (const [status, message] of steps) {
		await render(status);
		expect(container.textContent).toContain(message);
		expect(container.querySelector("img")).toBeNull();
	}
	await click("Check again");
	expect(invoke).toHaveBeenCalledWith("get_phone_access", { refresh: true });
});

it("shows the known address and QR even when opened while starting or stopped", async () => {
	for (const status of [
		{ state: "starting", url: URL },
		{ state: "error", url: URL, message: "The phone dashboard stopped." },
	] satisfies PhoneAccessStatus[]) {
		await render(status);
		expect(container.querySelector("img")?.getAttribute("src")).toMatch(
			/^data:image\/svg\+xml;utf8,/,
		);
		expect(container.textContent).toContain(URL);
		expect(container.textContent).toContain("Dashboard unavailable");
	}
	expect(container.textContent).toContain("The phone dashboard stopped.");
});

it("opens the admin console link", async () => {
	await render({ state: "setup-needed", missing: "magicdns" });
	await click("Open DNS settings");
	expect(openExternalUrl).toHaveBeenCalledWith(
		"https://login.tailscale.com/admin/dns",
	);
});

it("shows a blocked message", async () => {
	await render({ state: "blocked", message: "Port 443 is used" });
	expect(container.textContent).toContain("Port 443 is used");
});

it("switches phone access off", async () => {
	await render({ state: "running", url: URL, elsewhere: false });
	invoke.mockResolvedValue({ state: "off" });
	const toggle = container.querySelector('[aria-label="Phone access"]');
	if (!(toggle instanceof HTMLElement)) throw new Error("Missing switch");
	await act(async () => toggle.click());
	expect(invoke).toHaveBeenCalledWith("set_phone_access_enabled", {
		enabled: false,
	});
	expect(container.querySelector("img")).toBeNull();
});
