import { useEffect, useState } from 'react';
import { LoaderCircle, Search, ArrowUpRight, FileText, Globe, Network, Link, Mail, Fingerprint, ShieldAlert } from 'lucide-react';
import type { Kind } from './types';
import { COLORS, KIND_LABELS } from './Graph';

export function useData<T>(path: string, revision: number, onError: (s: string) => void) {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    window.atlas.api<T>(path).then(value => { if (live) setData(value); }).catch(error => { if (live) { setData(null); onError(error.message); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, revision, onError]);
  return { data, loading };
}
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const date = (s: string) => new Date(s).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function KindIcon({ kind, size = 16 }: { kind: Kind; size?: number }) { const Icon = { artifact: FileText, domain: Globe, ip: Network, url: Link, email: Mail, cve: ShieldAlert, sha256: Fingerprint, sha1: Fingerprint, md5: Fingerprint }[kind]; return <Icon size={size} color={COLORS[kind]} />; }
export function KindBadge({ kind }: { kind: Kind }) { return <span className="kind-badge" style={{ color: COLORS[kind] }}><KindIcon kind={kind} size={12} />{KIND_LABELS[kind]}</span>; }
export function Loading() { return <div className="loading"><LoaderCircle size={22} className="spin" /> Loading evidence…</div>; }
export function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><Search size={30} /><h3>{title}</h3><p>{body}</p></div>; }
export function OpenButton({ onClick, label = 'Inspect' }: { onClick: () => void; label?: string }) { return <button className="icon-button" title={label} aria-label={label} onClick={onClick}><ArrowUpRight size={16} /></button>; }
export function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) { return <div className="page-title"><div><div className="section-label">{eyebrow}</div><h1>{title}</h1></div>{children}</div>; }
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) { return <div className="searchbox"><Search size={16} /><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />{value && <button aria-label="Clear search" onClick={() => onChange('')}>×</button>}</div>; }
