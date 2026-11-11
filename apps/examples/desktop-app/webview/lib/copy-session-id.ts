import { toast } from "@/hooks/use-toast";

/** Copies a session's id and confirms it, so it can be pasted into tools or notes. */
export async function copySessionId(sessionId: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(sessionId);
		toast({ title: "Session ID copied", description: sessionId });
	} catch {
		toast({
			title: "Could not copy the session ID",
			description: sessionId,
			variant: "destructive",
		});
	}
}
