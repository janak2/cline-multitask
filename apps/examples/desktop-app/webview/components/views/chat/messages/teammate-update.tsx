"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function isTeammateUpdate(content: string): boolean {
	return content.startsWith("System-delivered teammate async run updates:\n");
}

export function TeammateUpdate({
	content,
	children,
}: {
	content: string;
	children: ReactNode;
}) {
	const updates = [
		...content.matchAll(
			/^- \S+ \(([^\n]+)\) -> (queued|running|completed|failed|cancelled|interrupted)\b/gm,
		),
	];
	const remaining = content.match(
		/(\d+) (?:other teammate run\(s\) are still|teammate run\(s\)) in progress\./,
	)?.[1];
	const summary = updates.length
		? updates.map((update) => `${update[1]}: ${update[2]}`).join(" · ")
		: "Teammate update";

	return (
		<Collapsible>
			<CollapsibleTrigger className="group flex max-w-full items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
				<ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
				<span className="min-w-0 truncate" title={summary}>
					{summary}
				</span>
				{remaining ? (
					<span className="shrink-0">· {remaining} still running</span>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-2">{children}</CollapsibleContent>
		</Collapsible>
	);
}
