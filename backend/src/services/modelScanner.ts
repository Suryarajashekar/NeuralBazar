import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { allowedModelExtensions, UploadValidationError } from "./uploadSecurity";

type FindingSeverity = "critical" | "high" | "medium" | "low";
export type SecurityFinding = { code: string; severity: FindingSeverity; title: string; evidence: string };

const suspiciousPatterns: Array<{ code: string; severity: FindingSeverity; title: string; patterns: Buffer[] }> = [
  { code: "REVERSE_SHELL", severity: "critical", title: "Reverse-shell payload detected", patterns: [Buffer.from("/dev/tcp/"), Buffer.from("bash -i"), Buffer.from("nc -e"), Buffer.from("socat "), Buffer.from("pty.spawn"), Buffer.from("socket.socket")] },
  { code: "ARBITRARY_CODE_EXECUTION", severity: "critical", title: "Arbitrary code-execution pattern detected", patterns: [Buffer.from("os.system"), Buffer.from("subprocess.popen"), Buffer.from("child_process"), Buffer.from("eval("), Buffer.from("exec("), Buffer.from("__import__("), Buffer.from("__reduce__")] },
  { code: "SUSPICIOUS_IMPORT", severity: "high", title: "Suspicious runtime import detected", patterns: [Buffer.from("import subprocess"), Buffer.from("from subprocess"), Buffer.from("import ctypes"), Buffer.from("import marshal"), Buffer.from("import dill"), Buffer.from("import pickle"), Buffer.from("torch.load(")] },
  { code: "CRYPTO_MINER", severity: "high", title: "Cryptocurrency miner indicator detected", patterns: [Buffer.from("stratum+tcp"), Buffer.from("xmrig"), Buffer.from("cpuminer"), Buffer.from("minerd"), Buffer.from("cryptonight"), Buffer.from("hashrate"), Buffer.from("monero")] },
  { code: "SHELL_PAYLOAD", severity: "high", title: "Shell or downloader payload detected", patterns: [Buffer.from("#!/bin/sh"), Buffer.from("#!/bin/bash"), Buffer.from("powershell"), Buffer.from("cmd.exe"), Buffer.from("wget "), Buffer.from("curl "), Buffer.from("rm -rf"), Buffer.from("/bin/sh")] }
];
const archiveExtensions = new Set([".zip", ".tar", ".gz"]);
const severityRisk: Record<FindingSeverity, number> = { critical: 100, high: 50, medium: 15, low: 5 };

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
  const digest = createHash("sha256");
  const findings = new Map<string, SecurityFinding>();
  let watermarkDetected = false;
  let tail = Buffer.alloc(0);
  const maxPatternLength = Math.max(...suspiciousPatterns.flatMap(group => group.patterns.map(pattern => pattern.length)), 32);
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    digest.update(bytes);
    if (byteLength > maxBytes) throw new UploadValidationError("The uploaded file exceeds the configured size limit");
    const window = Buffer.concat([tail, bytes]);
    const lowerWindow = window.toString("latin1").toLowerCase();
    if (byteLength === bytes.length && (window.subarray(0, 2).equals(Buffer.from("MZ")) || window.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))) {
      findings.set("EXECUTABLE_FILE", { code: "EXECUTABLE_FILE", severity: "critical", title: "Executable file signature detected", evidence: "MZ/ELF magic bytes" });
    }
    if (window.indexOf(Buffer.from([0x80, 0x04])) >= 0 || lowerWindow.includes("stack_global") || lowerWindow.includes("global(")) {
      findings.set("PICKLE_PAYLOAD", { code: "PICKLE_PAYLOAD", severity: "critical", title: "Pickle serialization payload detected", evidence: "pickle opcode or GLOBAL/STACK_GLOBAL marker" });
    }
    for (const group of suspiciousPatterns) {
      const match = group.patterns.find(pattern => lowerWindow.includes(pattern.toString("latin1").toLowerCase()));
      if (match) findings.set(group.code, { code: group.code, severity: group.severity, title: group.title, evidence: match.toString("latin1") });
    }
    if (archiveExtensions.has(extension) && (lowerWindow.includes("../") || lowerWindow.includes("..\\") || lowerWindow.includes("/etc/passwd"))) {
      findings.set("ARCHIVE_TRAVERSAL", { code: "ARCHIVE_TRAVERSAL", severity: "critical", title: "Archive path traversal content detected", evidence: "../, ..\\, or /etc/passwd marker" });
    }
    if (lowerWindow.includes("stratum") || lowerWindow.includes("data:text/") || lowerWindow.includes("base64 -d") || lowerWindow.includes("powershell -enc")) {
      findings.set("HIDDEN_PAYLOAD", { code: "HIDDEN_PAYLOAD", severity: "high", title: "Hidden or encoded payload indicator detected", evidence: "stratum/data URI/base64 decode/encoded PowerShell marker" });
    }
    if (lowerWindow.includes("watermark") || lowerWindow.includes("model_card") || lowerWindow.includes("copyright")) watermarkDetected = true;
    tail = window.subarray(Math.max(0, window.length - maxPatternLength - 2));
  }

  const clamAv = await runClamAv(filePath);
  if (clamAv === "not-configured") findings.set("CLAMAV_NOT_CONFIGURED", { code: "CLAMAV_NOT_CONFIGURED", severity: "medium", title: "ClamAV was not configured", evidence: "heuristic scanner only" });
  const findingsList = [...findings.values()];
  const risk = Math.min(100, findingsList.reduce((sum, finding) => sum + severityRisk[finding.severity], 0));
  const securityScore = Math.max(0, 100 - risk);
  const hasBlockingFinding = findingsList.some(finding => finding.severity === "critical" || finding.severity === "high");
  const verifiedSafe = !hasBlockingFinding && securityScore >= config.modelSecurityScoreThreshold;
  return {
    byteLength,
    sha256: digest.digest("hex"),
    scanner: clamAv === "clean" ? "heuristic-v2+clamav" : "heuristic-v2",
    status: verifiedSafe ? "passed" as const : "rejected" as const,
    securityStatus: verifiedSafe ? "verified_safe" as const : "rejected" as const,
    verifiedSafe,
    securityScore,
    watermarkDetected,
    findings: findingsList,
    riskReport: { riskScore: risk, securityScore, findings: findingsList, scannerVersion: clamAv === "clean" ? "heuristic-v2+clamav" : "heuristic-v2" }
  };
}
