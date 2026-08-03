import { processOneBenchmark } from "./services/benchmark";
import { pool } from "./db";

let active = true;
async function loop() {
  while (active) {
    const processed = await processOneBenchmark();
    if (!processed) await new Promise(resolve => setTimeout(resolve, 1_000));
  }
}
void loop().catch(error => { console.error("Benchmark worker failed", error); active = false; });
process.once("SIGTERM", () => { active = false; void pool.end(); });

