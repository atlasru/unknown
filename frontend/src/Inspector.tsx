import { useEffect, useState } from 'react';
import {
  FileText,
  ListTree,
  Link2,
  NotebookPen,
  SlidersHorizontal,
  Copy,
  Plus,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react';
import type { ArtifactDetail, EntityDetail, Note } from './types';
import type { Selection } from './Pages';
import type { Workspace } from './workspace';
import { markdownParts, outline } from './markdown';
import { bytes, date, KindBadge, useData, Loading, KindIcon } from './shared';

export function Inspector({
  selection,
  caseId,
  revision,
  tab,
  onTab,
  onOpen,
  onError,
  notify,
  onUpdate,
}: {
  selection: Selection | null;
  caseId: string;
  revision: number;
  tab: Workspace['rightTab'];
  onTab: (tab: Workspace['rightTab']) => void;
  onOpen: (s: Selection) => void;
  onError: (s: string) => void;
  notify: (s: string) => void;
  onUpdate: () => void;
}) {
  return (
    <aside className="right-sidebar" aria-label="Evidence inspector">
      <div className="sidebar-tabs" role="tablist" aria-label="Inspector views">
        {(
          [
            { id: 'properties', label: 'Properties', icon: SlidersHorizontal },
            { id: 'links', label: 'Connections', icon: Link2 },
            { id: 'outline', label: 'Outline', icon: ListTree },
            { id: 'notes', label: 'Observations', icon: NotebookPen },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-label={t.label}
            title={t.label}
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
          >
            <t.icon size={17} />
          </button>
        ))}
      </div>
      {selection ? (
        <InspectorContent
          key={selection.id}
          selection={selection}
          caseId={caseId}
          revision={revision}
          tab={tab}
          onOpen={onOpen}
          onError={onError}
          notify={notify}
          onUpdate={onUpdate}
        />
      ) : (
        <div className="inspector-empty">
          <h3>
            {tab === 'outline'
              ? 'Outline'
              : tab === 'links'
                ? 'Connections'
                : tab === 'notes'
                  ? 'Observations'
                  : 'Properties'}
          </h3>
          <p>Open a source or select a graph node.</p>
        </div>
      )}
    </aside>
  );
}
function InspectorContent({
  selection,
  caseId,
  revision,
  tab,
  onOpen,
  onError,
  notify,
  onUpdate,
}: {
  selection: Selection;
  caseId: string;
  revision: number;
  tab: Workspace['rightTab'];
  onOpen: (s: Selection) => void;
  onError: (s: string) => void;
  notify: (s: string) => void;
  onUpdate: () => void;
}) {
  const { data, loading } = useData<ArtifactDetail | EntityDetail>(
    `/cases/${caseId}/${selection.kind === 'artifact' ? 'artifacts' : 'entities'}/${selection.id}`,
    revision,
    onError,
  );
  const { data: notes } = useData<Note[]>(
    `/cases/${caseId}/notes?node=${selection.id}`,
    revision,
    onError,
  );
  const [note, setNote] = useState(''),
    [saving, setSaving] = useState(false);
  const artifact = selection.kind === 'artifact' ? (data as ArtifactDetail | null) : null,
    entity = selection.kind === 'entity' ? (data as EntityDetail | null) : null;
  async function copy(value: string) {
    try {
      await window.atlas.copy(value);
      notify('Copied to clipboard.');
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function save() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await window.atlas.api(`/cases/${caseId}/notes`, 'POST', {
        node_id: selection.id,
        body: note,
        tag: 'observation',
      });
      setNote('');
      onUpdate();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (!data) return loading ? <Loading /> : <p className="sidebar-empty">Source unavailable.</p>;
  const headings = artifact ? outline(artifact.text) : [];
  return (
    <div className="inspector-scroll">
      <div className="inspector-identity">
        {artifact ? <FileText size={16} /> : <KindIcon kind={entity!.kind} />}
        <strong>{artifact?.name || entity?.value}</strong>
      </div>
      {tab === 'properties' && (
        <>
          <h3>Properties</h3>
          {artifact ? (
            <>
              <button className="sidebar-link" onClick={() => onOpen(selection)}>
                <ArrowUpRight size={14} />
                Open source in a tab
              </button>
              <dl className="property-list">
                <dt>Type</dt>
                <dd>{artifact.extension}</dd>
                <dt>Size</dt>
                <dd>{bytes(artifact.size)}</dd>
                <dt>Encoding</dt>
                <dd>{artifact.metadata.encoding as string}</dd>
                <dt>Imported</dt>
                <dd>{date(artifact.imported)} UTC</dd>
                <dt>Source</dt>
                <dd className="source-path">
                  {artifact.path}
                  <button aria-label="Copy source path" onClick={() => copy(artifact.path)}>
                    <Copy size={12} />
                  </button>
                </dd>
                <dt>Derivation</dt>
                <dd>{artifact.relation}</dd>
              </dl>
              <details className="inspector-section" open>
                <summary>Original hashes</summary>
                {['sha256', 'sha1', 'md5'].map((hash) => {
                  const value =
                    hash === 'sha256' ? artifact.sha256 : (artifact.metadata[hash] as string);
                  if (!value) return null;
                  return (
                    <div className="property-hash" key={hash}>
                      <span>
                        {hash === 'sha256' ? 'SHA-256' : hash.toUpperCase()}
                        <button aria-label={`Copy ${hash}`} onClick={() => copy(value)}>
                          <Copy size={12} />
                        </button>
                      </span>
                      <code>{value}</code>
                    </div>
                  );
                })}
              </details>
              {artifact.parent_id && (
                <button
                  className="sidebar-link"
                  onClick={() => onOpen({ id: artifact.parent_id!, kind: 'artifact' })}
                >
                  <ChevronRight size={14} />
                  Parent evidence
                </button>
              )}
              {artifact.versions.length > 1 && (
                <details className="inspector-section" open>
                  <summary>Source versions · {artifact.versions.length}</summary>
                  {artifact.versions.map((version, i) => (
                    <button
                      className="version-row"
                      key={version.id}
                      onClick={() => onOpen({ id: version.id, kind: 'artifact' })}
                    >
                      <span>
                        Version {artifact.versions.length - i}
                        <small>{date(version.imported)} UTC</small>
                      </span>
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                </details>
              )}
              {markdownParts(artifact.text).frontmatter && (
                <details className="inspector-section">
                  <summary>Note properties</summary>
                  <pre>{markdownParts(artifact.text).frontmatter}</pre>
                </details>
              )}
              <details className="inspector-section">
                <summary>Analysis metadata</summary>
                <pre>{JSON.stringify(artifact.metadata, null, 2)}</pre>
              </details>
            </>
          ) : (
            entity && (
              <>
                <KindBadge kind={entity.kind} />
                <dl className="property-list">
                  <dt>Canonical value</dt>
                  <dd className="source-path">
                    {entity.value}
                    <button aria-label="Copy selected value" onClick={() => copy(entity.value)}>
                      <Copy size={13} />
                    </button>
                  </dd>
                  <dt>Mentions shown</dt>
                  <dd>{entity.occurrences.length}</dd>
                </dl>
                <button className="sidebar-link" onClick={() => onOpen(selection)}>
                  <ArrowUpRight size={14} />
                  Open indicator in a tab
                </button>
              </>
            )
          )}
          {artifact && (
            <details className="inspector-section">
              <summary>Analysis signals · {artifact.findings.length}</summary>
              {artifact.findings.map((f) => (
                <button
                  className="inspector-signal"
                  key={f.id}
                  onClick={() => onOpen({ id: artifact.id, kind: 'artifact', line: f.line })}
                >
                  <span className={`severity ${f.severity}`}>{f.severity}</span>
                  <strong>{f.title}</strong>
                  <small>{f.detail}</small>
                </button>
              ))}
            </details>
          )}
        </>
      )}
      {tab === 'links' && (
        <>
          <h3>{artifact ? 'Extracted indicators' : 'Source mentions'}</h3>
          {artifact ? (
            <div className="inspector-entities">
              {artifact.entities.map((e) => (
                <button key={e.id} onClick={() => onOpen({ id: e.id, kind: 'entity' })}>
                  <KindIcon kind={e.kind} />
                  <span>{e.value}</span>
                  <small>{e.mentions}</small>
                </button>
              ))}
              {!artifact.entities.length && (
                <p className="sidebar-empty">No indicators extracted.</p>
              )}
            </div>
          ) : (
            entity && (
              <div className="provenance-list">
                {entity.occurrences.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => onOpen({ id: o.artifact_id, kind: 'artifact', line: o.line })}
                  >
                    <div>
                      <FileText size={14} />
                      <strong>{o.name}</strong>
                      <span>:{o.line}</span>
                    </div>
                    <p>{o.excerpt}</p>
                  </button>
                ))}
                {entity.occurrences.length >= 1000 && (
                  <p className="sidebar-empty">First 1,000 mentions shown.</p>
                )}
              </div>
            )
          )}
        </>
      )}
      {tab === 'outline' && (
        <>
          <h3>Outline</h3>
          {headings.map((h) => (
            <button
              className="outline-item"
              key={h.line}
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              onClick={() => onOpen({ id: selection.id, kind: 'artifact', line: h.line })}
            >
              {h.title}
            </button>
          ))}
          {!headings.length && (
            <p className="sidebar-empty">No Markdown headings in this source.</p>
          )}
        </>
      )}
      {tab === 'notes' && (
        <>
          <h3>Observations</h3>
          <div className="attached-notes">
            {notes?.map((n) => (
              <article className="attached-note" key={n.id}>
                <p>{n.body}</p>
                <small>{date(n.created)} UTC</small>
              </article>
            ))}
          </div>
          <textarea
            aria-label="Evidence note"
            placeholder="Add an observation…"
            value={note}
            maxLength={20000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="observation-save" disabled={saving || !note.trim()} onClick={save}>
            <Plus size={14} />
            Add observation
          </button>
        </>
      )}
    </div>
  );
}
