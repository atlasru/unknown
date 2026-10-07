# Atlas 1.1 workspace

The desktop is organized around files and tab groups. Atlas investigation tools are ordinary tabs in the same workspace. Overview is a short case document, not an operations dashboard. The analysis engine, source storage, import behavior and IPC boundary remain those of Atlas 1.0.

## Reference

The redesign follows the current official Obsidian desktop documentation, reviewed for this release:

- [Tabs](https://help.obsidian.md/tabs): tab groups, drag and drop, split right/down, resizing, pinning and keyboard switching.
- [Sidebar](https://help.obsidian.md/sidebar): collapsible, resizable sidebars with icon tabs.
- [Ribbon](https://help.obsidian.md/ribbon) and [Status bar](https://help.obsidian.md/status-bar): narrow persistent tools and quiet workspace information.
- [File explorer](https://help.obsidian.md/plugins/file-explorer): hierarchical folders and contextual file navigation.
- [Command palette](https://help.obsidian.md/plugins/command-palette) and [Quick switcher](https://help.obsidian.md/plugins/quick-switcher): fuzzy keyboard navigation.

The reference informs layout and interactions. Atlas remains an evidence workbench: imported originals are preserved, not editable notes; case mutations still pass through the existing audited engine.

## Information architecture

| Location | Content and actions |
| --- | --- |
| Left ribbon | File switcher, search, graph, timeline, notebook, command palette, import, export, guide |
| Left sidebar | Files/Search tabs, hierarchical source tree, import files/folder, Overview, collapsible Atlas views, case switcher and new investigation |
| Center | Independently selected tabs in nested horizontal/vertical groups; documents and every investigation tool share the same layout |
| Right sidebar | Properties, Connections, Outline and Observations for the active document or selected graph node |
| Status bar | Local engine/import status, cancellation/details, file/entity/event counts, UTC and application version |
| Overview | Case briefing, four compact counts, activity summary, recent sources, observed connections and integrity shortcut |

The palette and New tab page expose all Atlas tools. Evidence vault remains available as the full FTS/filter/paginated table alongside the file explorer.

## Interactions

- Single-click a tree file to use a temporary preview. Another single-click replaces only an unpinned preview. Double-click, Ctrl-click, middle-click or Ctrl+Enter in the switcher keeps a tab open.
- Pin a tab from its context menu or the palette. Pinned tabs survive bulk close operations. Explicit Close still works.
- Drag tabs to reorder, move between groups or split at the left/right/top/bottom edge. Drag a tree file into a group or its edge to open it there.
- Split commands duplicate the selected tab and its view state. Closing or moving the last tab prunes the empty group without discarding neighboring tabs.
- Resize group dividers and either sidebar with a pointer or arrow keys. Tab strips support arrow/Home/End navigation; the tree supports arrows, Enter, Home/End, Page Up/Down and Shift+F10.
- Context menus support keyboard selection, Escape and focus restoration. Modal palettes trap focus and restore the active group.
- Per-case layouts, pins, filters, drafts, sidebar visibility/widths and expanded folders persist. Damaged layout JSON falls back to a usable workspace without touching investigation data.

## Keyboard

| Shortcut | Action |
| --- | --- |
| Ctrl+P / Ctrl+K | Command palette |
| Ctrl+O | File quick switcher |
| Ctrl+T / Ctrl+W / Ctrl+Shift+T | New / close / reopen tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1…8 / Ctrl+9 | Numbered / last tab |
| Ctrl+Backslash / Ctrl+Shift+Backslash | Split right / down |
| Ctrl+Alt+Arrow | Focus next / previous group |
| Ctrl+Shift+L / Ctrl+Shift+R | Toggle left / right sidebar |
| Ctrl+Shift+E / Ctrl+Shift+F | Focus explorer / search all evidence |
| Ctrl+F | Find across the complete retained source text |
| Ctrl+Shift+I / Ctrl+Alt+I | Import files / folder or Obsidian vault |
| Shift+F10 | Focused file/folder/tab context menu |

Letter shortcuts use physical key codes, including on a Russian keyboard layout. On macOS the implementation accepts the Command modifier, although this release packages Windows and Linux.

## Obsidian import and documents

The original folder-import engine is unchanged. Nested Markdown, attachments, hidden configuration files, unchanged-source deduplication, changed-byte versions and original hashes continue to use the same schema and limits. Windows paths normalize only for renderer navigation; retained source paths and bytes remain intact.

Markdown opens in reading view with GFM tables/tasks, YAML frontmatter, wikilinks/aliases, relative note links, heading links and imported attachment navigation. Same-folder matches take priority; ambiguous matches open a source chooser; latest versions are preferred. Derived archive notes also resolve. Outline and heading navigation retain original line numbers, including frontmatter offsets.

Raw HTML does not execute. Rendering issues no image/network requests. Remote links can be copied; imported attachments open retained sources. Markdown parsing is lazy-loaded. Source view pages 200 lines, full-source find returns up to 1,000 matching lines, and hex view shows the original first 512 bytes. The existing engine text cap still applies.

## Preserved Atlas 1.0 capabilities

| Capability | Entry in the new workspace |
| --- | --- |
| Cases, isolated data, create/switch/restart | Bottom of left sidebar; palette |
| File/folder/vault import, native drop, deduplication/versions | Explorer, ribbon, palette; import details/cancellation in status bar |
| FTS5 grammar, filters, pagination | Search sidebar and Evidence vault tab |
| Entity filters and occurrences | Entity index; entity document; Connections |
| Graph layout/drag/pan/zoom, neighbor isolation, paths, replay | Evidence graph tab, original Canvas and worker |
| Exact source provenance, text, hex, metadata, hashes, parent/version lineage | Document tabs; Properties; Connections |
| UTC event filters/pagination and source jumps | Event timeline tab |
| Explained findings, review/dismiss/reopen and evidence navigation | Review findings tab |
| Case notes and source-bound observations | Analyst notebook; Observations sidebar |
| Integrity verification and audited history | Integrity & export tab |
| Complete original/JSON/HTML export and independent verifier | Integrity & export, ribbon, palette |
| Analysis field guide and limitations | Workbench guide tab |

## Implementation

`workspace.ts` is a pure immutable model with a binary split tree and leaf tab groups. `Chrome.tsx` renders that tree, focus/menu/palette controls and drop zones. `FileExplorer.tsx` paginates the original artifact API and virtualizes visible tree rows. `fileTree.ts` preserves folder/version/derived lineage and resolves imported links. `Document.tsx`, `MarkdownReader.tsx` and `markdown.ts` implement read-only documents and original-line navigation. `Inspector.tsx` follows active selection. Existing `Pages.tsx` tools and the graph worker keep their engine operations; view state now belongs to the tab, surviving React reparenting.

Layout storage is versioned under `atlas-workspace-v2:<case-id>`. Restore validates IDs, bounded depth/count/tab arrays, split ratios and sidebar sizes. The legacy active view migrates for the previously active case. Closing history retains the last 30 tabs within a session.

Default density: 43 px ribbon, 30 px titlebar, 39 px tab strip, 27 px tree rows and 24 px status bar. Neutral surfaces and a restrained purple accent establish hierarchy; sidebars push the content instead of overlaying it.
