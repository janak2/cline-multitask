"use client";

import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";

export function isImageFile(path: string): boolean {
	return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif)$/i.test(path);
}

export function ImageFileViewer({
	path,
	workspaceRoot,
	environmentId,
	refreshVersion = 0,
}: {
	path: string;
	workspaceRoot: string;
	environmentId: string;
	refreshVersion?: number;
}) {
	const identity = JSON.stringify([environmentId, workspaceRoot, path]);
	const [state, setState] = useState<{
		identity: string;
		url?: string;
		error?: string;
		loaded?: boolean;
	}>({ identity });
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshVersion is the Files panel's explicit invalidation trigger.
	useEffect(() => {
		let cancelled = false;
		setState((value) => (value.identity === identity ? value : { identity }));
		void desktopClient
			.invoke<{ contentBase64: string; mimeType: string }>(
				"read_project_image",
				{ path, workspaceRoot, environmentId },
			)
			.then((result) => {
				if (cancelled) return;
				if (
					!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
						result.mimeType,
					)
				)
					throw new Error("Unsupported image format");
				const bytes = Uint8Array.from(atob(result.contentBase64), (char) =>
					char.charCodeAt(0),
				);
				const url = URL.createObjectURL(
					new Blob([bytes], { type: result.mimeType }),
				);
				setState((value) => ({
					identity,
					url,
					loaded: value.identity === identity && value.loaded,
				}));
			})
			.catch((error) => {
				if (!cancelled)
					setState((value) => ({
						...(value.identity === identity ? value : { identity }),
						error:
							error instanceof Error ? error.message : "Unable to load image",
					}));
			});
		return () => {
			cancelled = true;
		};
	}, [identity, path, workspaceRoot, environmentId, refreshVersion]);
	useEffect(() => {
		const url = state.url;
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	}, [state.url]);
	const current = state.identity === identity ? state : { identity };
	return (
		<div
			data-testid="image-file-viewer"
			className="flex min-h-64 flex-col items-center justify-center gap-2 p-4"
		>
			{current.error && (
				<div role="alert">{current.error} — retrying on the next refresh.</div>
			)}
			{!current.loaded && !current.error && <output>Loading image…</output>}
			{current.url && (
				// biome-ignore lint/performance/noImgElement: authorized runtime Blob, never a network or HTML source.
				<img
					src={current.url}
					alt={path.split(/[\\/]/).pop() ?? "Image"}
					className="h-auto max-h-[70vh] max-w-full object-contain"
					style={{ display: current.loaded ? undefined : "none" }}
					onLoad={() =>
						setState((value) =>
							value.identity === identity && value.url === current.url
								? { ...value, loaded: true }
								: value,
						)
					}
					onError={() =>
						setState((value) =>
							value.identity === identity && value.url === current.url
								? { identity, error: "Unable to decode image" }
								: value,
						)
					}
				/>
			)}
		</div>
	);
}
