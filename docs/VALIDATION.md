# Validation

Atlas 1.1.0 verifies both the existing investigation engine and the new desktop workspace.

## Engine and API

56 tests cover indicator normalization and source positions; UTF-8/UTF-16/binary strings; PDF text, background-child import and parser failure; malformed PE headers and writable executable sections; encoded command derivation without execution; DNS relationship provenance; CSV column boundaries; timestamp normalization; FTS filters; changed-source versions; case isolation; notes/review persistence; restart; byte, record and audit tampering; escaped reports; export completeness; ZIP path traversal, expansion limits and nesting depth; symlinks; cancellation; import concurrency; network periodicity; authenticated HTTP boundaries; graph replay timestamps and full-range temporal aggregation.

Eleven workspace tests cover previews/pins, blank/reopened tabs, nested splits/pruning/moves, corrupt-state recovery, fuzzy search, Windows folders, source versions, archive lineage, imported-link resolution, Markdown AST/line offsets, and raw SHA-256 equality of every original engine/preload source. Three read-queue regressions simulate a server connection limit, prove that every burst result arrives, recover capacity after a failure, and cancel closed-tab reads without overbooking active connections. Two Node tests exercise deterministic Barnes–Hut convergence, finite positions, pin/unpin behavior, empty/single-node layouts and missing-edge handling.

## Desktop behavior

Playwright drives the actual Electron application, first from source and then from the unpacked production executable. Both Windows and Linux CI run six scenarios:

1. All original investigation flows: graph replay/path, exact provenance/hex/observations, FTS, timeline filters, review/dismiss/reopen, notebook, integrity/history/export, independent bundle verification, native import, cases and restart.
2. Keyboard workspace: Russian-layout shortcuts, previews/pins, new/cycle/close/reopen, nested splits/resizing, focus, context menus/real clipboard, sidebar search, per-case layout persistence and 1280 × 800 fit.
3. Obsidian folder import: nested Markdown/config/attachments, frontmatter, aliases/wikilinks/relative/heading links, GFM, exact original hashes/text, HTML/network exclusion, duplicate import, changed-source versions, export and restart.
4. Real mouse drag and drop: reorder, pinned-tab transfer, split at the requested edge and tree-file edge drop.
5. A 601-file vault: API pagination beyond 500, virtual tree keyboard navigation, 620-line source paging/jumps and full-source find.
6. Atlas 1.0 migration: existing hashes, notes, findings, history and counts remain unchanged after legacy preference migration and corrupted-layout fallback.

The packaged launch asserts `app.isPackaged` and application version 1.1.0. It uses the private frozen engine, not development Python. Production screenshots record the actual viewport, capture time, engine version, PNG SHA-256 and packaged `app.asar` SHA-256 in `docs/screenshots/production.json`. Source-mode screenshots go to a separate test output directory. The release gallery comes from the verified Linux CI application.

All 56 engine tests, 16 graph/workspace/read-queue tests, six source-desktop scenarios, six packaged-desktop scenarios and the frozen PDF probe passed locally. CI publishes only after the complete Windows and Linux pipelines, including both desktop passes, succeed. Diagnostic artifacts preserve screenshots and failure traces.

An additional frozen-engine probe generates a valid PDF, imports it through the authenticated API, verifies text/indicator extraction in the isolated compiled child process, checks original byte preservation and verifies clean shutdown. It runs on both Windows and Linux after sidecar packaging.

An exported bundle was also verified independently with `scripts/verify_bundle.py`.

## Measured corpus performance

Measurement in the implementation environment: Linux x86_64, Python 3.12.14. Results vary by CPU, storage, case composition and concurrent work. This is a reproducible measurement, not a product performance guarantee.

```bash
python scripts/benchmark.py --files 100 --events-per-file 500
```

| Workload | Value |
|---|---:|
| Original files | 100 |
| Original bytes | 7,037,900 |
| Timeline events | 50,000 |
| Unique entities | 10,100 |
| Stored evidence relationships | 150,100 |
| Import | 8.438 s |
| Overview aggregation | 0.2098 s |
| FTS search | 0.0017 s |
| Graph retrieval / temporal annotation | 0.6575 s |
| Integrity verification | 0.0115 s |
| Displayed graph | 1,600 nodes / 15,000 links |
| Import skips / integrity failures | 0 / 0 |

The graph is a bounded display subset. Path search and export use the full stored graph. Canvas frame rate and maximum-scale rendering were not measured on the user's laptop.
