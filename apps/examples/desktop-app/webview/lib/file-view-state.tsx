"use client";

import {
	createContext,
	type Dispatch,
	type HTMLAttributes,
	type SetStateAction,
	useCallback,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

const FileViewContext = createContext<string | null>(null);
export const FileViewStateProvider = FileViewContext.Provider;

export function fileViewStorageKey(
	environmentId: string,
	sessionId: string | null,
	workspaceRoot: string,
	cwd: string,
): string | null {
	return sessionId && workspaceRoot
		? `cline.code.file-view.v1:${JSON.stringify([environmentId, sessionId, workspaceRoot, cwd])}`
		: null;
}

function readField<T>(key: string | null, field: string, fallback: T): T {
	if (!key) return fallback;
	try {
		const value = JSON.parse(window.localStorage.getItem(key) ?? "{}")[field];
		if (value === undefined) return fallback;
		if (fallback instanceof Set) {
			return (Array.isArray(value) ? new Set(value) : fallback) as T;
		}
		if (Array.isArray(fallback))
			return (Array.isArray(value) ? value : fallback) as T;
		if (typeof value === "number" && !Number.isFinite(value)) return fallback;
		if (fallback !== null && typeof value !== typeof fallback) return fallback;
		return value;
	} catch {
		return fallback;
	}
}

export function useFileViewState<T>(
	field: string,
	fallback: T | (() => T),
	storageKey?: string | null,
): [T, Dispatch<SetStateAction<T>>] {
	const contextKey = useContext(FileViewContext);
	const key = storageKey === undefined ? contextKey : storageKey;
	const identity = JSON.stringify([key, field]);
	const initial = () =>
		typeof fallback === "function" ? (fallback as () => T)() : fallback;
	const [state, setState] = useState(() => ({
		identity,
		value: readField(key, field, initial()),
	}));
	const current =
		state.identity === identity
			? state
			: { identity, value: readField(key, field, initial()) };
	if (current !== state) setState(current);
	const ref = useRef(current);
	ref.current = current;
	const update = useCallback<Dispatch<SetStateAction<T>>>(
		(next) => {
			if (ref.current.identity !== identity) return;
			const value =
				typeof next === "function"
					? (next as (previous: T) => T)(ref.current.value)
					: next;
			ref.current = { identity, value };
			setState(ref.current);
			if (!key) return;
			try {
				const store = JSON.parse(window.localStorage.getItem(key) ?? "{}");
				store[field] = value instanceof Set ? [...value] : value;
				window.localStorage.setItem(key, JSON.stringify(store));
			} catch {
				// Keep the current view usable when browser storage is unavailable.
			}
		},
		[field, identity, key],
	);
	return [current.value, update];
}

export function FileViewScrollArea({
	stateId,
	ready = true,
	...props
}: HTMLAttributes<HTMLDivElement> & { stateId: string; ready?: boolean }) {
	const [position, setPosition] = useFileViewState(stateId, {
		top: 0,
		left: 0,
	});
	const element = useRef<HTMLDivElement>(null);
	const saved = useRef(position);
	const pending = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: restore only when the viewed resource changes, never after a user's scroll.
	useLayoutEffect(() => {
		saved.current = position;
		pending.current = true;
	}, [stateId]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new resource needs its own restoration observer.
	useLayoutEffect(() => {
		const node = element.current;
		if (!node || !ready) return;
		const restore = () => {
			if (!pending.current) return;
			node.scrollTop = saved.current.top;
			node.scrollLeft = saved.current.left;
		};
		restore();
		const observer = new MutationObserver(restore);
		observer.observe(node, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [ready, stateId]);
	return (
		<div
			{...props}
			ref={element}
			onWheel={() => {
				pending.current = false;
			}}
			onPointerDown={(event) => {
				pending.current = false;
				props.onPointerDown?.(event);
			}}
			onKeyDown={(event) => {
				pending.current = false;
				props.onKeyDown?.(event);
			}}
			onScroll={(event) => {
				const node = event.currentTarget;
				if (
					pending.current &&
					(node.scrollTop !== saved.current.top ||
						node.scrollLeft !== saved.current.left)
				)
					return;
				pending.current = false;
				setPosition({ top: node.scrollTop, left: node.scrollLeft });
			}}
		/>
	);
}
