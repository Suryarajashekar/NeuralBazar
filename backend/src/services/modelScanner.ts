import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { allowedModelExtensions, UploadValidationError } from "./uploadSecurity";

const suspiciousPatterns = [
  Buffer.from("#!/bin/sh"),
  Buffer.from("#!/bin/bash"),
  Buffer.from("powershell"),
  Buffer.from("cmd.exe"),
  Buffer.from("child_process"),
  Buffer.from("subprocess"),
  Buffer.from("os.system"),
  Buffer.from("eval("),
  Buffer.from("wget "),
  Buffer.from("curl "),
  Buffer.from("rm -rf"),
  Buffer.from("/bin/sh")
];
const archiveExtensions = new Set([".zip", ".tar", ".gz"]);

function runClamAv(filePath: string) {
  if (!config.clamavPath) return Promise.resolve<"not-configured" | "clean">("not-configured");
  return new Promise<"clean">((resolve, reject) => {
    const child = spawn(config.clamavPath, ["--no-summary", "--infected", filePath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) return resolve("clean");
      if (code === 1) return reject(new UploadValidationError("The upload was rejected by malware scanning"));
      reject(new Error(`Malware scanner failed${stderr ? `: ${stderr.slice(0, 200)}` : ""}`));
    });
  });
}

export async function scanModelFile(filePath: string, originalName: string, maxBytes: number) {
  if (!originalName || path.basename(originalName) !== originalName) throw new UploadValidationError("The uploaded filename is not valid");
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedModelExtensions.has(extension)) throw new UploadValidationError("Unsupported model file type");
  if (extension === ".pt" || extension === ".pth") throw new UploadValidationError("Pickle-based PyTorch files are not accepted; convert to SafeTensors or ONNX");

  let byteLength = 0;
  let tail = Buffer.alloc(0);
  const maxPatternLength = Math.max(...suspiciousPatterns.map(pattern => pattern.length));
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    if (byteLength > maxBytes) throw new UploadValidationError("The uploaded file exceeds the configured size limit");
    const window = Buffer.concat([tail, bytes]);
    const lowerWindow = window.toString("latin1").toLowerCase();
    if (byteLength === bytes.length && (window.subarray(0, 2).equals(Buffer.from("MZ")) || window.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))) {
      throw new UploadValidationError("Executable files are not accepted");
    }
    if (suspiciousPatterns.some(pattern => lowerWindow.includes(pattern.toString("latin1").toLowerCase()))) {
      throw new UploadValidationError("The upload contains a blocked executable or shell pattern");
    }
    if (archiveExtensions.has(extension) && (lowerWindow.includes("../") || lowerWindow.includes("..\\") || lowerWindow.includes("/etc/passwd"))) {
      throw new UploadValidationError("Archive path traversal content is not accepted");
    }
    tail = window.subarray(Math.max(0, window.length - maxPatternLength - 2));
  }

  const clamAv = await runClamAv(filePath);
  return { byteLength, scanner: clamAv === "clean" ? "heuristic-v1+clamav" : "heuristic-v1", status: "passed" as const };
}
