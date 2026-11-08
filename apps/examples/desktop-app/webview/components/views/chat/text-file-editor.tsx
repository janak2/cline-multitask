"use client";

import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";
import { useFileViewState } from "@/lib/file-view-state";

export function TextFileEditor({
	path,
	content,
	environmentId,
	workspaceRoot,
	onSaved,
	children,
}: {
	path: string;
	content: string;
	environmentId: string;
	workspaceRoot: string;
	onSaved: () => void;
	children: ReactNode;
}) {
	const [draft, setDraft] = useFileViewState<{
		original: string;
		text: string;
	} | null>(`textEdit:${environmentId}:${path}`, null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pending = useRef(false);
	const save = async () => {
		if (!draft || pending.current) return;
		pending.current = true;
		setSaving(true);
		setError(null);
		try {
			const latest = await desktopClient.invoke<{
				content: string | null;
				truncated: boolean;
			}>("read_project_file", { environmentId, workspaceRoot, path });
			if (latest.truncated || latest.content !== draft.original) {
				throw new Error(
					"This file changed on disk. Copy your edits, then cancel and reopen the file before saving.",
				);
			}
			const text = draft.original.includes("\r\n")
				? draft.text.replace(/\r?\n/g, "\r\n")
				: draft.text;
			const bytes = new TextEncoder().encode(text);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			await desktopClient.invoke("write_project_file", {
				environmentId,
				workspaceRoot,
				path,
				contentBase64: btoa(binary),
				overwrite: true,
			});
			onSaved();
			setDraft(null);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			pending.current = false;
			setSaving(false);
		}
	};
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex items-center justify-end gap-2 border-b border-border/60 px-3 py-2">
				{draft ? (
					<>
						<span className="mr-auto text-xs text-muted-foreground">
							{draft.text !== draft.original ? "Unsaved changes" : "Editing"}
						</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={saving}
							onClick={() => {
								setDraft(null);
								setError(null);
							}}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							disabled={saving || draft.text === draft.original}
							onClick={() => void save()}
						>
							{saving ? "Saving…" : "Save"}
						</Button>
					</>
				) : (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setDraft({ original: content, text: content })}
					>
						Edit
					</Button>
				)}
			</div>
			{error && (
				<div role="alert" className="p-3 text-sm text-destructive">
					{error}
				</div>
			)}
			{draft ? (
				<Textarea
					aria-label="File contents"
					className="min-h-96 rounded-none border-0 font-mono text-sm"
					spellCheck={false}
					disabled={saving}
					value={draft.text}
					onChange={(event) => setDraft({ ...draft, text: event.target.value })}
					onKeyDown={(event) => {
						if (
							(event.ctrlKey || event.metaKey) &&
							event.key.toLowerCase() === "s"
						) {
							event.preventDefault();
							event.stopPropagation();
							void save();
						}
					}}
				/>
			) : (
				children
			)}
		</div>
	);
}
