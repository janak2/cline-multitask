"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { FileViewScrollArea, useFileViewState } from "@/lib/file-view-state";

export function PdfViewer({
	path,
	environmentId,
	workspaceRoot,
}: {
	path: string;
	environmentId: string;
	workspaceRoot: string;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [document, setDocument] = useState<PDFDocumentProxy>();
	const [page, setPage] = useFileViewState(`pdfPage:${path}`, 1);
	const [error, setError] = useState<string>();
	const [rendering, setRendering] = useState(true);

	useEffect(() => {
		let cancelled = false;
		let loading:
			| ReturnType<typeof import("pdfjs-dist").getDocument>
			| undefined;
		setDocument(undefined);
		setError(undefined);
		setRendering(true);
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
			if (!cancelled) {
				setPage((current) => Math.max(1, Math.min(current, pdf.numPages)));
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

	useEffect(() => {
		if (!document) return;
		let cancelled = false;
		let task: RenderTask | undefined;
		setRendering(true);
		void (async () => {
			const pdfPage = await document.getPage(
				Math.max(1, Math.min(page, document.numPages)),
			);
			if (cancelled || !canvas.current) return;
			const viewport = pdfPage.getViewport({ scale: 1.4 });
			// Bound raster memory, even for unusually large PDF page dimensions.
			const scale = Math.min(
				1,
				4096 / viewport.width,
				4096 / viewport.height,
				Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
			);
			const bounded = pdfPage.getViewport({ scale: 1.4 * scale });
			canvas.current.width = Math.ceil(bounded.width);
			canvas.current.height = Math.ceil(bounded.height);
			task = pdfPage.render({ canvas: canvas.current, viewport: bounded });
			await task.promise;
			if (!cancelled) setRendering(false);
			pdfPage.cleanup();
		})().catch((reason) => {
			if (!cancelled)
				setError(
					reason instanceof Error ? reason.message : "Unable to render PDF",
				);
		});
		return () => {
			cancelled = true;
			task?.cancel();
		};
	}, [document, page]);

	if (error)
		return (
			<div role="alert" className="p-4 text-sm text-destructive">
				{error}
			</div>
		);
	return (
		<div className="flex h-full min-h-0 flex-col" aria-label="PDF preview">
			<div className="flex shrink-0 items-center gap-3 border-b p-2 text-sm">
				<button
					type="button"
					disabled={!document || page === 1 || rendering}
					onClick={() => setPage((value) => value - 1)}
				>
					Previous page
				</button>
				<span>{document ? `Page ${page} of ${document.numPages}` : "PDF"}</span>
				<button
					type="button"
					disabled={!document || page === document.numPages || rendering}
					onClick={() => setPage((value) => value + 1)}
				>
					Next page
				</button>
				{rendering && (
					<span role="status">
						{document ? "Rendering page…" : "Loading PDF…"}
					</span>
				)}
			</div>
			<FileViewScrollArea
				stateId={`pdfScroll:${path}:${page}`}
				ready={!rendering}
				className="min-h-0 flex-1 overflow-auto bg-muted p-3"
			>
				<canvas
					ref={canvas}
					aria-label={`PDF page ${page}`}
					className="mx-auto bg-white"
					style={{ visibility: rendering ? "hidden" : "visible" }}
				/>
			</FileViewScrollArea>
		</div>
	);
}
