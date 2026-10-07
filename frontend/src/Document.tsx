import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  BookOpen,
  Code2,
  Binary,
  Copy,
  LockKeyhole,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import type { Artifact, ArtifactDetail, EntityDetail } from './types';
import type { Selection } from './Pages';
import type { Tab } from './workspace';
import { resolveNote } from './fileTree';
import { markdownParts, outline } from './markdown';
import { Modal } from './Chrome';
import { bytes, date, KindBadge, Loading, readAPI, useData } from './shared';

const MarkdownReader = lazy(() => import('./MarkdownReader'));
export function EvidenceDocument({
  tab,
  caseId,
  revision,
  files,
  active,
  visible,
  onOpen,
  onError,
  notify,
  onTitle,
  onState,
  onInspect,
}: {
  tab: Tab;
  caseId: string;
  revision: number;
  files: Artifact[];
  active: boolean;
  visible: boolean;
  onOpen: (s: Selection, newTab?: boolean) => void;
  onError: (s: string) => void;
  notify: (s: string) => void;
  onTitle: (title: string) => void;
  onState: (state: Record<string, unknown>) => void;
  onInspect: () => void;
}) {
  const resource = tab.kind === 'view' ? '' : tab.resourceId,
    kind = tab.kind === 'artifact' ? 'artifacts' : 'entities';
  const { data, loading } = useData<ArtifactDetail | EntityDetail>(
    `/cases/${caseId}/${kind}/${resource}`,
    revision,
    onError,
    visible,
  );
  const [mode, setMode] = useState(
      typeof tab.state.mode === 'string' &&
        ['auto', 'read', 'source', 'hex'].includes(tab.state.mode)
        ? tab.state.mode
        : 'auto',
    ),
    [page, setPage] = useState(0),
    [line, setLine] = useState(tab.kind !== 'view' ? tab.line : undefined),
    [find, setFind] = useState(''),
    [findOpen, setFindOpen] = useState(false),
    [choices, setChoices] = useState<Artifact[]>([]),
    [choiceTarget, setChoiceTarget] = useState(''),
    [choiceNewTab, setChoiceNewTab] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null),
    findRef = useRef<HTMLInputElement>(null),
    highlightRef = useRef<HTMLDivElement>(null);
  const artifact = tab.kind === 'artifact' ? (data as ArtifactDetail | null) : null,
    entity = tab.kind === 'entity' ? (data as EntityDetail | null) : null;
  const text = artifact?.text || '',
    lines = useMemo(() => text.split('\n'), [text]),
    isMarkdown = artifact?.extension === 'md' || artifact?.extension === 'markdown';
  const effective = mode === 'auto' ? (isMarkdown ? 'read' : 'source') : mode;
  const parts = useMemo(() => markdownParts(text), [text]);
  const requested = tab.kind !== 'view' ? tab.line : undefined;
  useEffect(() => {
    if (requested) {
      setMode('source');
      setLine(requested);
      setPage(Math.floor((requested - 1) / 200));
    }
  }, [requested, tab.state.navigation]);
  useEffect(() => {
    if (artifact) onTitle(artifact.name);
    else if (entity) onTitle(entity.value);
  }, [artifact?.name, entity?.value]);
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'center' });
  }, [line, page, effective, data]);
  useEffect(() => {
    if (findOpen) findRef.current?.focus();
  }, [findOpen]);
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('[role=dialog],[role=menu]')) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.code === 'KeyF' || e.key.toLowerCase() === 'f') &&
        !e.shiftKey
      ) {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        setFindOpen(false);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [active, findOpen]);
  const matches = useMemo(
    () =>
      find
        ? lines
            .map((value, i) => ({ value, line: i + 1 }))
            .filter((x) => x.value.toLocaleLowerCase().includes(find.toLocaleLowerCase()))
            .slice(0, 1000)
            .map((x) => x.line)
        : [],
    [lines, find],
  );
  function changeMode(next: string) {
    setMode(next);
    onState({ ...tab.state, mode: next });
  }
  function jump(number: number) {
    const next = Math.max(1, Math.min(lines.length, number));
    if (!Number.isFinite(next)) return;
    changeMode('source');
    setLine(next);
    setPage(Math.floor((next - 1) / 200));
  }
  async function copy(value: string) {
    try {
      await window.atlas.copy(value);
      notify('Copied to clipboard.');
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function openTarget(file: Artifact, target: string, newTab = false) {
    const heading = target.split('|')[0].split('#')[1];
    try {
      let line: number | undefined;
      if (heading) {
        const detail = await readAPI<ArtifactDetail>(`/cases/${caseId}/artifacts/${file.id}`);
        let title = heading;
        try {
          title = decodeURIComponent(title);
        } catch {}
        title = title.replace(/-/g, ' ').toLocaleLowerCase();
        line = outline(detail.text).find((h) => h.title.toLocaleLowerCase() === title)?.line;
      }
      onOpen({ kind: 'artifact', id: file.id, line }, newTab);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  function follow(target: string, newTab = false) {
    if (!artifact) return;
    if (target.startsWith('#')) {
      let title = target.slice(1);
      try {
        title = decodeURIComponent(title);
      } catch {}
      title = title.replace(/-/g, ' ').toLocaleLowerCase();
      const heading = outline(text).find((h) => h.title.toLocaleLowerCase() === title);
      if (heading) jump(heading.line);
      return;
    }
    const found = resolveNote(files, artifact, target);
    if (found.length === 1) void openTarget(found[0].file, target, newTab);
    else if (found.length > 1) {
      setChoiceTarget(target);
      setChoiceNewTab(newTab);
      setChoices(found.map((x) => x.file));
    } else notify('No imported source matches ' + target + '.');
  }
  if (!data)
    return loading ? (
      <Loading />
    ) : (
      <div className="empty">
        <h3>Source unavailable</h3>
        <p>Choose another file from the explorer.</p>
      </div>
    );
  return (
    <div className="evidence-document">
      <div className="document-toolbar">
        <div className="document-breadcrumb">
          <FileText size={14} />
          <span title={artifact?.path || entity?.value}>
            {artifact
              ? artifact.path.replace(/\\/g, '/').split('/').slice(-3).join(' / ')
              : entity?.value}
          </span>
        </div>
        <span />
        <button
          className="icon-button"
          disabled={!artifact}
          aria-label="Find in source"
          title="Find in source (Ctrl+F)"
          onClick={() => setFindOpen(!findOpen)}
        >
          <Search size={16} />
        </button>
        {artifact && (
          <>
            <button
              className={'icon-button ' + (effective === 'read' ? 'active' : '')}
              disabled={!isMarkdown}
              aria-label="Reading view"
              title="Reading view"
              onClick={() => changeMode('read')}
            >
              <BookOpen size={16} />
            </button>
            <button
              className={'icon-button ' + (effective === 'source' ? 'active' : '')}
              aria-label="Source view"
              title="Source view"
              onClick={() => changeMode('source')}
            >
              <Code2 size={16} />
            </button>
            <button
              className={'icon-button ' + (effective === 'hex' ? 'active' : '')}
              aria-label="Hex view"
              title="Hex view"
              onClick={() => changeMode('hex')}
            >
              <Binary size={16} />
            </button>
          </>
        )}
        <button
          className="icon-button"
          aria-label="Show source properties"
          title="Show properties"
          onClick={onInspect}
        >
          <LockKeyhole size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Copy source text"
          title="Copy source text"
          onClick={() => copy(artifact?.text || entity!.value)}
        >
          <Copy size={15} />
        </button>
      </div>
      {findOpen && artifact && (
        <div className="document-find">
          <Search size={15} />
          <input
            ref={findRef}
            aria-label="Find text in source"
            placeholder="Find in source…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const next = matches.find((n) => n > (line || 0)) || matches[0];
                if (next) jump(next);
              }
            }}
          />
          <span>
            {matches.length}
            {matches.length === 1000 ? '+' : ''} lines
          </span>
          <button
            disabled={!matches.length}
            aria-label="Previous match"
            onClick={() =>
              jump([...matches].reverse().find((n) => n < (line || 0)) || matches.at(-1)!)
            }
          >
            <ChevronLeft size={15} />
          </button>
          <button
            disabled={!matches.length}
            aria-label="Next match"
            onClick={() => jump(matches.find((n) => n > (line || 0)) || matches[0])}
          >
            <ChevronRight size={15} />
          </button>
          <button aria-label="Close find" onClick={() => setFindOpen(false)}>
            <X size={15} />
          </button>
        </div>
      )}
      {artifact ? (
        <>
          <div className="document-scroll" ref={sourceRef}>
            {effective === 'read' && (
              <article className="markdown-reading">
                <div className="document-title">
                  <h1>{artifact.name.replace(/\.(?:md|markdown)$/i, '')}</h1>
                  <span title="Preserved source. Analysis notes are added separately.">
                    <LockKeyhole size={13} />
                    Read-only
                  </span>
                </div>
                {parts.frontmatter && (
                  <details className="frontmatter">
                    <summary>Properties</summary>
                    <pre>{parts.frontmatter}</pre>
                  </details>
                )}
                <Suspense fallback={<Loading />}>
                  <MarkdownReader
                    body={parts.body.slice(0, 200000)}
                    onFollow={follow}
                    onCopy={copy}
                  />
                </Suspense>
                {parts.body.length > 200000 && (
                  <p className="reading-limit">
                    Reading view shows the first 200,000 characters.{' '}
                    <button onClick={() => changeMode('source')}>Open complete source</button>
                  </p>
                )}
              </article>
            )}
            {effective === 'source' && (
              <>
                <div className="source-description">
                  {artifact.metadata.encoding === 'binary-strings'
                    ? 'Extracted binary strings'
                    : artifact.metadata.encoding === 'pdf-text'
                      ? 'Extracted PDF text'
                      : 'Preserved source text'}{' '}
                  · {artifact.metadata.encoding as string}
                  {Boolean(artifact.metadata.text_truncated) && ' · Analysis text capped by engine'}
                </div>
                <div className="source-view">
                  {lines.slice(page * 200, (page + 1) * 200).map((value, i) => {
                    const number = page * 200 + i + 1;
                    return (
                      <div
                        className={'source-line ' + (line === number ? 'highlighted' : '')}
                        key={number}
                        ref={line === number ? highlightRef : null}
                      >
                        <span>{number}</span>
                        <code>{value || ' '}</code>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {effective === 'hex' && (
              <>
                <div className="source-description">
                  First 512 bytes of the retained original · {bytes(artifact.size)}
                </div>
                <div className="hex-view">
                  {Array.from({ length: Math.ceil(artifact.hex.length / 32) }, (_, i) => {
                    const row = artifact.hex.slice(i * 32, (i + 1) * 32),
                      octets = row.match(/.{1,2}/g) || [];
                    return (
                      <div key={i}>
                        <span>{(i * 16).toString(16).padStart(8, '0')}</span>
                        <code>{octets.join(' ')}</code>
                        <em>
                          {octets
                            .map((b) => {
                              const c = parseInt(b, 16);
                              return c >= 32 && c <= 126 ? String.fromCharCode(c) : '.';
                            })
                            .join('')}
                        </em>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <footer className="document-status">
            <LockKeyhole size={12} />
            <span>Preserved source</span>
            <span />
            {effective === 'source' && (
              <>
                <label>
                  Line
                  <input
                    aria-label="Jump to source line"
                    type="number"
                    min={1}
                    max={lines.length}
                    value={line || page * 200 + 1}
                    onChange={(e) => jump(Number(e.target.value))}
                  />
                </label>
                <button
                  disabled={!page}
                  aria-label="Previous source lines"
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {page + 1} / {Math.max(1, Math.ceil(lines.length / 200))}
                </span>
                <button
                  disabled={(page + 1) * 200 >= lines.length}
                  aria-label="Next source lines"
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={14} />
                </button>
              </>
            )}
            <span>
              {lines.length.toLocaleString()} lines · {bytes(artifact.size)}
            </span>
          </footer>
        </>
      ) : (
        entity && (
          <article className="entity-document">
            <KindBadge kind={entity.kind} />
            <h1>{entity.value}</h1>
            <p className="muted">Observed source mentions</p>
            <div className="provenance-list">
              {entity.occurrences.map((o, i) => (
                <button
                  key={i}
                  onClick={(e) =>
                    onOpen(
                      { kind: 'artifact', id: o.artifact_id, line: o.line },
                      e.ctrlKey || e.metaKey,
                    )
                  }
                >
                  <div>
                    <FileText size={14} />
                    <strong>{o.name}</strong>
                    <span>:{o.line}</span>
                    <ArrowUpRight size={14} />
                  </div>
                  <p>{o.excerpt}</p>
                </button>
              ))}
            </div>
            {entity.occurrences.length >= 1000 && (
              <p className="muted">Showing the first 1,000 source mentions.</p>
            )}
          </article>
        )
      )}
      {!!choices.length && (
        <Modal label="Choose an imported source" onClose={() => setChoices([])}>
          <h2>Choose a source</h2>
          <p>Several imported files have this name.</p>
          {choices.map((file) => (
            <button
              className="source-choice"
              key={file.id}
              onClick={() => {
                setChoices([]);
                void openTarget(file, choiceTarget, choiceNewTab);
              }}
            >
              <FileText size={16} />
              <span>
                {file.name}
                <small>{file.path}</small>
              </span>
            </button>
          ))}
        </Modal>
      )}
    </div>
  );
}
