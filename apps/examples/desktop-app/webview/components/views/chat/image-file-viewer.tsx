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
}: {
	path: string;
	workspaceRoot: string;
	environmentId: string;
}) {
	const identity = JSON.stringify([environmentId, workspaceRoot, path]);
	const [state, setState] = useState<{
		identity: string;
		url?: string;
		error?: string;
		loaded?: boolean;
	}>({ identity });
	useEffect(() => {
		let cancelled = false;
		let url: string | undefined;
		setState({ identity });
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
				url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
				setState({ identity, url });
			})
			.catch((error) => {
				if (!cancelled)
					setState({
						identity,
						error:
							error instanceof Error ? error.message : "Unable to load image",
					});
			});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [identity, path, workspaceRoot, environmentId]);
	const current = state.identity === identity ? state : { identity };
	if (current.error)
		return (
			<div role="alert" className="p-6 text-center">
				{current.error}
			</div>
		);
	return (
		<div
			data-testid="image-file-viewer"
			className="flex min-h-64 items-center justify-center p-4"
		>
			{!current.loaded && <output>Loading image…</output>}
			{current.url && (
				// biome-ignore lint/performance/noImgElement: authorized runtime Blob, never a network or HTML source.
				<img
					src={current.url}
					alt={path.split(/[\\/]/).pop() ?? "Image"}
					className="h-auto max-h-[70vh] max-w-full object-contain"
					style={{ display: current.loaded ? undefined : "none" }}
					onLoad={() =>
						setState((value) =>
							value.identity === identity ? { ...value, loaded: true } : value,
						)
					}
					onError={() =>
						setState((value) =>
							value.identity === identity
								? { identity, error: "Unable to decode image" }
								: value,
						)
					}
				/>
			)}
		</div>
	);
}
