"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { useFileViewState } from "@/lib/file-view-state";

export function PdfViewer({
	path,
	environmentId,
	workspaceRoot,
}: {
	path: string;
	environmentId: string;
	workspaceRoot: string;
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const restored = useRef(false);
	const restoreTarget = useRef(1);
	const [position, setPosition] = useFileViewState(
		`pdfContinuousScroll:${path}`,
		{ offset: 0, left: 0 },
	);
	const [sizes, setSizes] = useState<
		Record<number, { width: number; height: number }>
	>({});
	const [visible, setVisible] = useState({ start: 1, end: 3 });
	const [document, setDocument] = useState<PDFDocumentProxy>();
	const [page, setPage] = useFileViewState(`pdfPage:${path}`, 1);
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		let loading:
			| ReturnType<typeof import("pdfjs-dist").getDocument>
			| undefined;
		setDocument(undefined);
		setError(undefined);
		restored.current = false;
		setSizes({});
		void (async () => {
			const result = await desktopClient.invoke<{ contentBase64: string }>(
				"read_project_pdf",
				{ environmentId, workspaceRoot, path },
			);
			if (cancelled) return;
			const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
			if (cancelled) return;
			const assets = `/pdfjs/${pdfjs.version}/`;
			pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
			const data = Uint8Array.from(atob(result.contentBase64), (char) =>
				char.charCodeAt(0),
			);
			loading = pdfjs.getDocument({
				data,
				cMapUrl: `${assets}cmaps/`,
				cMapPacked: true,
				standardFontDataUrl: `${assets}standard_fonts/`,
				wasmUrl: `${assets}wasm/`,
				iccUrl: `${assets}iccs/`,
				enableXfa: false,
				isOffscreenCanvasSupported: false,
				isImageDecoderSupported: false,
			});
			// Never mount PDF scripting, forms, HTML or annotation links.
			loading.onPassword = () => {
				if (!cancelled) setError("Password-protected PDFs cannot be previewed");
				void loading?.destroy();
			};
			const pdf = await loading.promise;
			const first = await pdf.getPage(1);
			const size = first.getViewport({ scale: 1.4 });
			first.cleanup();
			if (!cancelled) {
				setPage((current) => Math.max(1, Math.min(current, pdf.numPages)));
				setSizes({ 1: { width: size.width, height: size.height } });
				setDocument(pdf);
			}
		})().catch((reason) => {
			if (!cancelled)
				setError(
					reason instanceof Error ? reason.message : "Unable to load PDF",
				);
		});
		return () => {
			cancelled = true;
			void loading?.destroy();
		};
	}, [environmentId, workspaceRoot, path, setPage]);

	const fallback = sizes[1] ?? { width: 840, height: 1120 };
	const offsets = [0];
	for (let number = 1; number <= (document?.numPages ?? 0); number++) {
		offsets[number] =
			offsets[number - 1] + (sizes[number]?.height ?? fallback.height) + 16;
	}
	const updateVisible = () => {
		const node = scroller.current;
		if (!node || !document) return;
		let first = 1;
		while (first < document.numPages && offsets[first] <= node.scrollTop)
			first++;
		setVisible({
			start: Math.max(1, first - 1),
			end: Math.min(document.numPages, first + 2),
		});
		if (restored.current) {
			restoreTarget.current = first;
			setPage(first);
			setPosition({
				offset: node.scrollTop - offsets[first - 1],
				left: node.scrollLeft,
			});
		}
	};
	// Restore by page and within-page offset, so different page sizes do not require rasterizing earlier pages.
	useLayoutEffect(() => {
		if (!document || restored.current || !scroller.current) return;
		const number = Math.max(1, Math.min(page, document.numPages));
		restoreTarget.current = number;
		scroller.current.scrollTop =
			offsets[number - 1] + Math.max(0, position.offset);
		scroller.current.scrollLeft = position.left;
		restored.current = true;
		updateVisible();
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: only adjust scroll after page dimensions change, not after user scroll.
	useLayoutEffect(() => {
		const node = scroller.current;
		if (!node || !document || !restored.current) return;
		// Keep the saved page anchored while nearby placeholders acquire actual sizes.
		const number = Math.max(
			1,
			Math.min(restoreTarget.current, document.numPages),
		);
		node.scrollTop = offsets[number - 1] + Math.max(0, position.offset);
	}, [sizes]);

	if (error)
		return (
			<div role="alert" className="p-4 text-sm text-destructive">
				{error}
			</div>
		);
	return (
		<section className="flex h-full min-h-0 flex-col" aria-label="PDF preview">
			<div className="shrink-0 border-b p-2 text-xs text-muted-foreground">
				{document ? (
					`${document.numPages} pages`
				) : (
					<output>Loading PDF…</output>
				)}
			</div>
			<section
				ref={scroller}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: allow keyboard scrolling of the PDF viewport.
				tabIndex={0}
				aria-label="PDF document pages"
				className="min-h-0 flex-1 overflow-auto bg-muted p-3"
				onScroll={updateVisible}
			>
				{document &&
					Array.from({ length: document.numPages }, (_, index) => {
						const number = index + 1;
						const size = sizes[number] ?? fallback;
						return (
							<section
								key={number}
								aria-label={`PDF page ${number}`}
								className="mx-auto mb-4 bg-white"
								style={{ width: size.width, height: size.height }}
							>
								{number >= visible.start && number <= visible.end && (
									<PdfPage
										document={document}
										number={number}
										onSize={(next) =>
											setSizes((current) => {
												if (
													current[number]?.width === next.width &&
													current[number]?.height === next.height
												)
													return current;
												return { ...current, [number]: next };
											})
										}
									/>
								)}
							</section>
						);
					})}
			</section>
		</section>
	);
}

function PdfPage({
	document,
	number,
	onSize,
}: {
	document: PDFDocumentProxy;
	number: number;
	onSize: (size: { width: number; height: number }) => void;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const sizeCallback = useRef(onSize);
	sizeCallback.current = onSize;
	const [state, setState] = useState("Rendering page…");
	useEffect(() => {
		let cancelled = false;
		let task: RenderTask | undefined;
		let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | undefined;
		const target = canvas.current;
		void (async () => {
			page = await document.getPage(number);
			if (cancelled || !target) return;
			const viewport = page.getViewport({ scale: 1.4 });
			sizeCallback.current({ width: viewport.width, height: viewport.height });
			const scale = Math.min(
				1,
				4096 / viewport.width,
				4096 / viewport.height,
				Math.sqrt(4_000_000 / (viewport.width * viewport.height)),
			);
			const bounded = page.getViewport({ scale: 1.4 * scale });
			target.width = Math.ceil(bounded.width);
			target.height = Math.ceil(bounded.height);
			task = page.render({ canvas: target, viewport: bounded });
			await task.promise;
			if (!cancelled) setState("");
		})()
			.catch((reason) => {
				if (!cancelled)
					setState(
						reason instanceof Error ? reason.message : "Unable to render page",
					);
			})
			.finally(() => page?.cleanup());
		return () => {
			cancelled = true;
			task?.cancel();
			void (task?.promise ?? Promise.resolve())
				.catch(() => {})
				.finally(() => {
					page?.cleanup();
					if (target) {
						target.width = 0;
						target.height = 0;
					}
				});
		};
	}, [document, number]);
	return (
		<div className="relative h-full w-full">
			{state && <output className="absolute p-3 text-xs">{state}</output>}
			<canvas
				ref={canvas}
				aria-label={`Rendered PDF page ${number}`}
				style={{
					width: "100%",
					height: "100%",
					visibility: state ? "hidden" : "visible",
				}}
			/>
		</div>
	);
}
