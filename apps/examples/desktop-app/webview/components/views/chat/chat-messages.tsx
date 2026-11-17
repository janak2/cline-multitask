"use client";

import { AgentAskQuestion } from "@cline/ui";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
} from "@cline/ui/components/message-scroller";
import { Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { ChatCache } from "@/lib/chat-cache";
import type {
	ChatMessage,
	ChatMessageImage,
	ChatSessionStatus,
} from "@/lib/chat-schema";
import { formatRunError } from "@/lib/run-error";
import type { SessionChangeSet } from "@/lib/session-changes";
import { sessionKey } from "@/lib/session-identity";
import type { SessionImportTool } from "@/lib/session-import";
import { cn } from "@/lib/utils";
import {
	ChatScrollProvider,
	ChatScrollViewport,
	chatScrollPositions,
} from "./chat-scroll";
import { ChatSelectionToChat } from "./chat-selection-to-chat";
import { ImportedSessionNotice } from "./imported-session-notice";
import { STREAMING_TITLE_CLASS } from "./messages/constants";
import {
	buildPreviousTimestampMap,
	buildUserRunCountMap,
	type ChatRenderItem,
	createChatRenderItemsCache,
	getThoughtDurationMilliseconds,
	isSystemSteeringMessage,
} from "./messages/group-messages";
import { ChatImageLightbox } from "./messages/image-lightbox";
import { MessageBubble } from "./messages/message-bubble";
import {
	ToolApprovalPanel,
	type ToolApprovalRequestItem,
} from "./messages/tool-approval-panel";
import { ToolMessageBlock } from "./messages/tool-message-block";
import { buildToolPresentation } from "./messages/tool-summaries";
import { TurnReceipt } from "./messages/turn-receipt";
import { WorkBlock } from "./messages/work-block";
import { TranscriptOutline } from "./transcript-outline";

const renderCaches = new ChatCache<
	ReturnType<typeof createChatRenderItemsCache>
>();

/** Rows rendered at once, and how many more each "Load older" reveals. */
const TRANSCRIPT_WINDOW_ROWS = 30;

type TranscriptWindowPin = {
	/** The pin holds only within the turn it was made in. */
	lastUserRowKey: string | null;
	firstRowKey: string;
};

const transcriptWindowPins = new ChatCache<TranscriptWindowPin>();

function renderItemKey(item: ChatRenderItem): string {
	if (item.type === "message") return item.message.id;
	if (item.type === "tools") return `tools_${item.messages[0]?.id ?? "empty"}`;
	return `work_${item.id}`;
}

type ChatMessagesProps = {
	onAddToChat?: (text: string) => void;
	environmentId?: string;
	hasOlderMessages?: boolean;
	isLoadingOlderMessages?: boolean;
	onLoadOlderMessages?: () => void | Promise<void>;
	sessionId: string | null;
	status: ChatSessionStatus;
	chatTransportState?:
		| "connecting"
		| "reconnecting"
		| "connected"
		| "unavailable";
	isSessionSwitching?: boolean;
	messages: ChatMessage[];
	error: string | null;
	/** Set when the session's history was imported from another coding agent. */
	importedFromTool?: SessionImportTool;
	/** Replaces "Thinking..." while the runtime reports a named pre-output step. */
	activityLabel?: string | null;
	streamingMessageId?: string | null;
	pendingToolApprovals: ToolApprovalRequestItem[];
	pendingAskQuestions: AskQuestionRequestItem[];
	onApproveToolApproval: (requestId: string) => void | Promise<void>;
	onRejectToolApproval: (requestId: string) => void | Promise<void>;
	onAnswerAskQuestion: (
		requestId: string,
		answer: string,
	) => void | Promise<void>;
	onRestoreCheckpoint?: (runCount: number) => void | Promise<void>;
	onEditMessage?: (
		messageId: string,
		content: string,
		runCount: number,
	) => void | Promise<void>;
	onForkSession?: (messageId: string) => void | Promise<void>;
	startingLabel?: string;
	isHistoryPreview?: boolean;
	errorAction?: { label: string; onClick: () => void | Promise<void> };
	onProceedWhileRunning?: (
		sessionId: string,
		toolCallId?: string,
	) => void | Promise<void>;
	/** Opens the settings page that fixes a credential failure. */
	onFixCredentials?: (target: "account" | "models") => void;
	/**
	 * What the last turn changed, fetched after the turn's latest activity;
	 * drives the receipt under it.
	 */
	lastTurnChanges?: SessionChangeSet;
	onReviewLastTurn?: (path?: string) => void;
};

type AskQuestionRequestItem = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	question: string;
	options: string[];
	context?: {
		agentId?: string;
		conversationId?: string;
		iteration?: number;
	};
};

function ChatMessagesImpl({
	onAddToChat,
	environmentId = "local",
	hasOlderMessages = false,
	isLoadingOlderMessages = false,
	onLoadOlderMessages,
	sessionId,
	status,
	chatTransportState = "connecting",
	isSessionSwitching = false,
	messages,
	error,
	importedFromTool,
	activityLabel = null,
	streamingMessageId = null,
	pendingToolApprovals,
	pendingAskQuestions,
	onApproveToolApproval,
	onRejectToolApproval,
	onAnswerAskQuestion,
	onRestoreCheckpoint,
	onEditMessage,
	onForkSession,
	startingLabel,
	isHistoryPreview = false,
	errorAction,
	onProceedWhileRunning,
	onFixCredentials,
	lastTurnChanges,
	onReviewLastTurn,
}: ChatMessagesProps) {
	const hasMessages = messages.length > 0;
	// Scanned from the tail without copying: this component re-renders on
	// every stream flush, so a reversed array clone per render would churn
	// with transcript length.
	const { lastConversationMessage, lastErrorMessage } = useMemo(() => {
		let conversationMessage: ChatMessage | undefined;
		let errorMessage: ChatMessage | undefined;
		for (let index = messages.length - 1; index >= 0; index--) {
			const message = messages[index];
			if (!conversationMessage && message.role !== "status") {
				conversationMessage = message;
			}
			if (!errorMessage && message.role === "error") {
				errorMessage = message;
			}
			if (conversationMessage && errorMessage) {
				break;
			}
		}
		return {
			lastConversationMessage: conversationMessage,
			lastErrorMessage: errorMessage,
		};
	}, [messages]);
	const shouldShowErrorBanner =
		Boolean(error) &&
		(Boolean(errorAction) ||
			!lastErrorMessage ||
			formatRunError(
				lastErrorMessage.content,
				lastErrorMessage.meta?.providerId,
				lastErrorMessage.meta?.providerAuth,
			) !==
				formatRunError(
					error ?? "",
					lastErrorMessage.meta?.providerId,
					lastErrorMessage.meta?.providerAuth,
				));
	const lastToolInProgress = useMemo(
		() =>
			lastConversationMessage?.role === "tool" &&
			buildToolPresentation(lastConversationMessage).inProgress,
		[lastConversationMessage],
	);
	const isAwaitingFirstOutput =
		status === "running" &&
		!streamingMessageId &&
		!lastToolInProgress &&
		pendingToolApprovals.length === 0 &&
		pendingAskQuestions.length === 0;
	const [showSwitchTransition, setShowSwitchTransition] = useState(false);
	const [toolApprovalActions, setToolApprovalActions] = useState<
		Record<string, "approving" | "rejecting">
	>({});
	const [toolApprovalErrors, setToolApprovalErrors] = useState<
		Record<string, string>
	>({});
	const [askQuestionActions, setAskQuestionActions] = useState<
		Record<string, string>
	>({});
	const [askQuestionErrors, setAskQuestionErrors] = useState<
		Record<string, string>
	>({});
	const [checkpointActions, setCheckpointActions] = useState<
		Record<string, "undoing">
	>({});
	const [checkpointErrors, setCheckpointErrors] = useState<
		Record<string, string>
	>({});
	const [checkpointConfirmation, setCheckpointConfirmation] = useState<{
		messageId: string;
		runCount: number;
	} | null>(null);
	const [editConfirmation, setEditConfirmation] = useState<{
		messageId: string;
		content: string;
		runCount: number;
	} | null>(null);
	const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
	const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
	const [editErrors, setEditErrors] = useState<Record<string, string>>({});
	const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
	const [forkConfirmation, setForkConfirmation] = useState<{
		messageId: string;
		sessionId: string | null;
	} | null>(null);
	const [forkErrors, setForkErrors] = useState<Record<string, string>>({});
	const [expandedImage, setExpandedImage] = useState<{
		sessionId: string | null;
		image: ChatMessageImage;
	} | null>(null);
	const sessionVersioningPending =
		editingMessageId !== null ||
		forkingMessageId !== null ||
		Object.values(checkpointActions).includes("undoing");
	const visibleExpandedImage =
		expandedImage?.sessionId === sessionId ? expandedImage.image : null;
	const showIdleDetails =
		!hasMessages && !isSessionSwitching && !showSwitchTransition;
	// The live run keeps rendering its rows while the session is active, and an
	// interrupted run (cancelled/failed/error) keeps them too — even when Stop
	// landed mid-answer and left partial trailing text — so the user can see
	// where it stopped. Only a run the agent finished folds into a summary row.
	const collapseTrailingRun = status === "completed" || status === "idle";
	const buildRenderItems = useMemo(() => {
		if (!sessionId) return createChatRenderItemsCache();
		const key = sessionKey({ sessionId, environmentId });
		const build = renderCaches.get(key) ?? createChatRenderItemsCache();
		renderCaches.set(key, build);
		return build;
	}, [sessionId, environmentId]);
	useEffect(() => {
		if (!sessionId) return;
		const key = sessionKey({ sessionId, environmentId });
		renderCaches.set(key, buildRenderItems);
		return () => renderCaches.set(key, buildRenderItems);
	}, [sessionId, environmentId, buildRenderItems]);
	const renderItems = useMemo(
		() => buildRenderItems(messages, { collapseTrailingRun }),
		[messages, collapseTrailingRun, buildRenderItems],
	);
	const isRunActive =
		!isHistoryPreview &&
		(status === "starting" || status === "running" || status === "stopping");
	const lastUserItemIndex = renderItems.findLastIndex(
		(item) =>
			item.type === "message" &&
			item.message.role === "user" &&
			!isSystemSteeringMessage(item.message),
	);
	// Long chats keep only the newest rows on the page: WebKitGTK restyles
	// every row on each update, so frame cost grows with the row count.
	// The window's first row is pinned by key so rows never drop off the top
	// mid-turn; a new turn moves the window back to the tail.
	const windowKey = sessionId ? sessionKey({ sessionId, environmentId }) : null;
	const rowKeys = useMemo(() => renderItems.map(renderItemKey), [renderItems]);
	const lastUserRowKey =
		lastUserItemIndex >= 0 ? (rowKeys[lastUserItemIndex] ?? null) : null;
	const [windowPin, setWindowPin] = useState<
		(TranscriptWindowPin & { windowKey: string | null }) | null
	>(null);
	const pin =
		windowPin?.windowKey === windowKey
			? windowPin
			: // Reopening a chat left scrolled up keeps its earlier rows, so the
				// saved scroll offset still points at the same content.
				windowKey &&
					sessionId &&
					chatScrollPositions.get(sessionId)?.atEnd === false
				? transcriptWindowPins.get(windowKey)
				: undefined;
	const pinnedIndex =
		pin && pin.lastUserRowKey === lastUserRowKey
			? rowKeys.indexOf(pin.firstRowKey)
			: -1;
	const windowStart =
		pinnedIndex >= 0
			? pinnedIndex
			: Math.max(0, rowKeys.length - TRANSCRIPT_WINDOW_ROWS);
	const windowFirstRowKey = rowKeys[windowStart];
	const pinWindow = useCallback(
		(firstRowKey: string) => {
			setWindowPin({ windowKey, lastUserRowKey, firstRowKey });
			if (windowKey)
				transcriptWindowPins.set(windowKey, { lastUserRowKey, firstRowKey });
		},
		[windowKey, lastUserRowKey],
	);
	useEffect(() => {
		if (
			windowFirstRowKey === undefined ||
			(windowPin?.windowKey === windowKey &&
				windowPin.lastUserRowKey === lastUserRowKey &&
				windowPin.firstRowKey === windowFirstRowKey)
		)
			return;
		pinWindow(windowFirstRowKey);
	}, [windowFirstRowKey, windowPin, windowKey, lastUserRowKey, pinWindow]);
	const visibleRenderItems =
		windowStart > 0 ? renderItems.slice(windowStart) : renderItems;
	// Rows fetched by "Load older messages" stay hidden behind the pin until
	// the load lands; then the window opens one step onto them.
	const revealAfterLoadRef = useRef<string | null>(null);
	useEffect(() => {
		const previousFirstRowKey = revealAfterLoadRef.current;
		if (!previousFirstRowKey) return;
		const index = rowKeys.indexOf(previousFirstRowKey);
		if (index > 0) {
			revealAfterLoadRef.current = null;
			pinWindow(rowKeys[Math.max(0, index - TRANSCRIPT_WINDOW_ROWS)]);
		} else if (!isLoadingOlderMessages) {
			revealAfterLoadRef.current = null;
		}
	}, [rowKeys, isLoadingOlderMessages, pinWindow]);
	const showOlderRows =
		windowStart > 0 || (hasOlderMessages && Boolean(onLoadOlderMessages));
	const loadOlderRows = () => {
		if (windowStart > 0) {
			pinWindow(rowKeys[Math.max(0, windowStart - TRANSCRIPT_WINDOW_ROWS)]);
			return;
		}
		revealAfterLoadRef.current = rowKeys[0] ?? null;
		void onLoadOlderMessages?.();
	};
	const revealRow = useCallback(
		(rowKey: string) => {
			const index = rowKeys.indexOf(rowKey);
			if (index < 0 || index >= windowStart) return false;
			pinWindow(rowKey);
			return true;
		},
		[rowKeys, windowStart, pinWindow],
	);
	// Mid-run the thinking indicator's replacement (the next tool or thinking
	// row) joins the tight run group, so the indicator must sit at that same
	// tight offset; only at the start of a run, directly under the user
	// message, does the response block open at the normal transcript gap.
	const lastRenderItem = renderItems.at(-1);
	const indicatorFollowsWorkingRows =
		lastRenderItem !== undefined &&
		(lastRenderItem.type === "tools" ||
			lastRenderItem.type === "run" ||
			(lastRenderItem.type === "message" &&
				lastRenderItem.message.role === "assistant"));
	// Built once per pendingAskQuestions change instead of per render: the
	// list re-renders on every stream flush and these rows carry JSX.
	const askQuestionItems = useMemo(
		() =>
			pendingAskQuestions.map((item) => ({
				id: item.requestId,
				options: item.options,
				question: item.question,
			})),
		[pendingAskQuestions],
	);
	const previousTimestampByMessage = useMemo(
		() => buildPreviousTimestampMap(messages),
		[messages],
	);
	const userRunCountByMessage = useMemo(
		() => buildUserRunCountMap(messages),
		[messages],
	);
	// Shown only once the latest turn finishes; sending the next message
	// starts a new turn, which hides it until that turn's changes arrive.
	const showLastTurnReceipt =
		Boolean(onReviewLastTurn) &&
		(lastTurnChanges?.files.length ?? 0) > 0 &&
		status !== "starting" &&
		status !== "running" &&
		status !== "stopping";

	useEffect(() => {
		void sessionId;
		setCheckpointConfirmation(null);
		setEditConfirmation(null);
		setForkConfirmation(null);
	}, [sessionId]);

	useEffect(() => {
		if (!visibleExpandedImage) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setExpandedImage(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [visibleExpandedImage]);

	useEffect(() => {
		if (!isSessionSwitching) {
			setShowSwitchTransition((prev) => (prev ? false : prev));
			return;
		}
		const timer = window.setTimeout(() => {
			setShowSwitchTransition((prev) => (prev ? prev : true));
		}, 180);
		return () => {
			window.clearTimeout(timer);
		};
	}, [isSessionSwitching]);

	useEffect(() => {
		const activeRequestIds = new Set(
			pendingToolApprovals.map((item) => item.requestId),
		);
		setToolApprovalActions((prev) => pruneRequestMap(prev, activeRequestIds));
		setToolApprovalErrors((prev) => pruneRequestMap(prev, activeRequestIds));
	}, [pendingToolApprovals]);

	useEffect(() => {
		const activeRequestIds = new Set(
			pendingAskQuestions.map((item) => item.requestId),
		);
		setAskQuestionActions((prev) => pruneRequestMap(prev, activeRequestIds));
		setAskQuestionErrors((prev) => pruneRequestMap(prev, activeRequestIds));
	}, [pendingAskQuestions]);

	const handleToolApprovalDecision = useCallback(
		async (
			requestId: string,
			action: "approving" | "rejecting",
			fn: (requestId: string) => void | Promise<void>,
		) => {
			setToolApprovalActions((prev) => ({ ...prev, [requestId]: action }));
			setToolApprovalErrors((prev) => {
				if (!prev[requestId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[requestId];
				return next;
			});
			try {
				await Promise.resolve(fn(requestId));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not submit decision.";
				setToolApprovalErrors((prev) => ({ ...prev, [requestId]: message }));
			} finally {
				setToolApprovalActions((prev) => {
					if (!prev[requestId]) {
						return prev;
					}
					const next = { ...prev };
					delete next[requestId];
					return next;
				});
			}
		},
		[],
	);

	const handleAskQuestionAnswer = useCallback(
		async (requestId: string, answer: string) => {
			setAskQuestionActions((prev) => ({ ...prev, [requestId]: answer }));
			setAskQuestionErrors((prev) => {
				if (!prev[requestId]) return prev;
				const next = { ...prev };
				delete next[requestId];
				return next;
			});
			try {
				await Promise.resolve(onAnswerAskQuestion(requestId, answer));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not submit answer.";
				setAskQuestionErrors((prev) => ({ ...prev, [requestId]: message }));
			} finally {
				setAskQuestionActions((prev) => {
					if (!prev[requestId]) return prev;
					const next = { ...prev };
					delete next[requestId];
					return next;
				});
			}
		},
		[onAnswerAskQuestion],
	);

	const handleCopyMessage = useCallback(
		async (messageId: string, text: string) => {
			try {
				await navigator.clipboard.writeText(text);
				setCopiedMessageId(messageId);
				window.setTimeout(() => {
					setCopiedMessageId((current) =>
						current === messageId ? null : current,
					);
				}, 1600);
			} catch {
				toast({
					variant: "destructive",
					title: "Copy failed",
					description: "The message could not be copied to the clipboard.",
				});
			}
		},
		[],
	);

	const handleRestoreCheckpoint = useCallback(
		async (messageId: string, runCount: number) => {
			if (!onRestoreCheckpoint) {
				return;
			}
			setCheckpointActions((prev) => ({ ...prev, [messageId]: "undoing" }));
			setCheckpointErrors((prev) => {
				if (!prev[messageId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[messageId];
				return next;
			});
			try {
				await Promise.resolve(onRestoreCheckpoint(runCount));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not restore checkpoint.";
				setCheckpointErrors((prev) => ({ ...prev, [messageId]: message }));
			} finally {
				setCheckpointActions((prev) => {
					if (!prev[messageId]) {
						return prev;
					}
					const next = { ...prev };
					delete next[messageId];
					return next;
				});
			}
		},
		[onRestoreCheckpoint],
	);

	const handleEditMessage = useCallback(
		async (messageId: string, content: string, runCount: number) => {
			if (!onEditMessage) {
				return;
			}
			setEditingMessageId(messageId);
			setEditErrors((prev) => {
				if (!prev[messageId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[messageId];
				return next;
			});
			try {
				await Promise.resolve(onEditMessage(messageId, content, runCount));
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: "Could not restart from this message.";
				setEditErrors((prev) => ({ ...prev, [messageId]: message }));
			} finally {
				setEditingMessageId((current) =>
					current === messageId ? null : current,
				);
			}
		},
		[onEditMessage],
	);
	const requestEditMessage = useCallback(
		(messageId: string, content: string, runCount: number) => {
			setEditConfirmation({ messageId, content, runCount });
		},
		[],
	);
	// Stable identity so memoized MessageBubbles skip re-rendering on stream
	// flushes; an inline lambda here would invalidate every bubble per flush.
	const requestRestoreCheckpoint = useCallback(
		(messageId: string, runCount: number) => {
			setCheckpointConfirmation({ messageId, runCount });
		},
		[],
	);

	const handleExpandImage = useCallback(
		(image: ChatMessageImage) => {
			setExpandedImage({ sessionId, image });
		},
		[sessionId],
	);

	const getReasoningProps = useCallback(
		(reasoningMessages: ChatMessage[]) => {
			const firstReasoningMessage = reasoningMessages[0];
			const lastReasoningMessage = reasoningMessages.at(-1);
			return {
				reasoningContent: reasoningMessages
					.map((reasoningMessage) => reasoningMessage.reasoning?.trim())
					.filter((content): content is string => Boolean(content))
					.join("\n\n"),
				reasoningRedacted: reasoningMessages.some(
					(reasoningMessage) => reasoningMessage.reasoningRedacted === true,
				),
				thoughtDurationMilliseconds:
					firstReasoningMessage && lastReasoningMessage
						? getThoughtDurationMilliseconds(
								previousTimestampByMessage.get(firstReasoningMessage),
								lastReasoningMessage.createdAt,
							)
						: undefined,
			};
		},
		[previousTimestampByMessage],
	);

	const handleForkSession = useCallback(
		async (messageId: string) => {
			if (!onForkSession) {
				return;
			}
			setForkingMessageId(messageId);
			setForkErrors((prev) => {
				if (!prev[messageId]) {
					return prev;
				}
				const next = { ...prev };
				delete next[messageId];
				return next;
			});
			try {
				await Promise.resolve(onForkSession(messageId));
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "Could not fork session.";
				setForkErrors((prev) => ({ ...prev, [messageId]: message }));
			} finally {
				setForkingMessageId((current) =>
					current === messageId ? null : current,
				);
			}
		},
		[onForkSession],
	);
	// Stable identity so every MessageBubble is not re-rendered on each render.
	const requestForkConfirmation = useCallback(
		(messageId: string) => setForkConfirmation({ messageId, sessionId }),
		[sessionId],
	);

	return (
		<ChatSelectionToChat
			key={`${environmentId}:${sessionId ?? "new-chat"}`}
			onAddToChat={
				isSessionSwitching || isHistoryPreview ? undefined : onAddToChat
			}
		>
			<ChatScrollProvider key={sessionId ?? "new-chat"} sessionId={sessionId}>
				<MessageScroller className="isolate h-full min-h-0 min-w-0">
					<ChatScrollViewport
						sessionId={sessionId}
						messages={messages}
						ready={!isSessionSwitching && !isHistoryPreview}
						aria-label="Agent conversation"
						className="h-full min-h-0 min-w-0"
					>
						{/* Outside the content so the scroller sees revealed rows as a
						    prepend and keeps the reader's place. */}
						{!showIdleDetails && showOlderRows ? (
							<div className="mx-auto w-full max-w-[calc(var(--breakpoint-lg)+3rem)] pt-6 pl-12 pr-6">
								<Button
									className="w-full"
									variant="ghost"
									disabled={isLoadingOlderMessages}
									onClick={loadOlderRows}
								>
									{isLoadingOlderMessages
										? "Loading older messages…"
										: "Load older messages"}
								</Button>
							</div>
						) : null}
						<MessageScrollerContent
							className={cn(
								"mx-auto w-full min-w-0 max-w-[calc(var(--breakpoint-lg)+3rem)] gap-4",
								showIdleDetails ? "p-0" : "pt-6 pb-16 pl-12 pr-6",
							)}
						>
							{showIdleDetails ? null : (
								<>
									{importedFromTool ? (
										<MessageScrollerItem messageId="imported-session">
											<ImportedSessionNotice tool={importedFromTool} />
										</MessageScrollerItem>
									) : null}
									{visibleRenderItems.map((item, visibleIndex) => {
										const itemIndex = windowStart + visibleIndex;
										// Working rows — live (`run`) or folded (`work`) — render
										// through one child renderer so a row keeps its exact look
										// and position when the run collapses. Those rows keep
										// copy/expand but drop the session-versioning actions
										// (edit, restore, fork), which belong to top-level
										// transcript rows.
										const renderWorkingRow = (child: typeof item) => {
											if (child.type === "tools") {
												return (
													<ToolMessageBlock
														isRunActive={
															isRunActive && itemIndex > lastUserItemIndex
														}
														key={`tools_${child.messages[0]?.id ?? "empty"}`}
														messages={child.messages}
														reportedArtifacts={child.reportedArtifacts}
														onExpandImage={handleExpandImage}
														onProceedWhileRunning={onProceedWhileRunning}
													/>
												);
											}
											if (child.type !== "message") {
												return null;
											}
											return (
												<MessageBubble
													agentRole={child.agentRole}
													isLastAssistantMessage={
														child.message.role === "assistant" &&
														lastConversationMessage === child.message
													}
													isStreaming={streamingMessageId === child.message.id}
													key={child.message.id}
													message={child.message}
													onCopyMessage={handleCopyMessage}
													onExpandImage={handleExpandImage}
													wasCopied={copiedMessageId === child.message.id}
													{...getReasoningProps(child.reasoningMessages)}
												/>
											);
										};
										if (item.type === "tools") {
											return (
												<MessageScrollerItem
													key={`tools_${item.messages[0]?.id ?? "empty"}`}
													messageId={`tools_${item.messages[0]?.id ?? "empty"}`}
												>
													{renderWorkingRow(item)}
												</MessageScrollerItem>
											);
										}
										if (item.type === "run") {
											return (
												<MessageScrollerItem
													className="flex flex-col gap-1"
													messageId={`work_${item.id}`}
													key={`work_${item.id}`}
												>
													{item.items.map(renderWorkingRow)}
												</MessageScrollerItem>
											);
										}
										if (item.type === "work") {
											return (
												<MessageScrollerItem
													key={`work_${item.id}`}
													messageId={`work_${item.id}`}
												>
													<WorkBlock
														durationMilliseconds={item.durationMilliseconds}
														key={`work_${item.id}`}
														toolCallCount={item.toolCallCount}
													>
														{item.items.map(renderWorkingRow)}
													</WorkBlock>
												</MessageScrollerItem>
											);
										}
										const { agentRole, message, reasoningMessages } = item;
										// An answer directly under its run's working rows belongs
										// to them — pull it closer than the full transcript gap.
										const previousItem = renderItems[itemIndex - 1];
										const followsWorkingRows =
											message.role === "assistant" &&
											previousItem !== undefined &&
											previousItem.type !== "message";
										return (
											<MessageScrollerItem
												key={message.id}
												messageId={message.id}
												scrollAnchor={
													message.role === "user" &&
													!isSystemSteeringMessage(message)
												}
											>
												<MessageBubble
													agentRole={agentRole}
													followsWorkingRows={followsWorkingRows}
													isLastAssistantMessage={
														message.role === "assistant" &&
														lastConversationMessage === message
													}
													isStreaming={streamingMessageId === message.id}
													key={message.id}
													message={message}
													runCount={userRunCountByMessage.get(message)}
													onExpandImage={handleExpandImage}
													onCopyMessage={handleCopyMessage}
													onEditMessage={
														onEditMessage ? requestEditMessage : undefined
													}
													editDisabled={
														!onEditMessage ||
														status === "starting" ||
														status === "running" ||
														status === "stopping" ||
														isSessionSwitching ||
														sessionVersioningPending
													}
													editError={editErrors[message.id]}
													editPending={editingMessageId === message.id}
													onRestoreCheckpoint={
														onRestoreCheckpoint
															? requestRestoreCheckpoint
															: undefined
													}
													restoreDisabled={
														!onRestoreCheckpoint ||
														status === "starting" ||
														status === "running" ||
														status === "stopping" ||
														isSessionSwitching ||
														sessionVersioningPending
													}
													restoreError={checkpointErrors[message.id]}
													restorePending={
														checkpointActions[message.id] === "undoing"
													}
													wasCopied={copiedMessageId === message.id}
													onForkSession={
														onForkSession ? requestForkConfirmation : undefined
													}
													forkDisabled={
														status === "starting" ||
														status === "running" ||
														status === "stopping" ||
														isSessionSwitching ||
														sessionVersioningPending
													}
													forkPending={forkingMessageId === message.id}
													forkError={forkErrors[message.id]}
													onFixCredentials={onFixCredentials}
													{...getReasoningProps(reasoningMessages)}
												/>
											</MessageScrollerItem>
										);
									})}
									{showLastTurnReceipt &&
									lastTurnChanges &&
									onReviewLastTurn ? (
										<MessageScrollerItem
											// The turn's last message floats its timestamp and
											// actions over whatever follows; the receipt sits
											// below them, leaving the same 6px gap the actions
											// row keeps above itself (6px offset + 32px row).
											className="pt-7"
											messageId="last-turn-receipt"
										>
											<TurnReceipt
												changes={lastTurnChanges}
												onReview={onReviewLastTurn}
											/>
										</MessageScrollerItem>
									) : null}
									{/* Lives inside the transcript column and mirrors a
								    reasoning/tool trigger's geometry exactly (icon slot,
								    min-height, padding), so the first real row replaces it
								    in place with no jump. */}
									{(status === "starting" || isAwaitingFirstOutput) &&
									!isSessionSwitching &&
									!isHistoryPreview ? (
										<MessageScrollerItem
											messageId="activity"
											className={cn(
												"flex min-h-7 items-center gap-2 py-1 text-sm font-medium text-muted-foreground",
												indicatorFollowsWorkingRows && "-mt-3",
											)}
										>
											<Loader2 className="size-4 animate-spin" />
											<span className={STREAMING_TITLE_CLASS}>
												{startingLabel ?? activityLabel ?? "Thinking..."}
											</span>
										</MessageScrollerItem>
									) : null}
									{pendingToolApprovals.length > 0 ? (
										<MessageScrollerItem messageId="tool-approvals">
											<ToolApprovalPanel
												items={pendingToolApprovals}
												onApprove={(requestId) =>
													handleToolApprovalDecision(
														requestId,
														"approving",
														onApproveToolApproval,
													)
												}
												onReject={(requestId) =>
													handleToolApprovalDecision(
														requestId,
														"rejecting",
														onRejectToolApproval,
													)
												}
												pendingActions={toolApprovalActions}
												requestErrors={toolApprovalErrors}
											/>
										</MessageScrollerItem>
									) : null}
									{askQuestionItems.length > 0 ? (
										<MessageScrollerItem messageId="ask-questions">
											<AgentAskQuestion
												errors={askQuestionErrors}
												items={askQuestionItems}
												onAnswer={handleAskQuestionAnswer}
												pendingAnswers={askQuestionActions}
											/>
										</MessageScrollerItem>
									) : null}
								</>
							)}
							{showSwitchTransition ||
							chatTransportState !== "connected" ||
							shouldShowErrorBanner ? (
								<MessageScrollerItem messageId="session-notices">
									{showSwitchTransition ? (
										hasMessages ? (
											<div className="pointer-events-none absolute right-6 top-6 z-20 rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-[1px]">
												<div className="flex items-center gap-1.5">
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
													Switching session...
												</div>
											</div>
										) : (
											<div className="rounded-xl border border-border/70 bg-card p-4">
												<div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
													<Loader2 className="h-4 w-4 animate-spin" />
													Loading session...
												</div>
												<div className="space-y-3">
													<div className="h-4 w-2/5 animate-pulse rounded bg-muted/70" />
													<div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
													<div className="h-4 w-3/5 animate-pulse rounded bg-muted/70" />
												</div>
											</div>
										)
									) : null}
									{chatTransportState !== "connected" &&
									!shouldShowErrorBanner ? (
										<div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
											{chatTransportState === "reconnecting"
												? "Reconnecting chat..."
												: chatTransportState === "unavailable"
													? "Chat backend unavailable"
													: "Connecting chat..."}
										</div>
									) : null}
									{shouldShowErrorBanner ? (
										<div className="cline-chat-selectable mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
											{lastErrorMessage?.content !== error ? (
												<p>{error}</p>
											) : null}
											{errorAction ? (
												<Button
													className="mt-2"
													onClick={() => void errorAction.onClick()}
													size="sm"
													variant="outline"
												>
													{errorAction.label}
												</Button>
											) : null}
										</div>
									) : null}
								</MessageScrollerItem>
							) : null}
						</MessageScrollerContent>
					</ChatScrollViewport>
					<MessageScrollerButton />
					<TranscriptOutline messages={messages} revealMessage={revealRow} />
					{visibleExpandedImage ? (
						<ChatImageLightbox
							image={visibleExpandedImage}
							onClose={() => setExpandedImage(null)}
						/>
					) : null}
					<AlertDialog
						open={
							forkConfirmation !== null &&
							forkConfirmation.sessionId === sessionId
						}
						onOpenChange={(open) => {
							if (!open) setForkConfirmation(null);
						}}
					>
						<AlertDialogContent className="cline-chat-selectable">
							<AlertDialogHeader>
								<AlertDialogTitle>Fork session?</AlertDialogTitle>
								<AlertDialogDescription>
									This copies the full conversation into a new session. Your
									current session is kept.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									onClick={() => {
										const confirmation = forkConfirmation;
										setForkConfirmation(null);
										if (confirmation?.sessionId === sessionId)
											void handleForkSession(confirmation.messageId);
									}}
								>
									Fork session
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					<AlertDialog
						open={checkpointConfirmation !== null}
						onOpenChange={(open) => {
							if (!open) {
								setCheckpointConfirmation(null);
							}
						}}
					>
						<AlertDialogContent className="cline-chat-selectable">
							<AlertDialogHeader>
								<AlertDialogTitle>Revert to this checkpoint?</AlertDialogTitle>
								<AlertDialogDescription>
									Workspace files and conversation history after this point will
									be discarded. This cannot be undone.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
									onClick={() => {
										const confirmation = checkpointConfirmation;
										setCheckpointConfirmation(null);
										if (confirmation) {
											void handleRestoreCheckpoint(
												confirmation.messageId,
												confirmation.runCount,
											);
										}
									}}
								>
									Revert
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					<AlertDialog
						open={editConfirmation !== null}
						onOpenChange={(open) => {
							if (!open) {
								setEditConfirmation(null);
							}
						}}
					>
						<AlertDialogContent className="cline-chat-selectable">
							<AlertDialogHeader>
								<AlertDialogTitle>Edit and restart from here?</AlertDialogTitle>
								<AlertDialogDescription>
									This creates a new session and restores the workspace to its
									checkpoint before placing this message in the composer.
									Workspace and conversation changes after this point will be
									discarded.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
									onClick={() => {
										const confirmation = editConfirmation;
										setEditConfirmation(null);
										if (confirmation) {
											void handleEditMessage(
												confirmation.messageId,
												confirmation.content,
												confirmation.runCount,
											);
										}
									}}
								>
									Continue
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</MessageScroller>
			</ChatScrollProvider>
		</ChatSelectionToChat>
	);
}

export const ChatMessages = memo(ChatMessagesImpl);

function pruneRequestMap<T extends string>(
	prev: Record<string, T>,
	activeRequestIds: Set<string>,
): Record<string, T> {
	let hasRemoved = false;
	const next: Record<string, T> = {};
	for (const [requestId, value] of Object.entries(prev)) {
		if (activeRequestIds.has(requestId)) {
			next[requestId] = value;
			continue;
		}
		hasRemoved = true;
	}
	return hasRemoved ? next : prev;
}
