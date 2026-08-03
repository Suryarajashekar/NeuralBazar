import { config } from "../config";
import { createReadStream } from "node:fs";
import FormData from "form-data";

function assertConfigured() {
  if (!config.pinataJwt) throw new Error("Pinata is not configured");
}

export async function pinFileFromPath(file: { path: string; originalname: string; mimetype: string }) {
  assertConfigured();
  const body = new FormData();
  body.append("file", createReadStream(file.path), { filename: file.originalname, contentType: file.mimetype || "application/octet-stream" });
  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.pinataJwt}`, ...body.getHeaders() },
    body: body as unknown as BodyInit,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  if (!response.ok) throw new Error("Pinata file upload failed");
  return (await response.json()) as { IpfsHash: string; PinSize: number; Timestamp: string };
}

export async function pinJson(metadata: Record<string, unknown>) {
  assertConfigured();
  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.pinataJwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: metadata })
  });
  if (!response.ok) throw new Error("Pinata metadata upload failed");
  return (await response.json()) as { IpfsHash: string; Timestamp: string };
}
