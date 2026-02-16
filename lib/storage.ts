import fs from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const R2_BUCKET = (process.env.R2_BUCKET || "").trim();
const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || "").trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || "").trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const R2_KEY_PREFIX = (process.env.R2_KEY_PREFIX || "uploads").trim().replace(/^\/+|\/+$/g, "");
const R2_ENDPOINT = (
  process.env.R2_ENDPOINT || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "")
).trim();

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

let r2Client: S3Client | null = null;

function isR2Configured(): boolean {
  return Boolean(R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error("r2_not_configured");
  }
  if (r2Client) return r2Client;
  r2Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
  return r2Client;
}

function toStorageUrl(objectKey: string): string {
  const encoded = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/storage/${encoded}`;
}

function toObjectKey(fileExt: string): string {
  const filename = `${crypto.randomUUID()}${fileExt}`;
  return R2_KEY_PREFIX ? `${R2_KEY_PREFIX}/${filename}` : filename;
}

export async function saveUpload(file: File, options?: SaveUploadOptions) {
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
  if (isR2Configured()) {
    const client = getR2Client();
    const objectKey = toObjectKey(ext);
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
        Body: buffer,
        ContentType: mime
      })
    );
    return toStorageUrl(objectKey);
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, buffer);
  return `/uploads/${filename}`;
}

function parseStorageObjectKey(publicUrl: string): string | null {
  if (publicUrl.startsWith("/api/storage/")) {
    const encodedKey = publicUrl.slice("/api/storage/".length);
    if (!encodedKey) return null;
    return encodedKey
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  }
  return null;
}

export async function deleteUpload(publicUrl: string | null | undefined) {
  if (!publicUrl) return;
  const r2Key = parseStorageObjectKey(publicUrl);
  if (r2Key) {
    if (!isR2Configured()) return;
    const client = getR2Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key
      })
    );
    return;
  }

  if (publicUrl.startsWith("/uploads/")) {
    const filename = path.basename(publicUrl);
    const fullPath = path.join(UPLOAD_DIR, filename);
    if (!fullPath.startsWith(UPLOAD_DIR)) return;
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

export async function readR2Upload(objectKey: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
}> {
  if (!isR2Configured()) {
    throw new Error("r2_not_configured");
  }
  const client = getR2Client();
  const object = await client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey
    })
  );
  if (!object.Body) {
    throw new Error("object_not_found");
  }

  let stream: ReadableStream<Uint8Array>;
  const body: any = object.Body;
  if (typeof body.transformToWebStream === "function") {
    stream = body.transformToWebStream();
  } else if (body instanceof Readable) {
    stream = Readable.toWeb(body) as ReadableStream<Uint8Array>;
  } else {
    throw new Error("unsupported_body_stream");
  }

  return {
    stream,
    contentType: object.ContentType || "application/octet-stream",
    contentLength: typeof object.ContentLength === "number" ? object.ContentLength : null
  };
}
