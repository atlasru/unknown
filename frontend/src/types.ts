export type Kind = 'artifact' | 'ip' | 'domain' | 'url' | 'email' | 'sha256' | 'sha1' | 'md5' | 'cve';
export interface Case { id: string; name: string; description: string; created: string; artifacts: number }
export interface Entity { id: string; kind: Kind; value: string; mentions: number; sources: number }
export interface Occurrence { artifact_id: string; line: number; offset: number; excerpt: string; name: string }
export interface EntityDetail extends Entity { occurrences: Occurrence[]; edges: Edge[] }
export interface Finding { id: string; artifact_id: string; rule: string; severity: 'high' | 'medium' | 'low'; title: string; line: number; detail: string; status: 'open' | 'reviewed' | 'dismissed'; name: string }
export interface Artifact { id: string; name: string; path: string; sha256: string; size: number; extension: string; imported: string; parent_id: string | null; relation: string; mentions: number; findings: number; metadata: Record<string, unknown> }
export interface ArtifactDetail extends Omit<Artifact, 'findings'> { text: string; hex: string; entities: Entity[]; findings: Finding[]; versions: { id: string; sha256: string; imported: string }[] }
export interface GraphNode { id: string; label: string; kind: Kind; weight: number; findings?: number; sources?: number }
export interface Edge { source: string; target: string; relation: string; weight: number; artifact_id: string; line: number }
export interface GraphData { nodes: GraphNode[]; edges: Edge[]; total: number; truncated: boolean }
export interface TimelineEvent { id: number; artifact_id: string; timestamp: string; kind: string; line: number; summary: string; name: string }
export interface Summary { case: Case; counts: Record<string, number>; severities: { severity: string; count: number }[]; types: { kind: Kind; count: number }[]; timeline: { time: string; count: number }[]; hubs: Entity[] }
export interface Note { id: string; node_id: string; body: string; created: string; tag: string }
export interface Audit { seq: number; timestamp: string; action: string; payload: string; prev: string; hash: string }
export interface Job { id: string; case_id: string; status: string; imported: number; duplicates: number; skipped: number; processed: number; bytes: number; current: string; errors: string[]; cancelled: boolean; elapsed: number }
export interface Integrity { ok: boolean; audit_records: number; evidence_files: number; head: string; failures: unknown[]; scope: string }
declare global {
  interface Window {
    atlas: {
      api: <T>(path: string, method?: 'GET' | 'POST', body?: unknown) => Promise<T>;
      importFiles: (caseId: string, folder?: boolean) => Promise<Job | null>;
      importDropped: (caseId: string, files: FileList | File[]) => Promise<Job | null>;
      exportCase: (caseId: string) => Promise<{ path: string } | null>;
      copy: (text: string) => Promise<void>;
      window: (action: string) => Promise<void>;
      onEngineStopped: (callback: () => void) => () => void;
    };
  }
}
