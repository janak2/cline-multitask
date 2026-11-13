import { describe, expect, it } from "vitest";
import {
	createMediaBudgetState,
	DEFAULT_MAX_IMAGE_DIMENSION_PX,
	GeneratedMediaSchema,
	imageBase64DecodedByteLength,
	imageBase64LengthForDecodedBytes,
	imageTooLargePlaceholder,
	isCanonicalBase64,
	oversizedImageDimensions,
	readImageDimensions,
	validateAndReserveBase64Media,
	validateAndReserveImageMedia,
	validateImageMedia,
} from "./media";

describe("generated media", () => {
	it("validates stable inline, remote, and artifact sources", () => {
		expect(
			GeneratedMediaSchema.parse({
				id: "media_inline",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
				sizeBytes: 5,
			}),
		).toMatchObject({ source: { type: "base64" } });
		expect(
			GeneratedMediaSchema.parse({
				id: "media_remote",
				modality: "audio",
				mediaType: "audio/mpeg",
				source: { type: "url", url: "https://example.com/result.mp3" },
			}),
		).toMatchObject({ source: { type: "url" } });
		expect(
			GeneratedMediaSchema.parse({
				id: "media_artifact",
				modality: "video",
				mediaType: "video/mp4",
				source: { type: "artifact", artifactId: "artifact_123" },
			}),
		).toMatchObject({ source: { type: "artifact" } });
	});

	it("rejects unsafe remote sources", () => {
		expect(
			GeneratedMediaSchema.safeParse({
				id: "unsafe",
				modality: "file",
				mediaType: "text/html",
				source: { type: "url", url: "javascript:alert(1)" },
			}).success,
		).toBe(false);
	});

	it("rejects media whose modality disagrees with its MIME type", () => {
		expect(
			GeneratedMediaSchema.safeParse({
				id: "mismatch",
				modality: "audio",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			}).success,
		).toBe(false);
	});
});

describe("media validation", () => {
	it("accepts raw canonical base64 for supported image types", () => {
		const result = validateImageMedia("image/png", "aGVsbG8=");

		expect(result).toMatchObject({
			ok: true,
			mediaType: "image/png",
			base64: "aGVsbG8=",
			encodedBytes: 8,
			decodedBytes: 5,
		});
	});

	it("accepts matching data URLs and returns raw base64", () => {
		const result = validateImageMedia(
			"image/png",
			"data:image/png;base64,aGVsbG8=",
		);

		expect(result).toMatchObject({
			ok: true,
			mediaType: "image/png",
			base64: "aGVsbG8=",
		});
	});

	it("accepts case-insensitive data URL schemes", () => {
		const result = validateImageMedia(
			"image/png",
			"DATA:image/png;base64,aGVsbG8=",
		);

		expect(result).toMatchObject({
			ok: true,
			mediaType: "image/png",
			base64: "aGVsbG8=",
		});
	});

	it("rejects MIME mismatches, unsupported types, malformed base64, and byte overflow", () => {
		expect(
			validateImageMedia("image/png", "data:image/jpeg;base64,/9j/"),
		).toMatchObject({ ok: false, reason: "media_type_mismatch" });
		expect(validateImageMedia("image/svg+xml", "PHN2Zz4=")).toMatchObject({
			ok: false,
			reason: "unsupported_media_type",
		});
		expect(validateImageMedia("image/png", "not-base64")).toMatchObject({
			ok: false,
			reason: "invalid_base64",
		});
		expect(
			validateImageMedia("image/png", "QUJDRA==", { maxEncodedBytes: 4 }),
		).toMatchObject({ ok: false, reason: "encoded_limit" });
		expect(
			validateImageMedia("image/png", "QUJDRA==", { maxDecodedBytes: 3 }),
		).toMatchObject({ ok: false, reason: "decoded_limit" });
	});

	it("rejects oversized encoded payloads before base64 syntax validation", () => {
		expect(
			validateImageMedia("image/png", "not-base64-and-too-long", {
				maxEncodedBytes: 4,
			}),
		).toMatchObject({ ok: false, reason: "encoded_limit" });
		expect(
			validateImageMedia("image/png", "data:image/png;base64,not-base64", {
				maxEncodedBytes: 4,
			}),
		).toMatchObject({ ok: false, reason: "encoded_limit" });
	});

	it("tracks aggregate media budget while reserving valid images", () => {
		const state = createMediaBudgetState();
		const first = validateAndReserveImageMedia(
			"image/png",
			"QUJDRA==",
			{ maxTotalMediaBytes: 8 },
			state,
		);
		const second = validateAndReserveImageMedia(
			"image/png",
			"QUJDRA==",
			{ maxTotalMediaBytes: 8 },
			state,
		);

		expect(first).toMatchObject({ ok: true });
		expect(second).toMatchObject({ ok: false, reason: "total_limit" });
		expect(state).toMatchObject({
			totalEncodedBytes: 8,
			keptImages: 1,
			omittedImages: 1,
			omittedReasons: { total_limit: 1 },
		});
	});

	it("computes decoded and encoded base64 sizes without decoding bytes", () => {
		expect(imageBase64DecodedByteLength("QUJDRA==")).toBe(4);
		expect(imageBase64LengthForDecodedBytes(4)).toBe(8);
	});

	it("checks canonical base64 strings without decoding bytes", () => {
		expect(isCanonicalBase64("QUJDRA==")).toBe(true);
		expect(isCanonicalBase64("not-base64")).toBe(false);
		expect(isCanonicalBase64("")).toBe(false);
	});

	it("validates non-image base64 and shares the aggregate media budget", () => {
		const state = createMediaBudgetState();
		const audio = validateAndReserveBase64Media(
			" aGVsbG8= ",
			{ maxTotalMediaBytes: 12 },
			state,
		);
		const video = validateAndReserveBase64Media(
			"QUJDRA==",
			{ maxTotalMediaBytes: 12 },
			state,
		);

		expect(audio).toEqual({
			ok: true,
			base64: "aGVsbG8=",
			encodedBytes: 8,
			decodedBytes: 5,
		});
		expect(video).toMatchObject({ ok: false, reason: "total_limit" });
		expect(state.totalEncodedBytes).toBe(8);
		expect(
			validateAndReserveBase64Media("not-base64", {}, state),
		).toMatchObject({ ok: false, reason: "invalid_base64" });
	});
});

it.each([
	"",
	"not a URL",
	"//example.com/image.png",
	"https://%",
])("rejects malformed remote media URLs without throwing: %s", (url) => {
	const result = GeneratedMediaSchema.safeParse({
		id: "invalid-url",
		modality: "image",
		mediaType: "image/png",
		source: { type: "url", url },
	});
	expect(result.success).toBe(false);
});

describe("image dimensions", () => {
	function pngHeader(width: number, height: number): Buffer {
		const header = Buffer.alloc(33);
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
		header.writeUInt32BE(13, 8);
		header.write("IHDR", 12, "ascii");
		header.writeUInt32BE(width, 16);
		header.writeUInt32BE(height, 20);
		return header;
	}

	function jpegHeader(width: number, height: number): Buffer {
		// SOI, an APP0 segment to skip, then a baseline start-of-frame.
		const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
		const sof = Buffer.alloc(11);
		sof.writeUInt16BE(0xffc0, 0);
		sof.writeUInt16BE(8, 2);
		sof[4] = 8;
		sof.writeUInt16BE(height, 5);
		sof.writeUInt16BE(width, 7);
		return Buffer.concat([
			Buffer.from([0xff, 0xd8]),
			app0,
			sof,
			Buffer.alloc(4),
		]);
	}

	it("reads PNG, JPEG, GIF and WebP sizes from raw bytes and base64", () => {
		expect(readImageDimensions(pngHeader(4400, 3400))).toEqual({
			width: 4400,
			height: 3400,
		});
		expect(readImageDimensions(pngHeader(800, 600).toString("base64"))).toEqual(
			{ width: 800, height: 600 },
		);
		expect(
			readImageDimensions(
				`data:image/png;base64,${pngHeader(10, 20).toString("base64")}`,
			),
		).toEqual({ width: 10, height: 20 });
		expect(readImageDimensions(jpegHeader(4200, 450))).toEqual({
			width: 4200,
			height: 450,
		});
		const gif = Buffer.alloc(10);
		gif.write("GIF89a", 0, "ascii");
		gif.writeUInt16LE(320, 6);
		gif.writeUInt16LE(240, 8);
		expect(readImageDimensions(gif)).toEqual({ width: 320, height: 240 });
		const webp = Buffer.alloc(30);
		webp.write("RIFF", 0, "ascii");
		webp.write("WEBP", 8, "ascii");
		webp.write("VP8X", 12, "ascii");
		webp.writeUIntLE(3999, 24, 3);
		webp.writeUIntLE(99, 27, 3);
		expect(readImageDimensions(webp)).toEqual({ width: 4000, height: 100 });
		expect(readImageDimensions(Buffer.from("not an image"))).toBeUndefined();
	});

	it("flags only images whose longest side exceeds the limit", () => {
		expect(oversizedImageDimensions(pngHeader(1290, 2796))).toBeUndefined();
		expect(oversizedImageDimensions(pngHeader(3000, 3000))).toBeUndefined();
		expect(oversizedImageDimensions(pngHeader(3001, 10))).toEqual({
			width: 3001,
			height: 10,
		});
		expect(oversizedImageDimensions(Buffer.from("unknown"))).toBeUndefined();
		expect(imageTooLargePlaceholder(4400, 3400)).toContain("4400x3400");
		expect(DEFAULT_MAX_IMAGE_DIMENSION_PX).toBe(3000);
	});
});
