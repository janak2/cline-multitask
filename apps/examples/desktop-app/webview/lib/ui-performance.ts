"use client";

import type { ProfilerOnRenderCallback } from "react";

type Sample = {
	name: string;
	startMs: number;
	durationMs: number;
	mode: "idle" | "streaming";
	messageCount: number;
	metrics?: Record<string, number>;
};

const MAX_SAMPLES = 20_000;
const MAX_DURATION_MS = 120_000;

export class UiPerformanceRecorder {
	private samples: Sample[] = [];
	private dropped = 0;
	private started = 0;
	private ended = 0;
	private cleanup: (() => void) | null = null;
	private listeners = new Set<() => void>();
	private context = { mode: "idle" as Sample["mode"], messageCount: 0 };
	private capabilities: string[] = [];
	private sessionSwitch: number | null = null;
	private generation = 0;

	get recording() {
		return this.cleanup !== null;
	}
	get hasReport() {
		return this.ended > 0;
	}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private notify() {
		for (const listener of this.listeners) listener();
	}
	setContext(streaming: boolean, messageCount: number) {
		this.context = { mode: streaming ? "streaming" : "idle", messageCount };
	}
	beginSessionSwitch() {
		if (this.recording) this.sessionSwitch = performance.now();
	}
	finishSessionSwitch() {
		if (this.sessionSwitch === null) return;
		const start = this.sessionSwitch;
		this.sessionSwitch = null;
		const generation = this.generation;
		requestAnimationFrame(
			() =>
				generation === this.generation &&
				this.record(
					"session-switch-to-ready-frame",
					start,
					performance.now() - start,
				),
		);
	}
	record(
		name: string,
		start: number,
		duration: number,
		metrics?: Record<string, number>,
	) {
		if (
			!this.recording ||
			start < this.started ||
			!Number.isFinite(duration) ||
			duration < 0
		)
			return;
		if (this.samples.length >= MAX_SAMPLES) {
			this.dropped++;
			return;
		}
		this.samples.push({
			name,
			startMs: start - this.started,
			durationMs: duration,
			...this.context,
			metrics,
		});
	}
	start() {
		this.stop();
		this.samples = [];
		this.dropped = 0;
		this.ended = 0;
		this.started = performance.now();
		this.generation++;
		this.sessionSwitch = null;
		this.capabilities = [];
		const disposers: (() => void)[] = [];
		const frames = new Set<number>();
		const afterFrame = (callback: () => void) => {
			const id = requestAnimationFrame(() => {
				frames.delete(id);
				callback();
			});
			frames.add(id);
		};
		this.cleanup = () => {
			for (const dispose of disposers) dispose();
			for (const id of frames) cancelAnimationFrame(id);
		};
		const listen = (name: string, handler: (event: Event) => void) => {
			document.addEventListener(name, handler, {
				capture: true,
				passive: true,
			});
			disposers.push(() => document.removeEventListener(name, handler, true));
		};
		let inputPending = false;
		listen("input", (event) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest('[data-ui-performance="composer"]') ||
				inputPending
			)
				return;
			inputPending = true;
			const start = performance.now();
			afterFrame(() =>
				afterFrame(() => {
					inputPending = false;
					this.record(
						"typing-to-frame-opportunity",
						start,
						performance.now() - start,
					);
				}),
			);
		});
		let scrollPending = false;
		listen("scroll", (event) => {
			if (
				!(event.target instanceof Element) ||
				!event.target.closest('[aria-label="Agent conversation"]') ||
				scrollPending
			)
				return;
			scrollPending = true;
			const start = performance.now();
			afterFrame(() => {
				scrollPending = false;
				this.record(
					"conversation-scroll-to-frame",
					start,
					performance.now() - start,
				);
			});
		});
		let resizing: number | null = null;
		listen("pointerdown", (event) => {
			if (
				event instanceof PointerEvent &&
				event.button === 0 &&
				event.target instanceof Element &&
				event.target.closest('[data-ui-performance="resize"]')
			)
				resizing = performance.now();
		});
		const endResize = () => {
			if (resizing === null) return;
			this.record("right-panel-resize", resizing, performance.now() - resizing);
			resizing = null;
		};
		listen("pointerup", endResize);
		listen("pointercancel", endResize);
		let previousFrame: number | null = null;
		const tick = (now: number) => {
			if (document.visibilityState !== "visible") previousFrame = null;
			else {
				if (previousFrame !== null && now - previousFrame > 34)
					this.record(
						resizing === null ? "frame-gap" : "resize-frame-gap",
						previousFrame,
						now - previousFrame,
					);
				previousFrame = now;
			}
			afterFrame(() => tick(performance.now()));
		};
		afterFrame(() => tick(performance.now()));
		if (typeof PerformanceObserver !== "undefined") {
			for (const type of ["longtask", "event", "long-animation-frame"]) {
				if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
				try {
					const observer = new PerformanceObserver((list) => {
						for (const entry of list.getEntries()) this.recordEntry(entry);
					});
					observer.observe({
						type,
						...(type === "event" ? { durationThreshold: 16 } : {}),
					});
					this.capabilities.push(type);
					disposers.push(() => {
						for (const entry of observer.takeRecords()) this.recordEntry(entry);
						observer.disconnect();
					});
				} catch {
					/* Unsupported observer options leave this metric unavailable. */
				}
			}
		}
		const timeout = window.setTimeout(() => this.stop(), MAX_DURATION_MS);
		disposers.push(() => window.clearTimeout(timeout));
		this.notify();
	}
	private recordEntry(entry: PerformanceEntry) {
		const value = entry.toJSON() as Record<string, unknown>;
		const metrics: Record<string, number> = {};
		for (const field of [
			"processingStart",
			"processingEnd",
			"renderStart",
			"styleAndLayoutStart",
			"blockingDuration",
			"styleDuration",
			"layoutDuration",
		]) {
			if (typeof value[field] === "number") metrics[field] = value[field];
		}
		if (Array.isArray(value.scripts)) {
			metrics.scriptDurationMs = value.scripts.reduce(
				(sum, script) =>
					sum + (typeof script.duration === "number" ? script.duration : 0),
				0,
			);
		}
		if (
			typeof metrics.processingStart === "number" &&
			typeof metrics.processingEnd === "number"
		) {
			metrics.inputDelayMs = Math.max(
				0,
				metrics.processingStart - entry.startTime,
			);
			metrics.eventProcessingMs = Math.max(
				0,
				metrics.processingEnd - metrics.processingStart,
			);
		}
		if (metrics.styleAndLayoutStart > 0)
			metrics.styleAndLayoutToFrameEndMs = Math.max(
				0,
				entry.startTime + entry.duration - metrics.styleAndLayoutStart,
			);
		this.record(entry.entryType, entry.startTime, entry.duration, metrics);
	}
	stop() {
		if (!this.cleanup) return;
		this.cleanup();
		this.cleanup = null;
		this.generation++;
		this.ended = performance.now();
		this.notify();
	}
	report() {
		const groups = new Map<string, number[]>();
		for (const sample of this.samples) {
			const key = `${sample.mode}:${sample.name}`;
			const values = groups.get(key) ?? [];
			values.push(sample.durationMs);
			groups.set(key, values);
		}
		return {
			schemaVersion: 1,
			durationMs: (this.ended || performance.now()) - this.started,
			droppedSamples: this.dropped,
			capabilities: this.capabilities,
			unavailable: ["longtask", "event", "long-animation-frame"].filter(
				(type) => !this.capabilities.includes(type),
			),
			build: {
				reactProfilingEnabled:
					process.env.NEXT_PUBLIC_CLINE_UI_PROFILING === "1",
				development: process.env.NODE_ENV !== "production",
			},
			reactMeasured: this.samples.some((sample) =>
				sample.name.startsWith("react:"),
			),
			coverage: ["idle", "streaming"].flatMap((mode) =>
				[
					"typing-to-frame-opportunity",
					"conversation-scroll-to-frame",
					"session-switch-to-ready-frame",
					"right-panel-resize",
				].map((action) => ({
					mode,
					action,
					samples: groups.get(`${mode}:${action}`)?.length ?? 0,
				})),
			),
			limitations: [
				"React render time overlaps JavaScript time; never add the categories together.",
				"Long tasks are main-thread tasks, not JavaScript-only CPU time. Event entries cover slow events across the page.",
				"Frame gaps indicate missed frame opportunities, not exact paint times. Scroll samples include programmatic scrolling.",
				"Style/layout-to-frame-end is a combined tail, not isolated layout or paint. Exact JavaScript, layout and paint costs require a browser Performance/Timelines recording.",
				"Missing entry types are unavailable, not zero. Observer entries use the context at delivery. Profiling introduces overhead.",
			],
			summary: [...groups].map(([group, values]) => {
				values.sort((a, b) => a - b);
				return {
					group,
					count: values.length,
					totalMs: values.reduce((a, b) => a + b, 0),
					maxMs: values[values.length - 1],
					p95Ms: values[Math.ceil(values.length * 0.95) - 1],
				};
			}),
			samples: this.samples.slice(),
		};
	}
}

export const uiPerformance = new UiPerformanceRecorder();
export const recordReactRender: ProfilerOnRenderCallback = (
	id,
	_phase,
	duration,
	baseDuration,
	startTime,
	commitTime,
) => {
	uiPerformance.record(`react:${id}`, startTime, duration, {
		baseDurationMs: baseDuration,
		commitTime,
	});
};
