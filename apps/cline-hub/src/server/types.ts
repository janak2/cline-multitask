import type { SaveProviderSettingsActionRequest } from "@cline/core";
import type { ToolApprovalResult } from "@cline/shared";
import type {
	WebviewInboundMessage,
	WebviewOutboundMessage,
	WebviewReasonLevel,
} from "../webview-protocol";

export type BrowserFrame = WebviewInboundMessage | { type: "restart_hub" };

export type ProviderSettingsUpdate = Partial<
	Omit<SaveProviderSettingsActionRequest, "action" | "providerId">
>;

export interface BrowserConfig {
	inviteRequired: boolean;
	publicUrl: string;
}

export type TrackedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
	version?: string;
	pid?: number;
};

export type TrackedSession = {
	sessionId: string;
	status: string;
	title: string;
	workspaceRoot: string;
	cwd?: string;
	provider?: string;
	model?: string;
	source?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	parentSessionId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
	participantCount: number;
	/** Fields the desktop sidebar orders and filters by. */
	startedAt?: number;
	endedAt?: number;
	isSubagent?: boolean;
	pinned?: boolean;
	scheduled?: boolean;
};

export type SessionContext = {
	workspaceRoot: string;
	cwd: string;
	providerId: string;
	modelId: string;
};

export type BrowserPeer = {
	socket: Bun.ServerWebSocket<BrowserPeer>;
	displayName: string;
	selectedSessionId?: string;
	unsubscribeEvents?: () => void;
	sending: boolean;
};

export type PendingToolApproval = {
	sessionId: string;
	resolve: (result: ToolApprovalResult) => void;
	/** What was sent to the page, so it can be sent again after a reconnect. */
	request: Omit<
		Extract<WebviewOutboundMessage, { type: "approval_request" }>,
		"type" | "approvalId"
	>;
};

export type JsonRecord = Record<string, unknown>;

export type { WebviewReasonLevel };
