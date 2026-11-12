import { z } from "zod";

export const IMAGE_OMITTED_PLACEHOLDER =
	"[media omitted: invalid or exceeds size limit]";

/**
 * Substituted for image content at request-build time when the target model
 * does not advertise image input. The stored conversation history keeps the
 * real image, so switching to an image-capable model restores it.
 */
export const IMAGE_UNSUPPORTED_PLACEHOLDER =
	"[Image attached — this model cannot view images]";

export const GeneratedMediaModalitySchema = z.enum([
	"image",
	"audio",
	"video",
	"file",
]);
export type GeneratedMediaModality = z.infer<
	typeof GeneratedMediaModalitySchema
>;

export const GeneratedMediaSourceSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("base64"), data: z.string().min(1) }),
	z.object({
		type: z.literal("url"),
		url: z
			.string()
			.url()
			.pipe(
				z.string().refine((value) => {
					const protocol = new URL(value).protocol;
					return protocol === "http:" || protocol === "https:";
				}, "Generated media URLs must use HTTP or HTTPS"),
			),
	}),
	z.object({ type: z.literal("artifact"), artifactId: z.string().min(1) }),
]);
export type GeneratedMediaSource = z.infer<typeof GeneratedMediaSourceSchema>;

function modalityForMediaType(mediaType: string): GeneratedMediaModality {
	if (mediaType.startsWith("image/")) return "image";
	if (mediaType.startsWith("audio/")) return "audio";
	if (mediaType.startsWith("video/")) return "video";
	return "file";
}

/** Canonical model-generated media, shared by streaming and persistence. */
export const GeneratedMediaSchema = z
	.object({
		id: z.string().min(1),
		modality: GeneratedMediaModalitySchema,
		mediaType: z.string().min(1),
		source: GeneratedMediaSourceSchema,
		name: z.string().min(1).optional(),
		sizeBytes: z.number().int().nonnegative().optional(),
	})
	.refine((media) => modalityForMediaType(media.mediaType) === media.modality, {
		message: "Generated media modality must match its media type",
		path: ["modality"],
	});
export type GeneratedMedia = z.infer<typeof GeneratedMediaSchema>;

export function isGeneratedMedia(value: unknown): value is GeneratedMedia {
	return GeneratedMediaSchema.safeParse(value).success;
}

export function generatedMediaModalityFromMediaType(
	mediaType: string,
): GeneratedMediaModality {
	return modalityForMediaType(mediaType);
}

export const SUPPORTED_IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
] as const;

export const DEFAULT_MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_ENCODED_BYTES = DEFAULT_MAX_IMAGE_BASE64_BYTES;
export const DEFAULT_MAX_IMAGE_DECODED_BYTES = 6 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_MEDIA_BYTES = 8 * 1024 * 1024;

/**
 * Longest side, in pixels, of an image sent to a model. Providers reject
 * larger images once a request carries many of them, and because history is
 * resent every turn, one such image fails every later turn of the session.
 */
export const DEFAULT_MAX_IMAGE_DIMENSION_PX = 2000;

/**
 * Text sent in place of an image whose longest side exceeds
 * {@link DEFAULT_MAX_IMAGE_DIMENSION_PX}.
 */
export function imageTooLargePlaceholder(
	width: number,
	height: number,
	maxDimension = DEFAULT_MAX_IMAGE_DIMENSION_PX,
): string {
	return `[image omitted: ${width}x${height} px is larger than the ${maxDimension} px limit; render it smaller to view it]`;
}

const BASE64_VALUES = (() => {
	const table = new Int16Array(128).fill(-1);
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	for (let i = 0; i < alphabet.length; i++) {
		table[alphabet.charCodeAt(i)] = i;
	}
	return table;
})();

/** Decodes up to `maxBytes` bytes from the start of a base64 string. */
function decodeBase64Prefix(base64: string, maxBytes: number): Uint8Array {
	const out = new Uint8Array(maxBytes);
	let length = 0;
	let buffer = 0;
	let bits = 0;
	for (let i = 0; i < base64.length && length < maxBytes; i++) {
		const code = base64.charCodeAt(i);
		const value = code < 128 ? BASE64_VALUES[code] : -1;
		if (value === undefined || value < 0) {
			if (code === 61) break;
			continue;
		}
		buffer = (buffer << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[length++] = (buffer >> bits) & 0xff;
		}
	}
	return out.subarray(0, length);
}

/** JPEG headers (EXIF, colour profiles) can push the size marker this far in. */
const IMAGE_HEADER_SCAN_BYTES = 256 * 1024;

/**
 * Reads an image's pixel size from its header without decoding the image.
 * Accepts raw bytes or base64 (optionally a data URL). Returns undefined for
 * formats or headers it cannot read.
 */
export function readImageDimensions(
	image: Uint8Array | string,
): { width: number; height: number } | undefined {
	let bytes: Uint8Array;
	if (typeof image === "string") {
		const comma = image.startsWith("data:") ? image.indexOf(",") : -1;
		const base64 = comma === -1 ? image : image.slice(comma + 1);
		bytes = decodeBase64Prefix(base64, IMAGE_HEADER_SCAN_BYTES);
	} else {
		bytes = image;
	}
	const at = (i: number) => bytes[i] ?? 0;
	const u16be = (i: number) => (at(i) << 8) | at(i + 1);
	const u16le = (i: number) => at(i) | (at(i + 1) << 8);
	const u24le = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
	const u32be = (i: number) =>
		((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
	const ascii = (i: number, text: string) =>
		[...text].every((char, k) => at(i + k) === char.charCodeAt(0));

	// PNG: the IHDR chunk always comes first.
	if (at(0) === 0x89 && ascii(1, "PNG") && ascii(12, "IHDR")) {
		return { width: u32be(16), height: u32be(20) };
	}
	// GIF: logical screen size.
	if (ascii(0, "GIF8")) {
		return { width: u16le(6), height: u16le(8) };
	}
	// WebP: lossy, lossless, or extended.
	if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
		if (ascii(12, "VP8 ")) {
			return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
		}
		if (ascii(12, "VP8L")) {
			const b0 = at(21);
			const b1 = at(22);
			const b2 = at(23);
			const b3 = at(24);
			return {
				width: 1 + (((b1 & 0x3f) << 8) | b0),
				height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
			};
		}
		if (ascii(12, "VP8X")) {
			return { width: 1 + u24le(24), height: 1 + u24le(27) };
		}
		return undefined;
	}
	// JPEG: walk the markers to the first start-of-frame.
	if (at(0) === 0xff && at(1) === 0xd8) {
		let i = 2;
		while (i + 9 < bytes.length) {
			if (at(i) !== 0xff) {
				i += 1;
				continue;
			}
			const marker = at(i + 1);
			if (marker === 0xff) {
				i += 1;
				continue;
			}
			if (
				marker === 0xd8 ||
				marker === 0x01 ||
				(marker >= 0xd0 && marker <= 0xd7)
			) {
				i += 2;
				continue;
			}
			const isStartOfFrame =
				marker >= 0xc0 &&
				marker <= 0xcf &&
				marker !== 0xc4 &&
				marker !== 0xc8 &&
				marker !== 0xcc;
			if (isStartOfFrame) {
				return { width: u16be(i + 7), height: u16be(i + 5) };
			}
			i += 2 + u16be(i + 2);
		}
	}
	return undefined;
}

/**
 * The pixel size of an image whose longest side exceeds `maxDimension`, or
 * undefined when it fits or its size cannot be read.
 */
export function oversizedImageDimensions(
	image: Uint8Array | string,
	maxDimension = DEFAULT_MAX_IMAGE_DIMENSION_PX,
): { width: number; height: number } | undefined {
	const dimensions = readImageDimensions(image);
	if (!dimensions) return undefined;
	return Math.max(dimensions.width, dimensions.height) > maxDimension
		? dimensions
		: undefined;
}

export interface ImageMediaLimits {
	maxEncodedBytes?: number;
	maxDecodedBytes?: number;
	supportedMediaTypes?: readonly string[];
}

export interface ImageMediaValidationSuccess {
	ok: true;
	mediaType: string;
	base64: string;
	encodedBytes: number;
	decodedBytes: number;
}

export interface ImageMediaValidationFailure {
	ok: false;
	reason:
		| "unsupported_media_type"
		| "media_type_mismatch"
		| "invalid_base64"
		| "encoded_limit"
		| "decoded_limit"
		| "total_limit";
	message: string;
}

export type ImageMediaValidationResult =
	| ImageMediaValidationSuccess
	| ImageMediaValidationFailure;

export interface MediaBudgetOptions {
	maxImageEncodedBytes?: number;
	maxImageDecodedBytes?: number;
	maxTotalMediaBytes?: number;
}

export interface ResolvedMediaBudget {
	maxImageEncodedBytes: number;
	maxImageDecodedBytes: number;
	maxTotalMediaBytes: number;
}

export interface MediaBudgetState {
	totalEncodedBytes: number;
	keptImages: number;
	omittedImages: number;
	omittedReasons: Partial<
		Record<ImageMediaValidationFailure["reason"], number>
	>;
}

export interface Base64MediaValidationSuccess {
	ok: true;
	base64: string;
	encodedBytes: number;
	decodedBytes: number;
}

export interface Base64MediaValidationFailure {
	ok: false;
	reason: "invalid_base64" | "total_limit";
	message: string;
}

export type Base64MediaValidationResult =
	| Base64MediaValidationSuccess
	| Base64MediaValidationFailure;

export function imageBase64EncodedByteLength(base64: string): number {
	return base64.length;
}

export function imageBase64DecodedByteLength(base64: string): number {
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

export function imageFileMaxDecodedBytesForBase64Limit(
	maxBase64Bytes = DEFAULT_MAX_IMAGE_BASE64_BYTES,
): number {
	return Math.floor((maxBase64Bytes * 3) / 4);
}

export function imageBase64LengthForDecodedBytes(decodedBytes: number): number {
	return Math.ceil(decodedBytes / 3) * 4;
}

export function resolveMediaBudget(
	options: MediaBudgetOptions = {},
): ResolvedMediaBudget {
	return {
		maxImageEncodedBytes:
			options.maxImageEncodedBytes ?? DEFAULT_MAX_IMAGE_ENCODED_BYTES,
		maxImageDecodedBytes:
			options.maxImageDecodedBytes ?? DEFAULT_MAX_IMAGE_DECODED_BYTES,
		maxTotalMediaBytes:
			options.maxTotalMediaBytes ?? DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	};
}

export function createMediaBudgetState(): MediaBudgetState {
	return {
		totalEncodedBytes: 0,
		keptImages: 0,
		omittedImages: 0,
		omittedReasons: {},
	};
}

function recordOmittedImage(
	state: MediaBudgetState,
	reason: ImageMediaValidationFailure["reason"],
): void {
	state.omittedImages += 1;
	state.omittedReasons[reason] = (state.omittedReasons[reason] ?? 0) + 1;
}

export function reserveImageMediaBytes(
	encodedBytes: number,
	decodedBytes: number,
	budget: MediaBudgetOptions,
	state: MediaBudgetState,
): ImageMediaValidationFailure | null {
	const resolved = resolveMediaBudget(budget);
	if (encodedBytes > resolved.maxImageEncodedBytes) {
		const failure: ImageMediaValidationFailure = {
			ok: false,
			reason: "encoded_limit",
			message: `Image media exceeds the ${resolved.maxImageEncodedBytes} byte encoded limit`,
		};
		recordOmittedImage(state, failure.reason);
		return failure;
	}
	if (decodedBytes > resolved.maxImageDecodedBytes) {
		const failure: ImageMediaValidationFailure = {
			ok: false,
			reason: "decoded_limit",
			message: `Image media exceeds the ${resolved.maxImageDecodedBytes} byte decoded limit`,
		};
		recordOmittedImage(state, failure.reason);
		return failure;
	}
	if (state.totalEncodedBytes + encodedBytes > resolved.maxTotalMediaBytes) {
		const failure: ImageMediaValidationFailure = {
			ok: false,
			reason: "total_limit",
			message: `Image media exceeds the ${resolved.maxTotalMediaBytes} byte total media limit`,
		};
		recordOmittedImage(state, failure.reason);
		return failure;
	}

	state.totalEncodedBytes += encodedBytes;
	state.keptImages += 1;
	return null;
}

export function isBase64Char(charCode: number): boolean {
	return (
		(charCode >= 65 && charCode <= 90) ||
		(charCode >= 97 && charCode <= 122) ||
		(charCode >= 48 && charCode <= 57) ||
		charCode === 43 ||
		charCode === 47
	);
}

export function isCanonicalBase64(base64: string): boolean {
	return base64.length > 0 && isCanonicalBase64Range(base64, 0, base64.length);
}

/** Validate and reserve an arbitrary inline media payload against the turn budget. */
export function validateAndReserveBase64Media(
	data: string,
	budget: MediaBudgetOptions,
	state: MediaBudgetState,
): Base64MediaValidationResult {
	const range = trimmedRange(data);
	const encodedBytes = range.end - range.start;
	if (encodedBytes === 0) {
		return {
			ok: false,
			reason: "invalid_base64",
			message: "Generated media must contain valid base64",
		};
	}

	const resolved = resolveMediaBudget(budget);
	if (state.totalEncodedBytes + encodedBytes > resolved.maxTotalMediaBytes) {
		return {
			ok: false,
			reason: "total_limit",
			message: `Generated media exceeds the ${resolved.maxTotalMediaBytes} byte total media limit`,
		};
	}
	if (!isCanonicalBase64Range(data, range.start, range.end)) {
		return {
			ok: false,
			reason: "invalid_base64",
			message: "Generated media must contain valid base64",
		};
	}

	const base64 = data.slice(range.start, range.end);
	state.totalEncodedBytes += encodedBytes;
	return {
		ok: true,
		base64,
		encodedBytes,
		decodedBytes: imageBase64DecodedByteLength(base64),
	};
}

function isCanonicalBase64Range(
	base64: string,
	start: number,
	end: number,
): boolean {
	const length = end - start;
	if (length % 4 !== 0) {
		return false;
	}

	let paddingStart = end;
	if (
		length >= 2 &&
		base64.charCodeAt(end - 2) === 61 &&
		base64.charCodeAt(end - 1) === 61
	) {
		paddingStart -= 2;
	} else if (length >= 1 && base64.charCodeAt(end - 1) === 61) {
		paddingStart -= 1;
	}

	for (let i = start; i < paddingStart; i++) {
		if (!isBase64Char(base64.charCodeAt(i))) {
			return false;
		}
	}
	for (let i = paddingStart; i < end; i++) {
		if (base64.charCodeAt(i) !== 61) {
			return false;
		}
	}
	return true;
}

function startsWithDataScheme(
	data: string,
	start: number,
	end: number,
): boolean {
	return (
		end - start >= 5 &&
		(data.charCodeAt(start) | 32) === 100 &&
		(data.charCodeAt(start + 1) | 32) === 97 &&
		(data.charCodeAt(start + 2) | 32) === 116 &&
		(data.charCodeAt(start + 3) | 32) === 97 &&
		data.charCodeAt(start + 4) === 58
	);
}

function trimmedRange(data: string): { start: number; end: number } {
	let start = 0;
	let end = data.length;
	while (start < end && /\s/.test(data[start] ?? "")) {
		start += 1;
	}
	while (end > start && /\s/.test(data[end - 1] ?? "")) {
		end -= 1;
	}
	return { start, end };
}

function parseBase64DataUrlRange(
	data: string,
	start: number,
	end: number,
):
	| {
			mediaType: string;
			base64Start: number;
			base64End: number;
	  }
	| undefined {
	if (!startsWithDataScheme(data, start, end)) {
		return undefined;
	}
	const metadataStart = start + "data:".length;
	const commaIndex = data.indexOf(",", metadataStart);
	if (commaIndex === -1 || commaIndex >= end) {
		return undefined;
	}
	if (commaIndex - metadataStart > 128) {
		return undefined;
	}
	const metadata = data.slice(metadataStart, commaIndex).toLowerCase();
	const base64Marker = ";base64";
	if (!metadata.endsWith(base64Marker)) {
		return undefined;
	}
	const mediaType = metadata.slice(0, -base64Marker.length);
	if (!mediaType || mediaType.includes(";")) {
		return undefined;
	}
	return {
		mediaType,
		base64Start: commaIndex + 1,
		base64End: end,
	};
}

export function validateImageMedia(
	mediaType: string | undefined,
	data: string,
	limits: ImageMediaLimits = {},
): ImageMediaValidationResult {
	const maxEncodedBytes =
		limits.maxEncodedBytes ?? DEFAULT_MAX_IMAGE_ENCODED_BYTES;
	const maxDecodedBytes =
		limits.maxDecodedBytes ?? DEFAULT_MAX_IMAGE_DECODED_BYTES;
	const supportedMediaTypes = new Set(
		limits.supportedMediaTypes ?? SUPPORTED_IMAGE_MEDIA_TYPES,
	);

	let effectiveMediaType = mediaType?.toLowerCase();
	const range = trimmedRange(data);
	let base64Start = range.start;
	let base64End = range.end;
	const dataUrl = parseBase64DataUrlRange(data, range.start, range.end);
	if (dataUrl) {
		if (effectiveMediaType && effectiveMediaType !== dataUrl.mediaType) {
			return {
				ok: false,
				reason: "media_type_mismatch",
				message: `Image media type ${mediaType} does not match data URL type ${dataUrl.mediaType}`,
			};
		}
		effectiveMediaType = dataUrl.mediaType;
		base64Start = dataUrl.base64Start;
		base64End = dataUrl.base64End;
	}

	if (!effectiveMediaType || !supportedMediaTypes.has(effectiveMediaType)) {
		return {
			ok: false,
			reason: "unsupported_media_type",
			message: `Unsupported image media type: ${mediaType ?? "unknown"}`,
		};
	}

	const encodedBytes = base64End - base64Start;
	if (encodedBytes === 0) {
		return {
			ok: false,
			reason: "invalid_base64",
			message: "Image media must contain valid base64",
		};
	}

	if (encodedBytes > maxEncodedBytes) {
		return {
			ok: false,
			reason: "encoded_limit",
			message: `Image media exceeds the ${maxEncodedBytes} byte encoded limit`,
		};
	}

	if (!isCanonicalBase64Range(data, base64Start, base64End)) {
		return {
			ok: false,
			reason: "invalid_base64",
			message: "Image media must contain valid base64",
		};
	}

	const base64 = data.slice(base64Start, base64End);
	const decodedBytes = imageBase64DecodedByteLength(base64);
	if (decodedBytes > maxDecodedBytes) {
		return {
			ok: false,
			reason: "decoded_limit",
			message: `Image media exceeds the ${maxDecodedBytes} byte decoded limit`,
		};
	}

	return {
		ok: true,
		mediaType: effectiveMediaType,
		base64,
		encodedBytes,
		decodedBytes,
	};
}

export function validateAndReserveImageMedia(
	mediaType: string | undefined,
	data: string,
	budget: MediaBudgetOptions,
	state: MediaBudgetState,
): ImageMediaValidationResult {
	const validation = validateImageMedia(mediaType, data, {
		maxEncodedBytes: budget.maxImageEncodedBytes,
		maxDecodedBytes: budget.maxImageDecodedBytes,
	});
	if (!validation.ok) {
		recordOmittedImage(state, validation.reason);
		return validation;
	}

	const failure = reserveImageMediaBytes(
		validation.encodedBytes,
		validation.decodedBytes,
		budget,
		state,
	);
	if (failure) {
		return failure;
	}

	return validation;
}
