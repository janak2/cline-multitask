// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { uiPerformance } from "@/lib/ui-performance";
import { UiPerformanceControls } from "./ui-performance-controls";

it("starts from Debug, keeps stop/export available outside settings, and exports a report", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("PerformanceObserver", undefined);
	vi.useFakeTimers();
	const originalCreateUrl = Object.getOwnPropertyDescriptor(
		URL,
		"createObjectURL",
	);
	const originalRevokeUrl = Object.getOwnPropertyDescriptor(
		URL,
		"revokeObjectURL",
	);
	const createUrl = vi.fn(() => "blob:performance-report");
	Object.defineProperty(URL, "createObjectURL", {
		configurable: true,
		value: createUrl,
	});
	const revokeUrl = vi.fn();
	Object.defineProperty(URL, "revokeObjectURL", {
		configurable: true,
		value: revokeUrl,
	});
	const click = vi
		.spyOn(HTMLAnchorElement.prototype, "click")
		.mockImplementation(() => {});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () =>
			root.render(
				<>
					<UiPerformanceControls />
					<UiPerformanceControls floating />
				</>,
			),
		);
		expect(container.querySelectorAll("section")).toHaveLength(1);
		const start = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Start recording",
		);
		await act(async () => start?.click());
		expect(uiPerformance.recording).toBe(true);
		expect(container.querySelectorAll("section")).toHaveLength(2);
		await act(async () => root.render(<UiPerformanceControls floating />));
		const exportButton = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Stop and export",
		);
		await act(async () => exportButton?.click());
		expect(uiPerformance.recording).toBe(false);
		expect(container.querySelector("section")).toBeNull();
		expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
		expect(click).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(1000);
		expect(revokeUrl).toHaveBeenCalledWith("blob:performance-report");
	} finally {
		await act(async () => root.unmount());
		uiPerformance.stop();
		container.remove();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		if (originalCreateUrl)
			Object.defineProperty(URL, "createObjectURL", originalCreateUrl);
		else Reflect.deleteProperty(URL, "createObjectURL");
		if (originalRevokeUrl)
			Object.defineProperty(URL, "revokeObjectURL", originalRevokeUrl);
		else Reflect.deleteProperty(URL, "revokeObjectURL");
	}
});
