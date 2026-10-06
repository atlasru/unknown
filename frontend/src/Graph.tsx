import { useEffect, useRef, useState } from 'react';
import { Crosshair, ZoomIn, ZoomOut, RotateCcw, Route, X } from 'lucide-react';
import type { GraphData, GraphNode, Kind } from './types';

export const COLORS: Record<Kind, string> = { artifact: '#91a6c9', domain: '#6bddbf', ip: '#76adff', url: '#c4a0ff', email: '#f0bb7a', cve: '#ff7a92', sha256: '#bdd57e', sha1: '#bdd57e', md5: '#bdd57e' };
export const KIND_LABELS: Record<Kind, string> = { artifact: 'Evidence', domain: 'Domain', ip: 'IP address', url: 'URL', email: 'Email', cve: 'CVE', sha256: 'SHA-256', sha1: 'SHA-1', md5: 'MD5' };

export function Graph({ data, selected, onSelect, caseId, onError }: { data: GraphData; selected: string; onSelect: (node: GraphNode | null) => void; caseId: string; onError: (message: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null);
  const positions = useRef(new Float32Array()), camera = useRef({ x: 0, y: 0, zoom: .8 });
  const worker = useRef<Worker | null>(null), dimensions = useRef({ width: 800, height: 600 });
  const selection = useRef(selected), pathNodes = useRef(new Set<string>());
  const [generation, setGeneration] = useState(0), [routeOpen, setRouteOpen] = useState(false), [source, setSource] = useState(''), [target, setTarget] = useState(''), [route, setRoute] = useState<string[]>([]);
  const [status, setStatus] = useState('Arranging evidence…'), [zoom, setZoom] = useState(80);
  const paint = useRef<() => void>(() => {});
  selection.current = selected;

  function fit() {
    const ps = positions.current;
    if (!ps.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < ps.length; i += 2) { minX = Math.min(minX, ps[i]); maxX = Math.max(maxX, ps[i]); minY = Math.min(minY, ps[i + 1]); maxY = Math.max(maxY, ps[i + 1]); }
    camera.current = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, zoom: Math.min(1.5, (dimensions.current.width - 180) / Math.max(1, maxX - minX), (dimensions.current.height - 160) / Math.max(1, maxY - minY)) };
    setZoom(Math.round(camera.current.zoom * 100)); paint.current();
  }

  useEffect(() => {
    const surface = canvas.current!, container = host.current!, ctx = surface.getContext('2d')!;
    const ids = new Map(data.nodes.map((n, i) => [n.id, i]));
    let fitted = false, interacted = false;
    worker.current = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    setStatus('Arranging evidence…');
    worker.current.postMessage({ type: 'init', nodes: data.nodes, edges: data.edges });
    worker.current.onmessage = event => {
      positions.current = event.data.positions;
      if (!interacted && (!fitted || event.data.iteration === 120)) { fit(); fitted = true; }
      paint.current();
      if (event.data.iteration >= 120) setStatus('Layout ready');
    };
    worker.current.onerror = () => onError('Graph layout worker failed. Use the entity and evidence tables.');
    const resize = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      dimensions.current = { width, height };
      const dpr = Math.min(window.devicePixelRatio, 2);
      surface.width = width * dpr; surface.height = height * dpr;
      surface.style.width = width + 'px'; surface.style.height = height + 'px';
      paint.current();
    });
    resize.observe(container);
    paint.current = () => {
      const { width, height } = dimensions.current, dpr = Math.min(window.devicePixelRatio, 2);
      const cam = camera.current, ps = positions.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#253046';
      const grid = 32 * cam.zoom;
      if (grid > 10) for (let x = (width / 2 + cam.x * cam.zoom) % grid; x < width; x += grid) for (let y = (height / 2 + cam.y * cam.zoom) % grid; y < height; y += grid) { ctx.beginPath(); ctx.arc(x, y, .65, 0, Math.PI * 2); ctx.fill(); }
      const neighbors = new Set<string>([selection.current]);
      if (selection.current) for (const edge of data.edges) { if (edge.source === selection.current) neighbors.add(edge.target); if (edge.target === selection.current) neighbors.add(edge.source); }
      const screen = (i: number) => [(ps[i * 2] + cam.x) * cam.zoom + width / 2, (ps[i * 2 + 1] + cam.y) * cam.zoom + height / 2];
      for (const edge of data.edges) {
        const a = ids.get(edge.source), b = ids.get(edge.target);
        if (a === undefined || b === undefined || ps.length < (Math.max(a, b) + 1) * 2) continue;
        const [ax, ay] = screen(a), [bx, by] = screen(b);
        const onPath = pathNodes.current.has(edge.source) && pathNodes.current.has(edge.target);
        const active = selection.current && (edge.source === selection.current || edge.target === selection.current);
        ctx.globalAlpha = selection.current && !active && !onPath ? .1 : 1;
        ctx.strokeStyle = onPath ? '#fcce85' : active ? '#6bddbf' : edge.relation === 'mentions' ? '#2c3a50' : '#4f6687';
        ctx.lineWidth = onPath ? 2.5 : active ? 1.5 : .8;
        ctx.setLineDash(edge.relation === 'mentions' ? [] : [3, 4]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        if (active && cam.zoom > .6 && edge.relation !== 'mentions') { ctx.fillStyle = '#9bb0ca'; ctx.font = '10px system-ui'; ctx.fillText(edge.relation.replaceAll('_', ' '), (ax + bx) / 2 + 3, (ay + by) / 2 - 5); }
      }
      ctx.globalAlpha = 1;
      data.nodes.forEach((node, i) => {
        if (ps.length < (i + 1) * 2) return;
        const [x, y] = screen(i);
        if (x < -150 || x > width + 150 || y < -40 || y > height + 40) return;
        const chosen = node.id === selection.current, active = !selection.current || neighbors.has(node.id), onPath = pathNodes.current.has(node.id);
        const radius = (node.kind === 'artifact' ? 8 : 5 + Math.min(5, Math.log2(node.weight + 1))) * Math.min(1.2, Math.max(.65, cam.zoom));
        ctx.globalAlpha = active || onPath ? 1 : .2;
        if (chosen || onPath) { ctx.fillStyle = chosen ? '#6bddbf18' : '#fcce8520'; ctx.beginPath(); ctx.arc(x, y, radius + 9, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = chosen ? '#6bddbf' : '#fcce85'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = COLORS[node.kind];
        ctx.beginPath();
        if (node.kind === 'artifact') ctx.roundRect(x - radius, y - radius, radius * 2, radius * 2, 3);
        else ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (node.findings) { ctx.fillStyle = '#ff7a92'; ctx.beginPath(); ctx.arc(x + radius - 1, y - radius, 3, 0, Math.PI * 2); ctx.fill(); }
        if (chosen || onPath || (active && (cam.zoom > .75 || node.kind === 'artifact' || (node.sources || 0) > 2))) {
          const label = node.label.length > 42 ? node.label.slice(0, 39) + '…' : node.label;
          ctx.font = `${chosen ? '600 ' : ''}11px system-ui`; const labelWidth = ctx.measureText(label).width;
          ctx.fillStyle = '#111823e8'; ctx.fillRect(x - labelWidth / 2 - 4, y + radius + 4, labelWidth + 8, 16);
          ctx.fillStyle = chosen ? '#e2fff5' : '#b3c3d9'; ctx.textAlign = 'center'; ctx.fillText(label, x, y + radius + 16); ctx.textAlign = 'left';
        }
      });
      ctx.globalAlpha = 1;
    };
    const world = (event: PointerEvent | WheelEvent) => { const rect = surface.getBoundingClientRect(), cam = camera.current; return [(event.clientX - rect.left - dimensions.current.width / 2) / cam.zoom - cam.x, (event.clientY - rect.top - dimensions.current.height / 2) / cam.zoom - cam.y]; };
    let drag: { id: string; index: number; startX: number; startY: number; cameraX: number; cameraY: number; moved: boolean } | null = null;
    const hit = (x: number, y: number) => { let best = -1, distance = Infinity; data.nodes.forEach((_, i) => { const d = Math.hypot(positions.current[i * 2] - x, positions.current[i * 2 + 1] - y); if (d < 16 / camera.current.zoom && d < distance) { best = i; distance = d; } }); return best; };
    const down = (event: PointerEvent) => { if (event.button !== 0) return; interacted = true; const [x, y] = world(event), i = hit(x, y); drag = { id: i >= 0 ? data.nodes[i].id : '', index: i, startX: event.clientX, startY: event.clientY, cameraX: camera.current.x, cameraY: camera.current.y, moved: false }; surface.setPointerCapture(event.pointerId); surface.style.cursor = i >= 0 ? 'grabbing' : 'move'; };
    const move = (event: PointerEvent) => {
      if (!drag) { const [x, y] = world(event); surface.style.cursor = hit(x, y) >= 0 ? 'pointer' : 'grab'; return; }
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
      if (drag.index >= 0 && drag.moved) { const [x, y] = world(event); positions.current[drag.index * 2] = x; positions.current[drag.index * 2 + 1] = y; worker.current?.postMessage({ type: 'pin', id: drag.id, x, y }); }
      else if (drag.index < 0) { camera.current.x = drag.cameraX + (event.clientX - drag.startX) / camera.current.zoom; camera.current.y = drag.cameraY + (event.clientY - drag.startY) / camera.current.zoom; }
      paint.current();
    };
    const up = () => { if (drag && !drag.moved) onSelect(drag.index >= 0 ? data.nodes[drag.index] : null); drag = null; surface.style.cursor = 'grab'; };
    const wheel = (event: WheelEvent) => { event.preventDefault(); interacted = true; const [x, y] = world(event), old = camera.current.zoom, next = Math.max(.15, Math.min(3.5, old * Math.exp(-event.deltaY * .001))); camera.current.x = (x + camera.current.x) * old / next - x; camera.current.y = (y + camera.current.y) * old / next - y; camera.current.zoom = next; setZoom(Math.round(next * 100)); paint.current(); };
    surface.addEventListener('pointerdown', down); surface.addEventListener('pointermove', move); surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', up); surface.addEventListener('wheel', wheel, { passive: false });
    return () => { resize.disconnect(); worker.current?.terminate(); surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', up); surface.removeEventListener('wheel', wheel); };
  // Selection uses a ref; do not restart the layout when inspecting a node.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, generation]);
  useEffect(() => { paint.current(); }, [selected]);
  useEffect(() => { pathNodes.current = new Set(route); paint.current(); }, [route]);

  async function findRoute() {
    if (!source || !target) return;
    try { const result = await window.atlas.api<{ nodes: string[] }>(`/cases/${caseId}/path?source=${source}&target=${target}`); setRoute(result.nodes); if (!result.nodes.length) onError('No observed connection between these nodes.'); }
    catch (e) { onError((e as Error).message); }
  }
  return <div className="graph-wrap" ref={host}>
    <canvas ref={canvas} aria-label="Evidence relationship graph. Select a node with the dropdown for keyboard access." />
    <div className="graph-top"><span className="chip"><span className="live-dot" />{status}</span><span className="chip muted">{data.nodes.length} nodes · {data.edges.length} links{data.truncated ? ` · ${data.total} total` : ''}</span></div>
    <div className="graph-tools"><button title="Fit graph" aria-label="Fit graph" onClick={fit}><Crosshair size={17} /></button><button title="Zoom in" aria-label="Zoom in" onClick={() => { camera.current.zoom = Math.min(3.5, camera.current.zoom * 1.2); setZoom(Math.round(camera.current.zoom * 100)); paint.current(); }}><ZoomIn size={17} /></button><span>{zoom}%</span><button title="Zoom out" aria-label="Zoom out" onClick={() => { camera.current.zoom = Math.max(.15, camera.current.zoom / 1.2); setZoom(Math.round(camera.current.zoom * 100)); paint.current(); }}><ZoomOut size={17} /></button><button title="Rearrange graph" aria-label="Rearrange graph" onClick={() => setGeneration(g => g + 1)}><RotateCcw size={16} /></button><button className={routeOpen ? 'active' : ''} title="Trace a connection" aria-label="Trace a connection" onClick={() => setRouteOpen(!routeOpen)}><Route size={17} /></button></div>
    <div className="graph-picker"><select aria-label="Select graph node" value={selected} onChange={e => onSelect(data.nodes.find(n => n.id === e.target.value) || null)}><option value="">Inspect a node…</option>{data.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></div>
    {routeOpen && <div className="route-panel"><div className="section-label">TRACE OBSERVED CONNECTION</div><select aria-label="Path source" value={source} onChange={e => setSource(e.target.value)}><option value="">From…</option>{data.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><select aria-label="Path target" value={target} onChange={e => setTarget(e.target.value)}><option value="">To…</option>{data.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><button className="primary" disabled={!source || !target} onClick={findRoute}><Route size={15} /> Trace</button>{route.length > 0 && <div className="route-result">{route.length - 1} observed hops<button aria-label="Clear path" onClick={() => setRoute([])}><X size={12} /></button></div>}</div>}
    <div className="graph-legend">{(['artifact', 'domain', 'ip', 'url', 'email'] as Kind[]).map(kind => <span key={kind}><i style={{ background: COLORS[kind], borderRadius: kind === 'artifact' ? 2 : '50%' }} />{KIND_LABELS[kind]}</span>)}</div>
    <div className="graph-hint">Drag nodes · Scroll to zoom · Drag background to pan</div>
    {!data.nodes.length && <div className="graph-empty">Import evidence to build your graph.</div>}
  </div>;
}
