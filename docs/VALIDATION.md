# Validation

Atlas 1.0.0 uses behavioral tests and a complete desktop investigation scenario.

## Engine and API

56 tests cover indicator normalization and source positions; UTF-8/UTF-16/binary strings; PDF text, background-child import and parser failure; malformed PE headers and writable executable sections; encoded command derivation without execution; DNS relationship provenance; CSV column boundaries; timestamp normalization; FTS filters; changed-source versions; case isolation; notes/review persistence; restart; byte, record and audit tampering; escaped reports; export completeness; ZIP path traversal, expansion limits and nesting depth; symlinks; cancellation; import concurrency; network periodicity; authenticated HTTP boundaries; graph replay timestamps and full-range temporal aggregation.

Two Node tests exercise deterministic Barnes–Hut convergence, finite positions, pin/unpin behavior, empty/single-node layouts and missing-edge handling.

## Desktop behavior

Playwright drives the actual Electron application, first from source and then from the unpacked packaged executable. The same scenario runs in Windows and Linux CI:

1. Launch into the synthetic investigation and verify the corpus count.
2. Play/pause graph replay; select a domain; follow provenance into a highlighted source line.
3. Query decoded commands and inspect their content.
4. Filter authentication events and jump to a source line.
5. Mark a finding reviewed and confirm it moves into the reviewed filter.
6. Append an analyst conclusion, verify integrity and export a complete bundle.
7. Import an additional local file and confirm it appears in the vault.
8. Create an isolated empty case, switch back and use the command palette.
9. Restart and confirm the imported entities, selected page and notes persist.

The packaged pass uses the private frozen engine, not the development Python interpreter. CI publishes binaries only after both platform jobs, including these packaged passes, succeed. Screenshots and failure traces are uploaded as workflow artifacts.

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
