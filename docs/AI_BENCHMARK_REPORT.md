# AI Benchmark and Evaluation Report

## Design

Benchmark requests are persisted in `benchmark_runs` with `queued`, `running`, `completed`, `not_available`, and `failed` states. `src/benchmarkWorker.ts` claims work independently of the HTTP process. The included worker reads only the signed upload manifest's artifact size and integrity metadata. It never imports a framework, deserializes a model, invokes inference, or executes an uploaded subprocess.

This is intentional: loading a model can execute Python pickle reducers, native extensions, custom operators, or shell helpers. Treating an untrusted model as a normal benchmark input would undo the upload security boundary.

## Current metrics

- Artifact size can be recorded from the signed manifest.
- Accuracy, precision, recall, F1, latency, memory, and inference speed are `NULL`/unavailable until an isolated runner is configured.
- The leaderboard only returns completed inference runs, so unavailable metadata runs cannot masquerade as performance results.

## Safe runner requirements

Before enabling `BENCHMARK_RUNNER_PATH`, deploy it outside the API process with:

1. rootless container or microVM, read-only model mount, no host socket, no cloud credentials, and default-deny egress;
2. CPU, memory, disk, wall-clock, file-count, and output-size limits;
3. SafeTensors/ONNX-only loading policy and disabled custom operators;
4. one-way job input and signed result output;
5. independent malware scanning, image SBOM/signing, patching, and audit logs;
6. queue retry/dead-letter behavior and tenant-level quotas.

The current API exposes the queue and history without pretending to provide measurements that have not been safely produced.

