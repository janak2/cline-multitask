// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { TerminalPanelsState } from "@/lib/terminal-panel-state";
import { useTerminalChatHandoff } from "./use-terminal-chat-handoff";

const store = vi.hoisted(() => ({ moved: false, rename: vi.fn() }));
vi.mock("@/lib/terminal-sessions", () => ({
	renameTerminalChat: (...args: unknown[]) => {
		store.moved = true;
		store.rename(...args);
	},
}));

it("never exposes the saved terminal group before the original tabs have moved", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	store.moved = false;
	store.rename.mockClear();
	const observations: Array<{ key: string | null; moved: boolean }> = [];
	function Harness({ session }: { session: string | null }) {
		const [panels, setPanels] = useState<TerminalPanelsState>({
			openChats: ["thread:new"],
			height: 280,
		});
		const update = useCallback(
			(change: (current: TerminalPanelsState) => TerminalPanelsState) =>
				setPanels(change),
			[],
		);
		const key = useTerminalChatHandoff("thread:new", session, panels, update);
		observations.push({ key, moved: store.moved });
		return <span>{key}</span>;
	}
	const container = document.createElement("div");
	const root = createRoot(container);
	try {
		await act(async () => root.render(<Harness session={null} />));
		await act(async () => {
			root.render(<Harness session="saved" />);
			await vi.dynamicImportSettled();
		});
		expect(
			observations.some(({ key, moved }) => key === "saved" && !moved),
		).toBe(false);
		expect(container.textContent).toBe("saved");
		expect(store.rename).toHaveBeenCalledWith("thread:new", "saved");
	} finally {
		await act(async () => root.unmount());
		vi.unstubAllGlobals();
	}
});
