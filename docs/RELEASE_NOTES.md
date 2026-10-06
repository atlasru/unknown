Atlas 1.0.0 — a complete local evidence workbench for Windows and Linux.

Download the Windows **setup.exe** for installation, or extract the Windows **ZIP** and run `Atlas.exe`. Linux: AppImage or portable tar.gz. Packaged applications include their analysis engine; Python and Node.js are not required.

The first launch opens **NORTHSTAR / 017**, a synthetic investigation ready to explore.

- Preserved original bytes, SHA-256 evidence storage, source versions and integrity verification.
- Text/log/JSONL/CSV/EML/PDF, executable strings, PE metadata, nested ZIPs and encoded-command analysis.
- Interactive provenance graph with worker-based Barnes–Hut layout, path tracing and event replay.
- Full-text queries, UTC timeline, explained heuristic findings, notes and review decisions.
- Portable evidence bundles with complete JSON, original bytes and an HTML report.
- Sandboxed local desktop UI and authenticated private engine.

Both Windows and Linux builds run engine/API tests, layout tests and the complete investigation scenario against source and packaged applications before release. `SHA256SUMS.txt` lists asset checksums. `verify_bundle.py` independently verifies exported investigations using Python's standard library.

Atlas performs static analysis and does not contact extracted infrastructure. Findings support analyst review; they are not malware verdicts. Read the repository's field guide and documented analysis limits.
