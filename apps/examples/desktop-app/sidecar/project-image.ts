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
		if (!width || !height || !mimeType)
			throw new Error("Only PNG and JPEG images are supported");
		if (width * height > MAX_PIXELS || width > 8192 || height > 8192)
			throw new Error("Image dimensions exceed the preview limit");
		return { contentBase64: data.toString("base64"), mimeType };
	} finally {
		closeSync(fd);
	}
}
