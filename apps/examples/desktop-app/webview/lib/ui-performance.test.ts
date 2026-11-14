// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiPerformanceRecorder } from "./ui-performance";

let recorder: UiPerformanceRecorder;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let now: number;
let observers: Array<{
	callback: PerformanceObserverCallback;
	disconnect: ReturnType<typeof vi.fn>;
}>;

function frame(time: number) {
	now = time;
	const callbacks = [...frames.values()];
	frames.clear();
	for (const callback of callbacks) callback(time);
}

beforeEach(() => {
	vi.useFakeTimers();
	now = 100;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	frames = new Map();
	nextFrame = 0;
	observers = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	vi.stubGlobal("PointerEvent", MouseEvent);
	vi.stubGlobal(
		"PerformanceObserver",
		class {
			static supportedEntryTypes = [
				"longtask",
				"event",
				"long-animation-frame",
			];
			disconnect = vi.fn();
			constructor(callback: PerformanceObserverCallback) {
				observers.push({ callback, disconnect: this.disconnect });
			}
			observe() {}
			takeRecords() {
				return [];
			}
		},
	);
	recorder = new UiPerformanceRecorder();
});

afterEach(() => {
	recorder.stop();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("UI performance recorder", () => {
	it("is opt-in, resets captures, groups idle and streaming, and bounds memory", () => {
		recorder.record("test", now, 10);
		expect(recorder.report().samples).toEqual([]);
		recorder.start();
		recorder.record("test", now, 10);
		recorder.setContext(true, 800);
		recorder.record("test", now, 50);
		expect(recorder.report().summary).toEqual([
			{ group: "idle:test", count: 1, totalMs: 10, maxMs: 10, p95Ms: 10 },
			{ group: "streaming:test", count: 1, totalMs: 50, maxMs: 50, p95Ms: 50 },
		]);
		for (let i = 0; i < 20_005; i++) recorder.record("test", now, 1);
		expect(recorder.report().samples).toHaveLength(20_000);
		expect(recorder.report().droppedSamples).toBe(7);
		recorder.start();
		expect(recorder.report().samples).toEqual([]);
	});

	it("records typing, scroll, resize and session readiness without input contents or paths", () => {
		document.body.innerHTML =
			'<div data-ui-performance="composer"><textarea>secret prompt</textarea></div><div aria-label="Agent conversation"></div><div data-ui-performance="resize"></div>';
		recorder.start();
		document
			.querySelector("textarea")
			?.dispatchEvent(new Event("input", { bubbles: true }));
		document
			.querySelector('[aria-label="Agent conversation"]')
			?.dispatchEvent(new Event("scroll"));
		document
			.querySelector('[data-ui-performance="resize"]')
			?.dispatchEvent(
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			);
		recorder.beginSessionSwitch();
		frame(150);
		frame(210);
		document.dispatchEvent(new Event("pointerup"));
		recorder.finishSessionSwitch();
		frame(225);
		const names = recorder.report().samples.map((sample) => sample.name);
		expect(names).toContain("typing-to-frame-opportunity");
		expect(names).toContain("conversation-scroll-to-frame");
		expect(names).toContain("right-panel-resize");
		expect(names).toContain("resize-frame-gap");
		expect(names).toContain("session-switch-to-ready-frame");
		expect(JSON.stringify(recorder.report())).not.toContain("secret prompt");
	});

	it("retains numeric browser breakdowns but not script URLs or event targets", () => {
		recorder.start();
		const entry = {
			entryType: "long-animation-frame",
			startTime: 110,
			duration: 100,
			toJSON: () => ({
				renderStart: 140,
				styleAndLayoutStart: 160,
				scripts: [{ duration: 20, sourceURL: "/secret/path" }],
				target: "secret text",
			}),
		} as PerformanceEntry;
		observers[0].callback(
			{ getEntries: () => [entry] } as PerformanceObserverEntryList,
			{} as PerformanceObserver,
		);
		expect(recorder.report().samples[0].metrics).toEqual({
			renderStart: 140,
			styleAndLayoutStart: 160,
			scriptDurationMs: 20,
			styleAndLayoutToFrameEndMs: 50,
		});
		expect(JSON.stringify(recorder.report())).not.toContain("secret");
	});

	it("reports unsupported APIs honestly and stops observers, listeners and frame callbacks", () => {
		vi.stubGlobal("PerformanceObserver", undefined);
		recorder.start();
		expect(recorder.report().unavailable).toEqual([
			"longtask",
			"event",
			"long-animation-frame",
		]);
		expect(recorder.report().reactMeasured).toBe(false);
		recorder.stop();
		expect(frames.size).toBe(0);
		recorder.record("late", now, 1);
		expect(recorder.report().samples).toEqual([]);
	});

	it("automatically stops after two minutes and notifies controls", () => {
		const listener = vi.fn();
		const unsubscribe = recorder.subscribe(listener);
		recorder.start();
		now += 120_000;
		vi.advanceTimersByTime(120_000);
		expect(recorder.recording).toBe(false);
		expect(recorder.hasReport).toBe(true);
		expect(listener).toHaveBeenCalledTimes(2);
		expect(
			observers.every(
				(observer) => observer.disconnect.mock.calls.length === 1,
			),
		).toBe(true);
		unsubscribe();
	});

	it("does not mix an old session-switch callback into a restarted recording", () => {
		recorder.start();
		recorder.beginSessionSwitch();
		recorder.finishSessionSwitch();
		recorder.stop();
		recorder.start();
		frame(116);
		expect(recorder.report().samples).toEqual([]);
	});
});
