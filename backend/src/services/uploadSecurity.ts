import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

export const allowedModelExtensions = new Set([
  ".zip",
  ".tar",
  ".gz",
  ".onnx",
  ".pt",
  ".pth",
  ".safetensors",
  ".csv",
  ".parquet",
  ".json"
]);

export class UploadValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export async function inspectStagedFile(filePath: string, originalName: string, maxBytes: number) {
  if (!originalName || path.basename(originalName) !== originalName) {
    throw new UploadValidationError("The uploaded filename is not valid");
  }

  const extension = path.extname(originalName).toLowerCase();
  if (!allowedModelExtensions.has(extension)) {
    throw new UploadValidationError("Unsupported model file type");
  }

  const digest = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maxBytes) {
      throw new UploadValidationError("The uploaded file exceeds the configured size limit");
    }
    digest.update(bytes);
  }

  return { extension, byteLength, sha256: digest.digest("hex") };
}
