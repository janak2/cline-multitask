"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { uiPerformance } from "@/lib/ui-performance";

function useRecording() {
	return useSyncExternalStore(
		uiPerformance.subscribe,
		() => uiPerformance.recording,
		() => false,
	);
}

function exportReport() {
	uiPerformance.stop();
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(uiPerformance.report(), null, 2)], {
			type: "application/json",
		}),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = "cline-ui-performance.json";
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function UiPerformanceControls({
	floating = false,
}: {
	floating?: boolean;
}) {
	const recording = useRecording();
	const hasReport = useSyncExternalStore(
		uiPerformance.subscribe,
		() => uiPerformance.hasReport,
		() => false,
	);
	if (floating && !recording) return null;
	return (
		<section
			aria-label="UI performance recording"
			className={
				floating
					? "fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-background p-3 shadow-lg"
					: "flex flex-col gap-3 py-4"
			}
		>
			{!floating && (
				<>
					<h3 className="font-semibold">UI performance</h3>
					<p className="text-sm text-muted-foreground">
						Record typing, scrolling a long chat, switching sessions, and
						resizing the right panel. Repeat while idle and while the agent is
						streaming. Stops after two minutes. No message text, file paths, or
						keystrokes are saved.
					</p>
					<p className="text-sm text-muted-foreground">
						The report includes React render time, frame pauses, and
						browser-supported task timings. For separate JavaScript, layout, and
						paint costs, also record the same actions in the webview inspector’s
						Timelines tab (or your browser’s Performance tab). Missing
						measurements are marked unavailable.
					</p>
					{process.env.NEXT_PUBLIC_CLINE_UI_PROFILING !== "1" &&
						process.env.NODE_ENV === "production" && (
							<p className="text-sm text-muted-foreground">
								React timing is disabled in this build. Build with
								CLINE_UI_PROFILING=1 to include it.
							</p>
						)}
				</>
			)}
			{recording ? (
				<>
					<output className="text-sm">Recording UI performance</output>
					<Button variant="outline" onClick={() => uiPerformance.stop()}>
						Stop
					</Button>
					<Button onClick={exportReport}>Stop and export</Button>
				</>
			) : (
				<div className="flex gap-3">
					<Button variant="outline" onClick={() => uiPerformance.start()}>
						Start recording
					</Button>
					<Button
						variant="outline"
						disabled={!hasReport}
						onClick={exportReport}
					>
						Export recording
					</Button>
				</div>
			)}
		</section>
	);
}
