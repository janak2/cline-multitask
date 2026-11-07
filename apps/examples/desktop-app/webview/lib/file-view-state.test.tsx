// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	FileViewScrollArea,
	FileViewStateProvider,
	fileViewStorageKey,
	useFileViewState,
} from "./file-view-state";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

let oldToggle: (() => void) | undefined;
function Pane() {
	const [panel, setPanel] = useFileViewState<"files" | null>("panel", null);
	oldToggle = () => setPanel((value) => (value === "files" ? null : "files"));
	return (
		<button type="button" onClick={oldToggle}>
			{panel ?? "closed"}
		</button>
	);
}
async function show(
	session: string,
	workspace = "/repo",
	environment = "local",
	cwd = workspace,
) {
	await act(async () =>
		root.render(
			<FileViewStateProvider
				value={fileViewStorageKey(environment, session, workspace, cwd)}
			>
				<Pane />
			</FileViewStateProvider>,
		),
	);
}
it("restores open and intentionally closed panels without leaking across sessions, roots, cwd or environments", async () => {
	await show("A");
	await act(async () => container.querySelector("button")?.click());
	await show("B");
	expect(container.textContent).toBe("closed");
	await show("A");
	expect(container.textContent).toBe("files");
	await show("A", "/other");
	expect(container.textContent).toBe("closed");
	await show("A", "/repo", "remote");
	expect(container.textContent).toBe("closed");
	await show("A", "/repo", "local", "/repo/sub");
	expect(container.textContent).toBe("closed");
	await show("A");
	await act(async () => container.querySelector("button")?.click());
	await show("B");
	await show("A");
	expect(container.textContent).toBe("closed");
});

it("ignores an old session's asynchronous setter after switching and tolerates corrupt storage", async () => {
	await show("A");
	const stale = oldToggle;
	await show("B");
	await act(async () => stale?.());
	expect(container.textContent).toBe("closed");
	window.localStorage.setItem(
		fileViewStorageKey("local", "A", "/repo", "/repo")!,
		"broken",
	);
	await show("A");
	expect(container.textContent).toBe("closed");
});

it("restores scroll after delayed content but stops restoring after user interaction", async () => {
	const key = fileViewStorageKey("local", "A", "/repo", "/repo")!;
	window.localStorage.setItem(
		key,
		JSON.stringify({ scroll: { top: 123, left: 45 } }),
	);
	const render = (ready: boolean) => (
		<FileViewStateProvider value={key}>
			<FileViewScrollArea stateId="scroll" ready={ready}>
				content
			</FileViewScrollArea>
		</FileViewStateProvider>
	);
	await act(async () => root.render(render(false)));
	const area = container.firstElementChild as HTMLElement;
	expect(area.scrollTop).toBe(0);
	await act(async () => root.render(render(true)));
	expect(area.scrollTop).toBe(123);
	expect(area.scrollLeft).toBe(45);
	await act(async () => {
		area.dispatchEvent(new Event("wheel", { bubbles: true }));
		area.scrollTop = 80;
		area.dispatchEvent(new Event("scroll"));
		area.append(document.createElement("span"));
	});
	expect(area.scrollTop).toBe(80);
	expect(JSON.parse(window.localStorage.getItem(key)!).scroll.top).toBe(80);
});
