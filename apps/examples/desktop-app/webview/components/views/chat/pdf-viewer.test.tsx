// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PdfViewer } from "./pdf-viewer";
import {
	FileViewStateProvider,
	fileViewStorageKey,
} from "@/lib/file-view-state";

const mocks = vi.hoisted(() => {
	const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
	const cleanup = vi.fn();
	const getPage = vi.fn(async () => ({
		getViewport: ({ scale }: { scale: number }) => ({
			width: 600 * scale,
			height: 800 * scale,
		}),
		render,
		cleanup,
	}));
	const destroy = vi.fn(async () => {});
	return {
		invoke: vi.fn(),
		getDocument: vi.fn((_options: Record<string, unknown>) => ({
			promise: Promise.resolve({ numPages: 2, getPage }),
			destroy,
		})),
		getPage,
		render,
		destroy,
	};
});
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
	getDocument: mocks.getDocument,
	version: "test",
	GlobalWorkerOptions: {},
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.clearAllMocks();
	window.localStorage.clear();
	mocks.invoke.mockResolvedValue({ contentBase64: btoa("%PDF-1.7\n\0\xff") });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function mount() {
	await act(async () => {
		root.render(
			<PdfViewer
				path="/repo/report.pdf"
				workspaceRoot="/repo"
				environmentId="local"
			/>,
		);
	});
}
it("loads authorized bytes, renders pages with local assets and destroys the document", async () => {
	await mount();
	expect(mocks.invoke).toHaveBeenCalledWith("read_project_pdf", {
		path: "/repo/report.pdf",
		workspaceRoot: "/repo",
		environmentId: "local",
	});
	const options = mocks.getDocument.mock.calls[0]?.[0];
	expect(options).toMatchObject({
		data: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255]),
		enableXfa: false,
		wasmUrl: "/pdfjs/test/wasm/",
	});
	expect(container.textContent).toContain("Page 1 of 2");
	const next = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Next page",
	);
	await act(async () => next?.click());
	expect(mocks.getPage).toHaveBeenLastCalledWith(2);
	expect(container.textContent).toContain("Page 2 of 2");
	await act(async () => root.render(null));
	expect(mocks.destroy).toHaveBeenCalled();
});
it("restores each session's PDF page and clamps a saved page when the document shrinks", async () => {
	const show = async (session: string) => {
		await act(async () =>
			root.render(
				<FileViewStateProvider
					value={fileViewStorageKey("local", session, "/repo", "/repo")}
				>
					<PdfViewer
						key={session}
						path="/repo/report.pdf"
						workspaceRoot="/repo"
						environmentId="local"
					/>
				</FileViewStateProvider>,
			),
		);
	};
	await show("A");
	await act(async () =>
		Array.from(container.querySelectorAll("button"))
			.find((button) => button.textContent === "Next page")
			?.click(),
	);
	await show("B");
	expect(container.textContent).toContain("Page 1 of 2");
	await show("A");
	expect(container.textContent).toContain("Page 2 of 2");
	await show("B");
	const key = fileViewStorageKey("local", "A", "/repo", "/repo")!;
	window.localStorage.setItem(
		key,
		JSON.stringify({ "pdfPage:/repo/report.pdf": 999 }),
	);
	await show("A");
	expect(container.textContent).toContain("Page 2 of 2");
	expect(mocks.getPage).toHaveBeenLastCalledWith(2);
});

it("shows read errors without handing invalid content to PDF.js", async () => {
	mocks.invoke.mockRejectedValue(
		new Error("PDF preview is currently available only in local workspaces"),
	);
	await mount();
	expect(container.querySelector('[role="alert"]')?.textContent).toContain(
		"only in local workspaces",
	);
	expect(mocks.getDocument).not.toHaveBeenCalled();
});
