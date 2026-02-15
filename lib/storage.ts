import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov"
};

type SaveUploadOptions = {
  allowedMimeTypes?: string[];
};

export async function saveUpload(file: File, options?: SaveUploadOptions) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const mime = (file.type || "").toLowerCase();
  const allowed = options?.allowedMimeTypes;
  if (!mime || !MIME_EXTENSION_MAP[mime]) {
    throw new Error("invalid_file_type");
  }
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(mime)) {
    throw new Error("invalid_file_type");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = MIME_EXTENSION_MAP[mime];
  const filename = `${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, buffer);
  return `/uploads/${filename}`;
}

export function deleteUpload(publicUrl: string | null | undefined) {
  if (!publicUrl || !publicUrl.startsWith("/uploads/")) return;
  const filename = path.basename(publicUrl);
  const fullPath = path.join(UPLOAD_DIR, filename);
  if (!fullPath.startsWith(UPLOAD_DIR)) return;
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}
