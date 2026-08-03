import { config } from "../config";

function assertConfigured() {
  if (!config.pinataJwt) throw new Error("Pinata is not configured");
}

export async function pinFile(file: { buffer: Buffer; originalname: string; mimetype: string }) {
  assertConfigured();
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.pinataJwt}` },
    body
  });
  if (!response.ok) throw new Error(`Pinata file upload failed: ${await response.text()}`);
  return (await response.json()) as { IpfsHash: string; PinSize: number; Timestamp: string };
}

export async function pinJson(metadata: Record<string, unknown>) {
  assertConfigured();
  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.pinataJwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pinataContent: metadata })
  });
  if (!response.ok) throw new Error(`Pinata metadata upload failed: ${await response.text()}`);
  return (await response.json()) as { IpfsHash: string; Timestamp: string };
}
