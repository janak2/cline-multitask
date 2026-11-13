import { extname } from "node:path";

/**
 * Documents, images and media a code editor cannot show properly. These open
 * in the user's default app for the file type (e.g. a PDF viewer), not in the
 * first code editor found on PATH.
 */
const SYSTEM_DEFAULT_APP_EXTENSIONS = new Set([
	".pdf",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".tif",
	".tiff",
	".heic",
	".heif",
	".avif",
	".ico",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".odt",
	".ods",
	".odp",
	".rtf",
	".epub",
	".mp3",
	".wav",
	".ogg",
	".flac",
	".m4a",
	".mp4",
	".mov",
	".mkv",
	".webm",
	".avi",
	".zip",
	".tar",
	".gz",
	".7z",
]);

export function opensInSystemDefaultApp(filePath: string): boolean {
	return SYSTEM_DEFAULT_APP_EXTENSIONS.has(extname(filePath).toLowerCase());
}
