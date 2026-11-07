"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Components } from "streamdown";
import { MemoizedMarkdown, SafeMarkdownLink } from "@/components/ui/markdown";
import { desktopClient } from "@/lib/desktop-client";
import { useFileViewState } from "@/lib/file-view-state";
import { resolveMarkdownPath } from "@/lib/markdown-paths";
import { CodeFile } from "./highlighted-code";

function DocumentImage({
	source,
	alt,
	path,
	workspaceRoot,
	environmentId,
}: {
	source: string;
	alt: string;
	path: string;
	workspaceRoot: string;
	environmentId: string;
}) {
	const [state, setState] = useState<{ url?: string; error?: string }>({});
	useEffect(() => {
		let cancelled = false;
		let url: string | undefined;
		setState({});
		const target = resolveMarkdownPath(path, workspaceRoot, source);
		if (!target) {
			setState({
				error: "Image blocked: only relative workspace images are supported",
			});
			return;
		}
		void desktopClient
			.invoke<{ contentBase64: string; mimeType: string }>(
				"read_project_image",
				{ path: target, workspaceRoot, environmentId },
			)
			.then((result) => {
				if (cancelled) return;
				const bytes = Uint8Array.from(atob(result.contentBase64), (char) =>
					char.charCodeAt(0),
				);
				url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
				setState({ url });
			})
			.catch((reason) => {
				if (!cancelled)
					setState({
						error:
							reason instanceof Error ? reason.message : "Unable to load image",
					});
			});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [source, path, workspaceRoot, environmentId]);
	if (state.error)
		return (
			<span role="note">
				{state.error}
				{alt ? `: ${alt}` : ""}
			</span>
		);
	if (!state.url) return <output>Loading image…</output>;
	return (
		// biome-ignore lint/performance/noImgElement: workspace Blob URLs are loaded at runtime, without an image server.
		<img
			src={state.url}
			alt={alt}
			className="my-4 max-w-full rounded"
			onError={() => setState({ error: "Unable to decode image" })}
		/>
	);
}

export function MarkdownFileViewer({
	content,
	path,
	workspaceRoot,
	environmentId,
	truncated,
	onOpenFile,
}: {
	content: string;
	path: string;
	workspaceRoot: string;
	environmentId: string;
	truncated?: boolean;
	onOpenFile: (path: string) => void;
}) {
	const [mode, setMode] = useFileViewState<"preview" | "source">(
		`markdown:${path}:mode`,
		"preview",
	);
	const root = useRef<HTMLDivElement>(null);
	const [linkError, setLinkError] = useState<string>();
	const components = useMemo(() => {
		const openReference = (href: string) => {
			if (href.startsWith("#")) {
				try {
					Array.from(root.current?.querySelectorAll("[id]") ?? [])
						.find((element) => element.id === decodeURIComponent(href.slice(1)))
						?.scrollIntoView();
				} catch {
					/* Invalid fragments stay inert. */
				}
				return;
			}
			const resolved = resolveMarkdownPath(path, workspaceRoot, href);
			if (resolved) {
				setLinkError(undefined);
				onOpenFile(resolved);
			} else
				setLinkError(
					"Link blocked: target must be a relative file inside this workspace",
				);
		};
		return {
			img: (props: {
				src?: string | Blob;
				alt?: string;
				"data-document-reference"?: string;
			}) => (
				<DocumentImage
					source={
						props["data-document-reference"] ??
						(typeof props.src === "string" ? props.src : "")
					}
					alt={props.alt ?? ""}
					path={path}
					workspaceRoot={workspaceRoot}
					environmentId={environmentId}
				/>
			),
			a: (props: {
				href?: string;
				children?: React.ReactNode;
				"data-document-reference"?: string;
			}) => {
				const href = props["data-document-reference"] ?? props.href;
				const children = props.children;
				if (href && /^(https?:|mailto:|tel:|\/\/)/i.test(href))
					return <SafeMarkdownLink href={href}>{children}</SafeMarkdownLink>;
				return (
					<a
						href={href || "#"}
						onClick={(event) => {
							event.preventDefault();
							if (href) openReference(href);
						}}
						onAuxClick={(event) => {
							event.preventDefault();
							if (event.button === 1 && href) openReference(href);
						}}
					>
						{children}
					</a>
				);
			},
		} satisfies Pick<Components, "a" | "img">;
	}, [path, workspaceRoot, environmentId, onOpenFile]);
	useEffect(() => {
		if (mode !== "preview" || !content) return;
		const counts = new Map<string, number>();
		root.current?.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((heading) => {
			const slug = (heading.textContent ?? "")
				.toLowerCase()
				.replace(/[^\p{L}\p{N}_\s-]/gu, "")
				.trim()
				.replace(/\s+/g, "-");
			const count = counts.get(slug) ?? 0;
			counts.set(slug, count + 1);
			heading.id = count ? `${slug}-${count}` : slug;
		});
	}, [content, mode]);
	return (
		<div ref={root} className="min-h-0" data-testid="markdown-file-viewer">
			<div className="sticky top-0 z-10 flex gap-3 border-b bg-background p-2 text-sm">
				{(["preview", "source"] as const).map((value) => (
					<button
						key={value}
						type="button"
						aria-pressed={mode === value}
						onClick={() => setMode(value)}
					>
						{value === "preview" ? "Preview" : "Source"}
					</button>
				))}
			</div>
			{linkError && (
				<div role="alert" className="p-3 text-sm">
					{linkError}
				</div>
			)}
			{mode === "source" ? (
				<CodeFile path={path} contents={content} />
			) : truncated ? (
				<div role="note" className="p-4">
					Preview unavailable: file exceeds the 1 MB text limit. Source contains
					only the first 1 MB.
				</div>
			) : (
				<div className="mx-auto max-w-4xl p-6">
					<MemoizedMarkdown content={content} documentComponents={components} />
				</div>
			)}
		</div>
	);
}
