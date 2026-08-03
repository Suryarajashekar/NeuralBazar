import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config";

const MAGIC = Buffer.from("NBM1");
const FILE_IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function masterKey(): Buffer {
  if (!config.modelEncryptionKey) throw new Error("MODEL_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(config.modelEncryptionKey, "base64");
  if (key.length !== 32) throw new Error("MODEL_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

function toBase64(value: Buffer) {
  return value.toString("base64");
}

function fromBase64(value: string) {
  return Buffer.from(value, "base64");
}

function wrapDataKey(dataKey: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return JSON.stringify({ v: 1, iv: toBase64(iv), tag: toBase64(cipher.getAuthTag()), ciphertext: toBase64(ciphertext) });
}

export function unwrapDataKey(wrappedKey: string) {
  const envelope = JSON.parse(wrappedKey) as { v: number; iv: string; tag: string; ciphertext: string };
  if (envelope.v !== 1) throw new Error("Unsupported model key envelope");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), fromBase64(envelope.iv));
  decipher.setAuthTag(fromBase64(envelope.tag));
  return Buffer.concat([decipher.update(fromBase64(envelope.ciphertext)), decipher.final()]);
}

export async function encryptStagedFile(inputPath: string, outputPath: string) {
  const dataKey = randomBytes(32);
  const fileIv = randomBytes(FILE_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, fileIv);
  const header = Buffer.concat([MAGIC, fileIv]);
  const digest = createHash("sha256");
  let byteLength = header.length;
  digest.update(header);

  const encryptor = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const encrypted = cipher.update(chunk);
        digest.update(encrypted);
        byteLength += encrypted.length;
        callback(null, encrypted);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        const finalBytes = Buffer.concat([cipher.final(), cipher.getAuthTag()]);
        digest.update(finalBytes);
        byteLength += finalBytes.length;
        callback(null, finalBytes);
      } catch (error) {
        callback(error as Error);
      }
    }
  });

  const output = createWriteStream(outputPath);
  output.write(header);
  await pipeline(createReadStream(inputPath), encryptor, output);
  return { wrappedKey: wrapDataKey(dataKey), encryptionIv: toBase64(fileIv), sha256: digest.digest("hex"), byteLength };
}

export function createDecryptTransform(dataKey: Buffer, expectedIv: Buffer) {
  let header = Buffer.alloc(0);
  let pending = Buffer.alloc(0);
  let decipher: import("node:crypto").DecipherGCM | undefined;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let bytes = Buffer.from(chunk);
        if (!decipher) {
          header = Buffer.concat([header, bytes]);
          if (header.length < MAGIC.length + FILE_IV_BYTES) return callback();
          const magic = header.subarray(0, MAGIC.length);
          const fileIv = header.subarray(MAGIC.length, MAGIC.length + FILE_IV_BYTES);
          if (!magic.equals(MAGIC) || !fileIv.equals(expectedIv)) throw new Error("Encrypted model header is invalid");
          decipher = createDecipheriv("aes-256-gcm", dataKey, fileIv) as import("node:crypto").DecipherGCM;
          bytes = header.subarray(MAGIC.length + FILE_IV_BYTES);
        }

        pending = Buffer.concat([pending, bytes]);
        if (pending.length <= AUTH_TAG_BYTES) return callback();
        const ciphertext = pending.subarray(0, pending.length - AUTH_TAG_BYTES);
        pending = pending.subarray(pending.length - AUTH_TAG_BYTES);
        callback(null, decipher.update(ciphertext));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (!decipher || pending.length !== AUTH_TAG_BYTES) throw new Error("Encrypted model is truncated");
        decipher.setAuthTag(pending);
        callback(null, decipher.final());
      } catch (error) {
        callback(error as Error);
      }
    }
  });
}
