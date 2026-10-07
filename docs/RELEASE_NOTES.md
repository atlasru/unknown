Atlas 1.1.0 — the file-first desktop workspace.

The interface has been rebuilt around Obsidian-style navigation: a narrow ribbon, hierarchical file explorer, temporary previews, pinned tabs, nested split groups, resizable/collapsible sidebars, fuzzy command/file palettes, context menus, keyboard focus navigation and a quiet status bar. Tabs can be reordered, moved and split with real drag and drop. Layouts and tab state persist separately for each investigation.

Overview is now a compact case briefing. Every Atlas 1.0 investigation capability remains accessible in a tab: graph/replay/path tracing, FTS queries, entity index, timeline, findings and review decisions, notebook, exact source/hex/provenance, integrity/history and complete exports.

The existing Obsidian folder importer is preserved. Imported Markdown now has a safe reading view with frontmatter, GFM, wikilinks/aliases, relative/heading links, outline and attachment navigation. Deduplication, source versions, original bytes/hashes and audited investigations remain compatible. The analysis engine and sandbox preload are byte-for-byte unchanged from 1.0; only the desktop host startup background changes.

Download the Windows **setup.exe**, or extract the Windows **ZIP** and run `Atlas.exe`. Linux: AppImage or portable tar.gz. Python and Node.js are not required. First launch opens **NORTHSTAR / 017**, the synthetic investigation.

Both Windows and Linux must pass 56 engine/API tests, 16 graph/workspace/read-queue tests, formatting/build checks, six source-desktop scenarios, the frozen PDF subprocess probe, and the same six scenarios against packaged production applications before this release can publish.

The production screenshot gallery contains actual captures from the verified packaged Linux application and capture/hash metadata. `SHA256SUMS.txt` covers all release assets. `verify_bundle.py` independently verifies exported investigations using Python's standard library.
