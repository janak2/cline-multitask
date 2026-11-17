import { describe, expect, it, vi } from "vitest";
import { trackMobileViewport } from "./mobile-viewport";

describe("mobile keyboard viewport", () => {
	it("tracks keyboard resize, browser pan, and dismissal without scrolling chat", () => {
		const viewport = Object.assign(new EventTarget(), {
			height: 844,
			offsetTop: 0,
		});
		const properties = new Map<string, string>();
		const style = {
			setProperty: vi.fn((name: string, value: string) => {
				properties.set(name, value);
			}),
			removeProperty: vi.fn((name: string) => {
				properties.delete(name);
				return "";
			}),
		};
		const cleanup = trackMobileViewport(viewport, style);
		expect(properties.get("--hub-viewport-height")).toBe("844px");
		viewport.height = 420;
		viewport.dispatchEvent(new Event("resize"));
		expect(properties.get("--hub-viewport-height")).toBe("420px");
		viewport.offsetTop = 220;
		viewport.dispatchEvent(new Event("scroll"));
		expect(properties.get("--hub-viewport-top")).toBe("220px");
		viewport.height = 844;
		viewport.dispatchEvent(new Event("resize"));
		expect(properties.get("--hub-viewport-height")).toBe("844px");
		expect(properties.get("--hub-viewport-top")).toBe("220px");
		viewport.offsetTop = 0;
		viewport.dispatchEvent(new Event("scroll"));
		expect(properties.get("--hub-viewport-top")).toBe("0px");
		cleanup();
		expect(properties.size).toBe(0);
		style.setProperty.mockClear();
		viewport.dispatchEvent(new Event("resize"));
		viewport.dispatchEvent(new Event("scroll"));
		expect(style.setProperty).not.toHaveBeenCalled();
	});

	it("leaves CSS fallback untouched without VisualViewport support", () => {
		const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
		trackMobileViewport(null, style)();
		expect(style.setProperty).not.toHaveBeenCalled();
		expect(style.removeProperty).not.toHaveBeenCalled();
	});
});
