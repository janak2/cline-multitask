import { stat } from "node:fs/promises";
import path from "node:path";
import { toPosixSeparators } from "@cline/shared";
import { type FastFileIndexOptions, getFileIndex } from "./file-indexer";

const TRAILING_PUNCTUATION_CHARS = new Set("),.:;!?`'\"");
const LEADING_WRAPPERS = /^[(`'"]+/;

export interface MentionEnricherOptions extends FastFileIndexOptions {
	maxFiles?: number;
	maxFileBytes?: number;
	maxTotalBytes?: number;
}

export interface MentionEnrichmentResult {
	prompt: string;
	mentions: string[];
	matchedFiles: string[];
	ignoredMentions: string[];
}

function stripTrailingPunctuation(input: string): string {
	let end = input.length;
	while (end > 0 && TRAILING_PUNCTUATION_CHARS.has(input.charAt(end - 1))) {
		end -= 1;
	}
	return input.slice(0, end);
}

function extractMentionTokens(
	input: string,
	cwd: string,
	fileList: ReadonlySet<string>,
): string[] {
	const matches = input.matchAll(/(^|\s)@/g);
	const mentions: string[] = [];
	for (const match of matches) {
		const remainder = input
			.slice(match.index + match[0].length)
			.split(/[\r\n]/, 1)[0];
		const nextMention = remainder.search(/\s@/);
		const body = nextMention < 0 ? remainder : remainder.slice(0, nextMention);
		let token = body.split(/\s/, 1)[0];
		for (const boundary of body.matchAll(/\s|$/g)) {
			const candidate = stripTrailingPunctuation(
				body.slice(0, boundary.index).replace(LEADING_WRAPPERS, ""),
			);
			const relative = normalizeMentionPath(candidate, cwd);
			if (relative && fileList.has(relative)) token = candidate;
		}
		if (token.length === 0) {
			continue;
		}
		const normalized = stripTrailingPunctuation(
			token.replace(LEADING_WRAPPERS, ""),
		);
		if (normalized.length === 0 || normalized.includes("@")) {
			continue;
		}
		mentions.push(normalized);
	}
	return Array.from(new Set(mentions));
}

function normalizeMentionPath(
	mention: string,
	cwd: string,
): string | undefined {
	const candidate = mention.replace(/\\/g, "/");
	const maybeAbsolute = path.isAbsolute(candidate)
		? path.resolve(candidate)
		: path.resolve(cwd, candidate);
	const relative = path.relative(cwd, maybeAbsolute);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return undefined;
	}
	return toPosixSeparators(relative);
}

export async function enrichPromptWithMentions(
	input: string,
	cwd: string,
	options: MentionEnricherOptions = {},
): Promise<MentionEnrichmentResult> {
	if (!/(^|\s)@\S/.test(input)) {
		return {
			prompt: input,
			mentions: [],
			matchedFiles: [],
			ignoredMentions: [],
		};
	}

	const maxFiles = options.maxFiles;
	const maxFileBytes = options.maxFileBytes;
	const maxTotalBytes = options.maxTotalBytes;
	const fileList = await getFileIndex(cwd, { ttlMs: options.ttlMs });
	const mentionPaths = new Set(fileList);
	for (const file of fileList) {
		for (
			let index = file.indexOf("/");
			index >= 0;
			index = file.indexOf("/", index + 1)
		) {
			mentionPaths.add(file.slice(0, index));
		}
	}
	const mentions = extractMentionTokens(input, cwd, mentionPaths);
	const matched: string[] = [];
	const ignored: string[] = [];
	const attachments: Array<{ path: string; content: string }> = [];
	let totalBytes = 0;

	for (const mention of mentions) {
		if (maxFiles && attachments.length >= maxFiles) {
			ignored.push(mention);
			continue;
		}

		const relativePath = normalizeMentionPath(mention, cwd);
		if (!relativePath || !mentionPaths.has(relativePath)) {
			ignored.push(mention);
			continue;
		}

		if (!maxFileBytes || !maxTotalBytes) {
			matched.push(relativePath);
			continue;
		}

		const absolutePath = path.join(cwd, relativePath);
		try {
			const fileStat = await stat(absolutePath);
			if (!fileStat.isFile() && !fileStat.isDirectory()) {
				ignored.push(mention);
				continue;
			}
			const nextBytes = totalBytes + maxFileBytes;
			if (nextBytes > maxTotalBytes) {
				ignored.push(mention);
				continue;
			}

			totalBytes = nextBytes;
			matched.push(relativePath);
		} catch {
			ignored.push(mention);
		}
	}

	return {
		prompt: input,
		mentions,
		matchedFiles: matched,
		ignoredMentions: ignored,
	};
}
