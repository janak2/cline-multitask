import {
	closeSync,
	fstatSync,
	openSync,
	readSync,
	realpathSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";

export const PROJECT_IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;

export function readLocalProjectImage(root: string, path: string) {
	const resolved = realpathSync(path);
	const rel = relative(realpathSync(root), resolved);
	if (
		rel === ".." ||
		rel.startsWith("../") ||
		rel.startsWith("..\\") ||
		isAbsolute(rel)
	)
		throw new Error("Image is outside the workspace");
	const fd = openSync(resolved, "r");
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) throw new Error("Not an image file");
		if (stat.size > PROJECT_IMAGE_LIMIT_BYTES)
			throw new Error("Image preview is limited to 5 MB");
		const bytes = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const count = readSync(fd, bytes, length, bytes.length - length, null);
			if (!count) break;
			length += count;
		}
		if (length !== stat.size) throw new Error("Image changed while reading");
		const data = bytes.subarray(0, length);
		let width = 0,
			height = 0,
			mimeType = "";
		if (
			data.length >= 24 &&
			data
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
			data.toString("ascii", 12, 16) === "IHDR"
		) {
			width = data.readUInt32BE(16);
			height = data.readUInt32BE(20);
			mimeType = "image/png";
		}
		if (data[0] === 0xff && data[1] === 0xd8) {
			let offset = 2;
			while (offset + 4 <= data.length) {
				if (data[offset++] !== 0xff) break;
				while (data[offset] === 0xff) offset++;
				const marker = data[offset++];
				if (marker === 0xda || marker === 0xd9) break;
				if (offset + 2 > data.length) break;
				const size = data.readUInt16BE(offset);
				if (size < 2 || offset + size > data.length) break;
				if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
					height = data.readUInt16BE(offset + 3);
					width = data.readUInt16BE(offset + 5);
					mimeType = "image/jpeg";
					break;
				}
				offset += size;
			}
		}
		if (data.length >= 13 && /^GIF8[79]a$/.test(data.toString("ascii", 0, 6))) {
			width = data.readUInt16LE(6);
			height = data.readUInt16LE(8);
			let offset = 13 + (data[10] & 0x80 ? 3 * (2 << (data[10] & 7)) : 0);
			let frames = 0;
			while (offset < data.length && data[offset] !== 0x3b) {
				const block = data[offset++];
				if (block === 0x2c) {
					if (++frames > 1)
						throw new Error("Animated GIF images are not supported");
					if (offset + 9 > data.length) throw new Error("Invalid GIF image");
					const frameWidth = data.readUInt16LE(offset + 4);
					const frameHeight = data.readUInt16LE(offset + 6);
					if (
						data.readUInt16LE(offset) + frameWidth > width ||
						data.readUInt16LE(offset + 2) + frameHeight > height
					)
						throw new Error("Invalid GIF dimensions");
					const packed = data[offset + 8];
					offset += 9 + (packed & 0x80 ? 3 * (2 << (packed & 7)) : 0) + 1;
				} else if (block === 0x21) offset++;
				else throw new Error("Invalid GIF image");
				let size: number;
				do {
					if (offset >= data.length) throw new Error("Invalid GIF image");
					size = data[offset++];
					offset += size;
				} while (size);
			}
			if (frames !== 1 || data[offset] !== 0x3b)
				throw new Error("Invalid GIF image");
			mimeType = "image/gif";
		}
		if (
			data.length >= 30 &&
			data.toString("ascii", 0, 4) === "RIFF" &&
			data.toString("ascii", 8, 12) === "WEBP"
		) {
			if (data.readUInt32LE(4) + 8 !== data.length)
				throw new Error("Invalid WebP image");
			let frames = 0;
			for (let offset = 12; offset < data.length; ) {
				if (offset + 8 > data.length) throw new Error("Invalid WebP image");
				const chunk = data.toString("ascii", offset, offset + 4);
				const size = data.readUInt32LE(offset + 4);
				const start = offset + 8;
				if (start + size + (size & 1) > data.length)
					throw new Error("Invalid WebP image");
				let w = 0,
					h = 0;
				if (chunk === "ANIM" || chunk === "ANMF")
					throw new Error("Animated WebP images are not supported");
				if (chunk === "VP8X" && size === 10) {
					if (data[start] & 2)
						throw new Error("Animated WebP images are not supported");
					w = 1 + data.readUIntLE(start + 4, 3);
					h = 1 + data.readUIntLE(start + 7, 3);
				} else if (
					chunk === "VP8 " &&
					size >= 10 &&
					data
						.subarray(start + 3, start + 6)
						.equals(Buffer.from([0x9d, 1, 0x2a]))
				) {
					w = data.readUInt16LE(start + 6) & 0x3fff;
					h = data.readUInt16LE(start + 8) & 0x3fff;
					frames++;
				} else if (chunk === "VP8L" && size >= 5 && data[start] === 0x2f) {
					const bits = data.readUInt32LE(start + 1);
					w = 1 + (bits & 0x3fff);
					h = 1 + ((bits >>> 14) & 0x3fff);
					frames++;
				}
				width = Math.max(width, w);
				height = Math.max(height, h);
				offset = start + size + (size & 1);
			}
			if (width * height > MAX_PIXELS || width > 8192 || height > 8192)
				throw new Error("Image dimensions exceed the preview limit");
			if (frames !== 1) throw new Error("Invalid WebP image");
			mimeType = "image/webp";
		}
		if (!width || !height || !mimeType)
			throw new Error(
				"Only PNG, JPEG, static GIF and static WebP images are supported",
			);
		if (width * height > MAX_PIXELS || width > 8192 || height > 8192)
			throw new Error("Image dimensions exceed the preview limit");
		return { contentBase64: data.toString("base64"), mimeType };
	} finally {
		closeSync(fd);
	}
}
