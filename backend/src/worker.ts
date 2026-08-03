import { pool } from "./db";
import { startIndexer } from "./services/indexer";

const stopIndexer = startIndexer();
console.log("NeuralBazaar indexer worker started");

async function shutdown(signal: string) {
  console.log(`Indexer worker received ${signal}; shutting down`);
  stopIndexer();
  await pool.end();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
