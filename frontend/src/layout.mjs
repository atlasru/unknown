// Deterministic Barnes-Hut force layout, independent of DOM and rendering.
export function createLayout(nodes, edges) {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const positions = new Float32Array(nodes.length * 2);
  const velocities = new Float32Array(nodes.length * 2);
  const pinned = new Map();
  const links = edges.map(e => [index.get(e.source), index.get(e.target), e.relation]).filter(e => e[0] !== undefined && e[1] !== undefined);
  for (let i = 0; i < nodes.length; i++) {
    const a = i * 2.3999632297, r = 38 * Math.sqrt(i + 1);
    positions[i * 2] = Math.cos(a) * r; positions[i * 2 + 1] = Math.sin(a) * r;
  }
  let iteration = 0;

  function tree() {
    let extent = 100;
    for (const p of positions) extent = Math.max(extent, Math.abs(p) + 1);
    const root = { x: -extent, y: -extent, size: extent * 2, mass: 0, cx: 0, cy: 0, children: null, point: -1 };
    function insert(cell, i, depth) {
      const x = positions[i * 2], y = positions[i * 2 + 1];
      const oldMass = cell.mass;
      cell.mass++; cell.cx = (cell.cx * oldMass + x) / cell.mass; cell.cy = (cell.cy * oldMass + y) / cell.mass;
      if (cell.point === -1 && !cell.children) { cell.point = i; return; }
      if (depth > 20) return;
      if (!cell.children) {
        const s = cell.size / 2;
        cell.children = Array.from({ length: 4 }, (_, q) => ({ x: cell.x + (q & 1) * s, y: cell.y + (q >> 1) * s, size: s, mass: 0, cx: 0, cy: 0, children: null, point: -1 }));
        const previous = cell.point; cell.point = -1;
        const q = (positions[previous * 2] >= cell.x + s ? 1 : 0) + (positions[previous * 2 + 1] >= cell.y + s ? 2 : 0);
        insert(cell.children[q], previous, depth + 1);
      }
      const s = cell.size / 2, q = (x >= cell.x + s ? 1 : 0) + (y >= cell.y + s ? 2 : 0);
      insert(cell.children[q], i, depth + 1);
    }
    for (let i = 0; i < nodes.length; i++) insert(root, i, 0);
    return root;
  }

  function step(count = 1) {
    for (let k = 0; k < count; k++) {
      const root = tree(), cooling = Math.max(.1, 1 - iteration / 450);
      for (let i = 0; i < nodes.length; i++) {
        if (pinned.has(i)) continue;
        const x = positions[i * 2], y = positions[i * 2 + 1];
        let fx = -x * .006, fy = -y * .006;
        function force(cell) {
          if (!cell.mass || (cell.mass === 1 && cell.point === i)) return;
          let dx = x - cell.cx, dy = y - cell.cy;
          const d2 = dx * dx + dy * dy + 40;
          const inside = x >= cell.x && x <= cell.x + cell.size && y >= cell.y && y <= cell.y + cell.size;
          if (!cell.children || (!inside && cell.size * cell.size < d2 * .64)) {
            if (dx === 0 && dy === 0) { dx = Math.sin(i + 1); dy = Math.cos(i + 1); }
            const strength = 2400 * cell.mass / d2;
            fx += dx * strength / Math.sqrt(d2); fy += dy * strength / Math.sqrt(d2);
          } else cell.children.forEach(force);
        }
        force(root);
        velocities[i * 2] += fx * cooling; velocities[i * 2 + 1] += fy * cooling;
      }
      for (const [source, target, relation] of links) {
        const dx = positions[target * 2] - positions[source * 2], dy = positions[target * 2 + 1] - positions[source * 2 + 1];
        const distance = Math.sqrt(dx * dx + dy * dy) || 1, desired = relation === 'mentions' ? 125 : 85;
        const strength = (distance - desired) * .009 * cooling;
        const fx = dx / distance * strength, fy = dy / distance * strength;
        velocities[source * 2] += fx; velocities[source * 2 + 1] += fy;
        velocities[target * 2] -= fx; velocities[target * 2 + 1] -= fy;
      }
      for (let i = 0; i < nodes.length; i++) {
        if (pinned.has(i)) { positions[i * 2] = pinned.get(i)[0]; positions[i * 2 + 1] = pinned.get(i)[1]; velocities[i * 2] = velocities[i * 2 + 1] = 0; continue; }
        velocities[i * 2] = Math.max(-12, Math.min(12, velocities[i * 2] * .78));
        velocities[i * 2 + 1] = Math.max(-12, Math.min(12, velocities[i * 2 + 1] * .78));
        positions[i * 2] += velocities[i * 2]; positions[i * 2 + 1] += velocities[i * 2 + 1];
      }
      iteration++;
    }
    return positions;
  }
  return { step, positions, pin: (id, x, y) => { const i = index.get(id); if (i !== undefined) pinned.set(i, [x, y]); }, unpin: id => pinned.delete(index.get(id)), get iteration() { return iteration; } };
}
