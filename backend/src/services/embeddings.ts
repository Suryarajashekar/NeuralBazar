import { createHash } from "node:crypto";

export const EMBEDDING_DIMENSIONS = 32;

// A deterministic, dependency-free baseline for local deployments. It keeps
// search reproducible and private; operators can replace it with a real
// embedding provider behind the same interface when EMBEDDING_MODEL changes.
export function textEmbedding(value: string) {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  for (const token of value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const digest = createHash("sha256").update(token).digest();
    for (let index = 0; index < vector.length; index += 1) vector[index] += (digest[index] / 255) * 2 - 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => Number((value / magnitude).toFixed(8)));
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return dot / ((Math.sqrt(leftMagnitude) || 1) * (Math.sqrt(rightMagnitude) || 1));
}

