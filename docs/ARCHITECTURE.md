# Architecture

Atlas is a desktop application with three isolated layers.

| Layer | Technology | Responsibility |
|---|---|---|
| Renderer | React / TypeScript / Canvas | Investigation UX; no filesystem or Node access |
| Desktop host | Electron main / context-isolated preload | Dialogs, clipboard, process lifetime and constrained IPC |
| Analysis engine | Python / SQLite FTS5 / pypdf | Preservation, parsing, indexing, correlation, provenance and export |

## Evidence flow

An import records bounded original bytes under `evidence/<hash-prefix>/<sha256>`, with temporary-file write, fsync and atomic replacement. SQLite transactions atomically insert artifact metadata, extracted text, entities, occurrences, observed relationships, events, findings and the corresponding audit record. A case/path/hash uniqueness constraint makes repeat imports idempotent. Changed bytes at a known path produce an additional version.

ZIP members are read in memory and never extracted using archive-provided filesystem paths. Derived command text and archive members become separate artifacts linked to their parents. PDF parsing runs in a spawn subprocess with a wall-clock deadline; Unix also caps address space and CPU time. Parser failure preserves the original and records an explicit partial-analysis finding.

Imports run on a cancellable background thread. One import runs at a time. A lock serializes access to the shared SQLite connection, which uses WAL, foreign keys and transaction rollback. Normal desktop exit closes the sidecar's stdin, requests import cancellation and waits for checkpointed shutdown. Startup rejects databases with a newer schema version.

## Graph and search

Indicators deduplicate within a case by type/canonical value. Occurrences preserve source artifact, logical line, character offset and excerpt. DNS edges derive from structured records; URL/email host edges derive from parsed values. File-to-indicator edges mean observed mention. No speculative cross-file network relationships are fabricated.

A worker runs a deterministic Barnes–Hut quadtree approximation for repulsion and spring attraction for observed links. Typed-array snapshots transfer to the renderer. Canvas rendering handles inspection, neighbors, path highlighting and local camera interaction. Path search runs breadth-first over all stored case edges and returns the supporting source references.

Event replay gates timed graph nodes and links by their first observed source timestamp while retaining the full layout. Untimed context remains visible. The overview chooses adaptive UTC time buckets spanning the complete event range, rather than silently discarding older or later activity.

SQLite FTS5 handles safely quoted text/phrase terms. A small, explicit filter grammar generates parameterized SQL for extensions, names, hashes, entity types and open finding priorities.

Periodicity analysis groups timestamped observations by file and destination. At least six distinct timestamps, intervals between 5 and 3,600 seconds and coefficient of variation no greater than 0.12 produce an explained heuristic finding. Scheduled benign traffic can satisfy the same rule.

## Desktop boundary

The UI loads through the private `atlas://app/` protocol from packaged assets. Context isolation, process sandboxing and web security remain enabled. CSP disallows network connections, objects and inline scripts. Main blocks remote requests, navigation and new windows. Every IPC invocation checks the sender and main frame, then validates route and argument shape.

The engine binds only to `127.0.0.1` on a random OS-assigned port. A 256-bit random token stays in the main process. Requests require the bearer token, the exact loopback Host and no Origin. No CORS capability is advertised. Native import/export dialogs mediate normal filesystem operations. Test-only dialog overrides require an explicit environment flag.

## Audit and export

Every application-level investigation mutation appends a timestamp, action and canonical payload linked to the previous record's SHA-256. Verification recomputes the chain, hashes retained originals and compares evidence metadata with the import records. Export serializes all normalized tables plus originals and an HTML report into an atomically replaced ZIP. `scripts/verify_bundle.py` provides an independent standard-library implementation of these checks.

This is tamper detection against accidental or partial changes, not tamper prevention against an administrator who can rewrite the database and chain. There is no signing key, trusted timestamping service or network enrichment in Atlas 1.0.
