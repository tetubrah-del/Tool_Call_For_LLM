import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function saveUpload(file: File) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || "";
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
