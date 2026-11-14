// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	FileViewStateProvider,
	fileViewStorageKey,
} from "@/lib/file-view-state";
import { PdfViewer } from "./pdf-viewer";

const mocks = vi.hoisted(() => {
	const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
	const cleanup = vi.fn();
	const getPage = vi.fn(async () => ({
		getViewport: ({ scale }: { scale: number }) => ({
			width: 600 * scale,
			height: 800 * scale,
		}),
		render,
		getTextContent: vi.fn(async () => ({ items: [], styles: {} })),
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
	TextLayer: class {
		container: HTMLElement;
		constructor({ container }: { container: HTMLElement }) {
			this.container = container;
		}
		async render() {
			const span = document.createElement("span");
			span.textContent = "Selectable PDF text";
			this.container.append(span);
		}
		cancel() {}
	},
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
	expect(container.textContent).toContain("2 pages");
	expect(container.querySelectorAll("canvas")).toHaveLength(2);
	expect(container.querySelector(".pdf-text-layer span")?.textContent).toBe(
		"Selectable PDF text",
	);
	expect(container.querySelectorAll("button")).toHaveLength(0);
	expect(mocks.getPage).toHaveBeenCalledWith(2);

	await act(async () => root.render(null));
	expect(mocks.destroy).toHaveBeenCalled();
});
it("restores continuous page/offset separately for each session", async () => {
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
	const scroller = container.querySelector<HTMLDivElement>(
		'[aria-label="PDF document pages"]',
	)!;
	await act(async () => {
		scroller.scrollTop = 1200;
		scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
	});
	await show("B");
	expect(
		container.querySelector<HTMLDivElement>('[aria-label="PDF document pages"]')
			?.scrollTop,
	).toBe(0);
	await show("A");
	expect(
		container.querySelector<HTMLDivElement>('[aria-label="PDF document pages"]')
			?.scrollTop,
	).toBe(1200);
});

it("bounds canvas count while scrolling large documents and cancels released renders", async () => {
	const cancel = vi.fn();
	mocks.render.mockImplementation(() => ({
		promise: Promise.resolve(),
		cancel,
	}));
	mocks.getDocument.mockImplementationOnce(() => ({
		promise: Promise.resolve({ numPages: 100, getPage: mocks.getPage }),
		destroy: mocks.destroy,
	}));
	await mount();
	expect(container.querySelectorAll("canvas").length).toBeLessThanOrEqual(4);
	const old = container.querySelector("canvas")!;
	const scroller = container.querySelector<HTMLDivElement>(
		'[aria-label="PDF document pages"]',
	)!;
	await act(async () => {
		scroller.scrollTop = 20_000;
		scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
	});
	expect(container.querySelectorAll("canvas").length).toBeLessThanOrEqual(4);
	expect(cancel).toHaveBeenCalled();
	expect(old.width).toBe(0);
	expect(
		container.querySelector('[aria-label="Rendered PDF page 18"]'),
	).not.toBeNull();
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
