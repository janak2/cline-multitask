import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatInputBar } from "../../webview/components/views/chat/chat-input-bar";
import { WorkspaceProvider } from "../../webview/contexts/workspace-context";
import type { ChatSessionConfig } from "../../webview/lib/chat-schema";
import "../../webview/app/globals.css";

function ComposerFixture() {
	const [model, setModel] = useState("gpt-5.5-long");
	const [mode, setMode] = useState<"plan" | "act">("act");
	const [reasoning, setReasoning] = useState<
		Pick<ChatSessionConfig, "thinking" | "reasoningEffort">
	>({ thinking: true, reasoningEffort: "xhigh" });
	return (
		<WorkspaceProvider
			value={{
				workspaceRoot: "/fixture",
				workspaces: ["/fixture"],
				listWorkspaces: async () => ["/fixture"],
				refreshWorkspaces: async () => {},
				switchWorkspace: async () => true,
				pickWorkspaceDirectory: async () => null,
				selectChat: async () => true,
			}}
		>
			<main className="flex h-screen items-end gap-3 bg-background p-4 text-foreground">
				<section data-testid="chat-pane" style={{ width: 560 }}>
					<ChatInputBar
						attachments={[]}
						environmentId="local"
						gitBranch="feature/a-long-branch-name-for-the-files-open-layout"
						mode={mode}
						model={model}
						multitaskEnabled
						activeTeammateRuns={2}
						onAbort={() => {}}
						onAttachFiles={() => {}}
						onEditPromptInQueue={() => {}}
						onListGitBranches={async () => ({
							current: "main",
							branches: ["main"],
						})}
						onModeToggle={() =>
							setMode((value) => (value === "plan" ? "act" : "plan"))
						}
						onModelChange={setModel}
						onPromptInputChange={() => {}}
						onProviderChange={() => {}}
						onReasoningChange={setReasoning}
						onRemoveAttachment={() => {}}
						onRemovePromptInQueue={() => {}}
						onSend={() => {}}
						onSteerPromptInQueue={() => {}}
						onSwitchGitBranch={async () => true}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[]}
						provider="openai-codex"
						reasoningEffort={reasoning.reasoningEffort}
						status="idle"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking={reasoning.thinking}
					/>
				</section>
				<aside aria-label="Files" className="h-full w-70 shrink-0 border p-3">
					Files
				</aside>
			</main>
		</WorkspaceProvider>
	);
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing fixture root");
createRoot(container).render(<ComposerFixture />);
