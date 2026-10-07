import { useState } from 'react';
import {
  ArrowRight,
  FileText,
  Network,
  Timer,
  ShieldAlert,
  Plus,
  ShieldCheck,
  Download,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  BookOpen,
  Info,
} from 'lucide-react';
import { Graph, COLORS } from './Graph';
import {
  useData,
  bytes,
  date,
  KindBadge,
  KindIcon,
  Loading,
  Empty,
  PageTitle,
  SearchBox,
  OpenButton,
} from './shared';
import type {
  Artifact,
  Audit,
  Entity,
  Finding,
  GraphData,
  GraphNode,
  Integrity,
  Note,
  Summary,
  TimelineEvent,
} from './types';

export type Selection = { id: string; kind: 'artifact' | 'entity'; line?: number };
export type PageProps = {
  caseId: string;
  revision: number;
  onError: (s: string) => void;
  onSelect: (s: Selection | null) => void;
  navigate: (s: string) => void;
  notify: (s: string) => void;
  onImport?: (folder?: boolean) => void;
  visible?: boolean;
  state?: Record<string, unknown>;
  onField?: (field: string, value: string | number) => void;
};

function useViewField<T extends string | number>(
  props: PageProps,
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [local, setLocal] = useState(initial);
  const saved = props.state?.[key];
  const value = props.onField ? (typeof saved === typeof initial ? (saved as T) : initial) : local;
  return [
    value,
    (next) => {
      const updated = typeof next === 'function' ? next(value) : next;
      props.onField ? props.onField(key, updated) : setLocal(updated);
    },
  ];
}

export function Overview(props: PageProps) {
  const { data, loading } = useData<Summary>(
    `/cases/${props.caseId}/summary`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  const { data: recent } = useData<{ items: Artifact[]; total: number }>(
    `/cases/${props.caseId}/artifacts?limit=6`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  if (!data)
    return loading ? (
      <Loading />
    ) : (
      <Empty title="Case unavailable" body="Restart Atlas to reconnect." />
    );
  const max = Math.max(1, ...data.timeline.map((b) => b.count));
  return (
    <article className="overview-document page">
      <PageTitle eyebrow="" title="Overview" />
      <h2 className="overview-case">{data.case.name}</h2>
      <p className="overview-brief">
        {data.case.description || 'A local workspace for sources, connections and observations.'}
      </p>
      <div className="overview-counts">
        {[
          { view: 'evidence', label: 'files', value: data.counts.artifacts },
          { view: 'entities', label: 'entities', value: data.counts.entities },
          { view: 'timeline', label: 'events', value: data.counts.events },
          { view: 'findings', label: 'findings', value: data.counts.findings },
        ].map((item) => (
          <button key={item.view} onClick={() => props.navigate(item.view)}>
            <strong className="metric-value">{item.value.toLocaleString()}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {!data.counts.artifacts && (
        <div className="overview-empty">
          <p>Import files or an Obsidian vault to begin.</p>
          <button onClick={() => props.onImport?.()}>Import files</button>
          <button onClick={() => props.onImport?.(true)}>Import folder</button>
        </div>
      )}
      {!!data.timeline.length && (
        <section className="overview-activity">
          <div className="section-heading">
            <h3>Activity</h3>
            <button className="text-button" onClick={() => props.navigate('timeline')}>
              Open timeline <ArrowRight size={13} />
            </button>
          </div>
          <div className="activity-bars">
            {data.timeline.map((bin) => (
              <button
                key={bin.time}
                title={`${bin.time} UTC · ${bin.count} events`}
                style={{ height: Math.max(2, (bin.count / max) * 100) + '%' }}
                onClick={() => props.navigate('timeline')}
              />
            ))}
          </div>
          <div className="activity-range">
            <span>{data.timeline[0]?.time.replace('T', ' ')}</span>
            <span>{data.timeline.at(-1)?.time.replace('T', ' ')} UTC</span>
          </div>
        </section>
      )}
      <div className="overview-lists">
        <section>
          <div className="section-heading">
            <h3>Recent sources</h3>
            <button className="text-button" onClick={() => props.navigate('evidence')}>
              All files <ArrowRight size={13} />
            </button>
          </div>
          {recent?.items.map((file) => (
            <button
              className="overview-row"
              key={file.id}
              onClick={() => props.onSelect({ kind: 'artifact', id: file.id })}
            >
              <FileText size={15} />
              <span>{file.name}</span>
              <small>{bytes(file.size)}</small>
            </button>
          ))}
        </section>
        <section>
          <div className="section-heading">
            <h3>Connections</h3>
            <button className="text-button" onClick={() => props.navigate('graph')}>
              Open graph <ArrowRight size={13} />
            </button>
          </div>
          {data.hubs.slice(0, 6).map((entity) => (
            <button
              className="overview-row"
              key={entity.id}
              onClick={() => props.onSelect({ kind: 'entity', id: entity.id })}
            >
              <KindIcon kind={entity.kind} />
              <span>{entity.value}</span>
              <small>{entity.sources} files</small>
            </button>
          ))}
        </section>
      </div>
      <div className="overview-footnote">
        {bytes(data.counts.bytes)} preserved · {data.counts.edges.toLocaleString()} observed
        relationships{' '}
        <button className="text-button" onClick={() => props.navigate('integrity')}>
          Integrity & export <ArrowRight size={13} />
        </button>
      </div>
    </article>
  );
}

export function GraphPage(props: PageProps & { selection: Selection | null }) {
  const { data, loading } = useData<GraphData>(
    `/cases/${props.caseId}/graph`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  return (
    <div className="graph-page">
      <div className="graph-heading">
        <h1>Evidence graph</h1>
        <span className="graph-subtitle">Observed relationships</span>
      </div>
      {data ? (
        <Graph
          data={data}
          selected={props.selection?.id || ''}
          caseId={props.caseId}
          onError={props.onError}
          onSelect={(n: GraphNode | null) =>
            props.onSelect(
              n ? { id: n.id, kind: n.kind === 'artifact' ? 'artifact' : 'entity' } : null,
            )
          }
        />
      ) : loading ? (
        <Loading />
      ) : (
        <Empty title="Graph unavailable" body="Try switching cases or restarting Atlas." />
      )}
    </div>
  );
}

export function Evidence(props: PageProps) {
  const [query, setQuery] = useViewField<string>(props, 'query', ''),
    [page, setPage] = useViewField<number>(props, 'page', 0);
  const { data, loading } = useData<{ items: Artifact[]; total: number }>(
    `/cases/${props.caseId}/artifacts?q=${encodeURIComponent(query)}&limit=100&offset=${page * 100}`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  return (
    <div className="page">
      <PageTitle eyebrow="IMMUTABLE SOURCE MATERIAL" title="Evidence vault">
        <span className="badge subtle">{data?.total || 0} files</span>
      </PageTitle>
      <div className="filterbar">
        <SearchBox
          value={query}
          onChange={(s) => {
            setQuery(s);
            setPage(0);
          }}
          placeholder="Search content or query: ext:ps1 risk:high has:domain"
        />
        <span className="hint">FTS5 index</span>
      </div>
      <div className="query-examples">
        Quick filters:
        {['risk:high', 'has:ip', 'ext:ps1', 'ext:jsonl', 'name:decoded'].map((q) => (
          <button
            key={q}
            onClick={() => {
              setQuery(q);
              setPage(0);
            }}
          >
            {q}
          </button>
        ))}
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Evidence</th>
              <th>Type</th>
              <th>Size</th>
              <th>Indicators</th>
              <th>Findings</th>
              <th>SHA-256</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id} onDoubleClick={() => props.onSelect({ id: a.id, kind: 'artifact' })}>
                <td>
                  <button
                    className="file-cell"
                    onClick={() => props.onSelect({ id: a.id, kind: 'artifact' })}
                  >
                    <FileText size={17} />
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {a.parent_id ? `${a.relation} from parent evidence` : 'Original source'} ·{' '}
                        {a.metadata.encoding as string}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  <span className="extension">{a.extension}</span>
                </td>
                <td className="mono muted">{bytes(a.size)}</td>
                <td>{a.mentions}</td>
                <td>
                  {a.findings ? (
                    <span className="finding-count">{a.findings}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="mono hash" title={a.sha256}>
                  {a.sha256.slice(0, 12)}…
                </td>
                <td>
                  <OpenButton
                    label={`Inspect ${a.name}`}
                    onClick={() => props.onSelect({ id: a.id, kind: 'artifact' })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.items.length &&
          (loading ? (
            <Loading />
          ) : (
            <Empty
              title="No matching evidence"
              body="Adjust the query or import files into this case."
            />
          ))}
      </div>
      <Pager page={page} total={data?.total || 0} size={100} onChange={setPage} />
      <div className="info-line">
        <Info size={14} />
        Search words match preserved text. Filters combine with AND. Quotes search exact phrases.
      </div>
    </div>
  );
}

export function Entities(props: PageProps) {
  const [query, setQuery] = useViewField<string>(props, 'query', ''),
    [kind, setKind] = useViewField<string>(props, 'kind', ''),
    [page, setPage] = useViewField<number>(props, 'page', 0);
  const { data, loading } = useData<Entity[]>(
    `/cases/${props.caseId}/entities?q=${encodeURIComponent(query)}&kind=${kind}&limit=200&offset=${page * 200}`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  return (
    <div className="page">
      <PageTitle eyebrow="NORMALIZED & DEDUPLICATED" title="Entity index" />
      <div className="filterbar">
        <SearchBox
          value={query}
          onChange={(s) => {
            setQuery(s);
            setPage(0);
          }}
          placeholder="Search indicator values…"
        />
        <select
          aria-label="Entity type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All entity types</option>
          {Object.keys(COLORS)
            .filter((k) => k !== 'artifact')
            .map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
        </select>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Type</th>
              <th>Source files</th>
              <th>Mentions</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((e) => (
              <tr key={e.id}>
                <td>
                  <button
                    className="entity-value"
                    onClick={() => props.onSelect({ id: e.id, kind: 'entity' })}
                  >
                    <KindIcon kind={e.kind} />
                    <span className="mono">{e.value}</span>
                  </button>
                </td>
                <td>
                  <KindBadge kind={e.kind} />
                </td>
                <td>
                  <span className={e.sources > 1 ? 'corroborated' : 'muted'}>
                    {e.sources > 1 && <Network size={12} />} {e.sources}
                  </span>
                </td>
                <td>{e.mentions}</td>
                <td>
                  <OpenButton
                    label={`Inspect ${e.value}`}
                    onClick={() => props.onSelect({ id: e.id, kind: 'entity' })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.length &&
          (loading ? (
            <Loading />
          ) : (
            <Empty
              title="No matching indicators"
              body="Import evidence or change the type filter."
            />
          ))}
      </div>
      <div className="pager">
        <span>Page {page + 1} · up to 200 entities per page</span>
        <button
          disabled={page === 0}
          aria-label="Previous entities"
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          disabled={!data || data.length < 200}
          aria-label="Next entities"
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function Timeline(props: PageProps) {
  const [query, setQuery] = useViewField<string>(props, 'query', ''),
    [kind, setKind] = useViewField<string>(props, 'kind', ''),
    [page, setPage] = useViewField<number>(props, 'page', 0),
    [start, setStart] = useViewField<string>(props, 'start', ''),
    [end, setEnd] = useViewField<string>(props, 'end', '');
  const { data, loading } = useData<{ items: TimelineEvent[]; total: number }>(
    `/cases/${props.caseId}/events?q=${encodeURIComponent(query)}&kind=${kind}&start=${encodeURIComponent(start ? start + ':00.000+00:00' : '')}&end=${encodeURIComponent(end ? end + ':59.999+00:00' : '')}&limit=100&offset=${page * 100}`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  return (
    <div className="page">
      <PageTitle eyebrow="RECONSTRUCT THE SEQUENCE" title="Event timeline">
        <span className="badge subtle">UTC · {data?.total || 0} events</span>
      </PageTitle>
      <div className="filterbar">
        <SearchBox
          value={query}
          onChange={(s) => {
            setQuery(s);
            setPage(0);
          }}
          placeholder="Search events, hosts or destinations…"
        />
        <select
          aria-label="Event type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All event types</option>
          {['network', 'process', 'auth', 'event'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </div>
      <div className="time-filters">
        <label>
          From UTC
          <input
            type="datetime-local"
            aria-label="Timeline start UTC"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Until UTC
          <input
            type="datetime-local"
            aria-label="Timeline end UTC"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {(start || end) && (
          <button
            className="text-button"
            onClick={() => {
              setStart('');
              setEnd('');
              setPage(0);
            }}
          >
            Clear interval
          </button>
        )}
      </div>
      <div className="timeline-list">
        {data?.items.map((event, i) => (
          <div className="timeline-item" key={event.id}>
            <div className="event-time">
              <strong>{event.timestamp.slice(11, 19)}</strong>
              <span>{event.timestamp.slice(0, 10)}</span>
            </div>
            <div className={`event-track ${event.kind}`}>
              <i />
              {i < data.items.length - 1 && <div />}
            </div>
            <button
              className="event-card"
              onClick={() =>
                props.onSelect({ id: event.artifact_id, kind: 'artifact', line: event.line })
              }
            >
              <div>
                <span className={`event-kind ${event.kind}`}>{event.kind}</span>
                <span className="event-origin">
                  {event.name} : {event.line}
                </span>
                <ArrowRight size={14} />
              </div>
              <p className="mono">{event.summary}</p>
            </button>
          </div>
        ))}
        {!data?.items.length &&
          (loading ? (
            <Loading />
          ) : (
            <Empty
              title="No events in this interval"
              body="Atlas recognizes ISO 8601 timestamps in source lines. Timestamps without a zone are interpreted as UTC."
            />
          ))}
      </div>
      <Pager page={page} total={data?.total || 0} size={100} onChange={setPage} />
    </div>
  );
}

export function Findings(props: PageProps & { onUpdate: () => void }) {
  const { data, loading } = useData<Finding[]>(
    `/cases/${props.caseId}/findings`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  const [severity, setSeverity] = useViewField<string>(props, 'severity', ''),
    [status, setStatus] = useViewField<string>(props, 'status', 'open');
  const items = data?.filter(
    (f) => (!severity || f.severity === severity) && (!status || f.status === status),
  );
  async function setFinding(f: Finding, next: string) {
    try {
      await window.atlas.api(`/cases/${props.caseId}/findings/${f.id}`, 'POST', { status: next });
      props.onUpdate();
    } catch (e) {
      props.onError((e as Error).message);
    }
  }
  return (
    <div className="page">
      <PageTitle eyebrow="EXPLAINABLE STATIC ANALYSIS" title="Review findings">
        <span className="badge amber">{items?.length || 0} to review</span>
      </PageTitle>
      <div className="finding-disclaimer">
        <ShieldAlert size={17} />
        <span>Heuristics point to evidence. They do not establish malicious intent.</span>
      </div>
      <div className="filterbar">
        <div className="segmented">
          {['', 'high', 'medium', 'low'].map((s) => (
            <button
              key={s}
              className={severity === s ? 'selected' : ''}
              onClick={() => setSeverity(s)}
            >
              {s || 'All priorities'}
            </button>
          ))}
        </div>
        <select
          aria-label="Finding status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open">Open findings</option>
          <option value="reviewed">Reviewed</option>
          <option value="dismissed">Dismissed</option>
          <option value="">All statuses</option>
        </select>
      </div>
      <div className="findings-list">
        {items?.map((f) => (
          <article className={`finding-card ${f.severity}`} key={f.id}>
            <div className="finding-header">
              <span className={`severity ${f.severity}`}>{f.severity}</span>
              <span className="mono muted">{f.rule}</span>
              <span className="finding-status">{f.status}</span>
            </div>
            <h3>{f.title}</h3>
            <p>{f.detail}</p>
            <div className="finding-footer">
              <button
                className="text-button"
                onClick={() =>
                  props.onSelect({ id: f.artifact_id, kind: 'artifact', line: f.line })
                }
              >
                <FileText size={14} /> {f.name}
                {f.line > 0 ? ` : ${f.line}` : ''} <ArrowRight size={14} />
              </button>
              <div>
                {f.status !== 'reviewed' && (
                  <button onClick={() => setFinding(f, 'reviewed')}>
                    <Check size={13} /> Reviewed
                  </button>
                )}
                {f.status !== 'dismissed' && (
                  <button onClick={() => setFinding(f, 'dismissed')}>Dismiss</button>
                )}
                {f.status !== 'open' && (
                  <button onClick={() => setFinding(f, 'open')}>Reopen</button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!items?.length &&
          (loading ? (
            <Loading />
          ) : (
            <Empty
              title="Review queue is clear"
              body="Change the status filter to see reviewed findings. New evidence is analyzed automatically."
            />
          ))}
      </div>
    </div>
  );
}

export function Notebook(props: PageProps & { onUpdate: () => void }) {
  const { data, loading } = useData<Note[]>(
    `/cases/${props.caseId}/notes`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  const [body, setBody] = useViewField<string>(props, 'body', ''),
    [tag, setTag] = useViewField<string>(props, 'tag', 'hypothesis'),
    [saving, setSaving] = useState(false);
  async function save() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await window.atlas.api(`/cases/${props.caseId}/notes`, 'POST', { body, tag, node_id: '' });
      setBody('');
      props.onUpdate();
      props.notify('Note added to the investigation history.');
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page">
      <PageTitle eyebrow="REASONING WITH PROVENANCE" title="Analyst notebook" />
      <section className="card note-editor">
        <textarea
          aria-label="New analyst note"
          placeholder="Record a hypothesis, conclusion or next question…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={20000}
        />
        <div>
          <select aria-label="Note tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            {['hypothesis', 'observation', 'conclusion', 'question', 'briefing'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <span className="muted">Appended to the hash-chained history</span>
          <button className="primary" disabled={saving || !body.trim()} onClick={save}>
            <Plus size={15} /> Add note
          </button>
        </div>
      </section>
      <div className="notes-grid">
        {data?.map((note) => (
          <article className="card note-card" key={note.id}>
            <div>
              <span className={`note-tag ${note.tag}`}>{note.tag || 'note'}</span>
              <span>{date(note.created)} UTC</span>
            </div>
            <p>{note.body}</p>
            {note.node_id && (
              <span className="mono muted">Linked evidence: {note.node_id.slice(0, 12)}</span>
            )}
          </article>
        ))}
      </div>
      {!data?.length &&
        (loading ? (
          <Loading />
        ) : (
          <Empty
            title="No notes yet"
            body="Keep observations and conclusions together with the evidence."
          />
        ))}
    </div>
  );
}

export function IntegrityPage(props: PageProps & { onExport: () => void }) {
  const { data } = useData<Audit[]>(
    `/cases/${props.caseId}/history`,
    props.revision,
    props.onError,
    props.visible !== false,
  );
  const [result, setResult] = useState<Integrity | null>(null),
    [checking, setChecking] = useState(false);
  async function verify() {
    setChecking(true);
    try {
      setResult(await window.atlas.api<Integrity>(`/cases/${props.caseId}/verify`, 'POST'));
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="page">
      <PageTitle eyebrow="SOURCE INTEGRITY & CHAIN OF CUSTODY" title="Integrity & export">
        <button className="primary" disabled={checking} onClick={verify}>
          <ShieldCheck size={16} /> {checking ? 'Verifying…' : 'Verify integrity'}
        </button>
      </PageTitle>
      <section className={`card integrity-card ${result ? (result.ok ? 'valid' : 'invalid') : ''}`}>
        <ShieldCheck size={36} />
        <div>
          <h2>
            {result
              ? result.ok
                ? 'All source bytes and audit records verified.'
                : 'Integrity check failed.'
              : 'Evidence you can independently inspect.'}
          </h2>
          <p>
            {result
              ? `${result.evidence_files} evidence files · ${result.audit_records} audit records · ${result.failures.length} failures`
              : 'Each file is retained under its SHA-256 hash. Every import, note and review appends to a hash-linked audit trail.'}
          </p>
          {result && <code className="chain-head">Head: {result.head}</code>}
        </div>
      </section>
      <div className="integrity-scope">
        <Info size={16} />
        <span>
          Checks original bytes, evidence metadata and the audit chain. Local integrity is not an
          external digital signature or independent timestamp. Derived text and analyst judgments
          require review.
        </span>
      </div>
      <section className="card export-card">
        <div>
          <Download size={24} />
          <span>
            <h3>Portable evidence bundle</h3>
            <p>
              Original bytes, complete JSON data and a readable HTML report. No account or
              application required to inspect it.
            </p>
          </span>
        </div>
        <button onClick={props.onExport}>
          <Download size={15} /> Export bundle
        </button>
      </section>
      <div className="card-title history-title">
        <div>
          <span className="section-label">APPEND-ONLY INVESTIGATION TRAIL</span>
          <h2>Case history</h2>
        </div>
        <span className="muted">Latest 1,000 records</span>
      </div>
      <div className="audit-list">
        {data?.map((record) => (
          <div className="audit-row" key={record.seq}>
            <span className="audit-seq">{record.seq.toString().padStart(3, '0')}</span>
            <div>
              <strong>{record.action.replaceAll('.', ' / ')}</strong>
              <span className="mono">{record.hash.slice(0, 24)}…</span>
            </div>
            <time>{date(record.timestamp)} UTC</time>
            <button
              aria-label={`Copy audit hash ${record.seq}`}
              onClick={() => {
                window.atlas.copy(record.hash);
                props.notify('Audit hash copied.');
              }}
            >
              <Copy size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Guide() {
  return (
    <div className="page guide">
      <PageTitle eyebrow="ATLAS / FIELD GUIDE" title="Workbench guide" />
      <div className="guide-grid">
        {[
          [
            '01',
            'Preserve the sources',
            'Create a case, then import files or a folder. Text, logs, JSONL, CSV, email, PDF, scripts and executables are analyzed. ZIP members and encoded PowerShell commands become derived evidence. Originals remain unchanged.',
          ],
          [
            '02',
            'Follow the connections',
            'Open the graph. Select a node to see the exact source lines that mention it. Squares are files, circles are indicators. Drag, zoom and inspect. Trace a connection to find the shortest observed path between two nodes. A shared file establishes co-occurrence, not causation.',
          ],
          [
            '03',
            'Reconstruct the sequence',
            'The timeline recognizes ISO 8601 timestamps, normalizes offsets to UTC and orders events across files. Filter by event type, content or interval. Click an event to jump to its source line. Missing timezone means UTC.',
          ],
          [
            '04',
            'Review explainable signals',
            'Findings include encoded commands, suspicious script references, disguised executables, PE section permissions and periodic network activity. The evidence and reason are always visible. Mark reviewed or dismissed; decisions remain in history.',
          ],
          [
            '05',
            'Record and export',
            'Attach notes to evidence or keep case-level observations in the notebook. Verify source hashes and the audit chain. Export a ZIP containing originals, the complete case.json and report.html. The bundle can be inspected with standard tools.',
          ],
          [
            '06',
            'Understand the limits',
            'Static analysis never runs imported programs or contacts extracted addresses. Maximum file size: 64 MiB. Import budget: 512 MiB, 3,000 analyzed files, ZIP depth 3. PDF: 200 pages and 25 seconds. Graph display: up to 1,000 files and 1,500 entities. Skips and partial analysis are reported.',
          ],
        ].map(([number, title, text]) => (
          <article className="card" key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </div>
      <section className="card query-guide">
        <h2>Search the evidence</h2>
        <div>
          {[
            ['ext:ps1', 'Only PowerShell files'],
            ['risk:high', 'Files with open high-priority findings'],
            ['has:ip', 'Files containing IPv4 addresses'],
            ['name:decoded', 'Name contains “decoded”'],
            ['sha256:abc123', 'Hash starts with abc123'],
            ['"failed password"', 'Exact phrase in preserved text'],
            ['ext:jsonl has:domain', 'Combine filters with AND'],
          ].map(([q, text]) => (
            <div key={q}>
              <code>{q}</code>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="query-guide keyboard-guide">
        <h2>Work with the keyboard</h2>
        <div>
          {[
            ['Ctrl P', 'Command palette'],
            ['Ctrl O', 'Quick switcher — opens imported files'],
            ['Ctrl T / Ctrl W', 'New tab / close active tab'],
            ['Ctrl Shift T', 'Reopen closed tab'],
            ['Ctrl Tab / Ctrl Shift Tab', 'Next / previous tab'],
            ['Ctrl 1…9', 'Select tab; 9 selects the last tab'],
            ['Ctrl \\ / Ctrl Shift \\', 'Split right / split down'],
            ['Ctrl Alt ← / →', 'Focus previous / next pane'],
            ['Ctrl Shift L / R', 'Toggle left / right sidebar'],
            ['Ctrl Shift E / F', 'Focus file explorer / search all evidence'],
            ['Ctrl F', 'Find in the active source'],
            ['Ctrl Shift I / Ctrl Alt I', 'Import files / folder or Obsidian vault'],
            ['Shift F10', 'Open the focused file or tab context menu'],
          ].map(([key, action]) => (
            <div key={key}>
              <kbd>{key}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
        <p className="muted">
          Single-click files for a temporary preview. Double-click or Ctrl+Enter to keep a tab. Drag
          tabs to reorder, move between groups or split at any edge. Resizers also work with arrow
          keys. Layouts are remembered per investigation.
        </p>
      </section>
      <div className="guide-footer">Atlas 1.1.0 · MIT · Built for local investigation.</div>
    </div>
  );
}

function Pager({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total ? page * size + 1 : 0}–{Math.min((page + 1) * size, total)} of{' '}
        {total.toLocaleString()}
      </span>
      <button disabled={page === 0} aria-label="Previous page" onClick={() => onChange(page - 1)}>
        <ChevronLeft size={16} />
      </button>
      <button
        disabled={(page + 1) * size >= total}
        aria-label="Next page"
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
