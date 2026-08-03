# Research Contribution and Reproducibility Report

NeuralBazaar now has a durable research-artifact registry for federated learning, ZK ownership attestations, differential privacy, explainability, carbon accounting, lineage, and reproducibility. It also records cross-chain deployments, DAO proposals, and compute-provider listings.

These records create a stable provenance surface without falsely asserting that a proof, training round, carbon measurement, or external-chain transaction has been independently verified. Each artifact carries an explicit status and JSON payload so an external verifier, proof system, or research pipeline can attach evidence later.

Recommended next research integrations:

- replace the local-hash embedding baseline with a privacy-reviewed embedding model;
- attach signed dataset manifests, training code commits, environment lockfiles, and reproducible seeds;
- add an actual ZK circuit/verifier for ownership claims;
- add federated coordinator attestation and differential-privacy accountant outputs;
- bind carbon measurements to a documented hardware/grid methodology;
- add chain-specific finality and proof verification before marking cross-chain records verified.

