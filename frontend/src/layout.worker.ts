/// <reference lib="webworker" />
import { createLayout } from './layout.mjs';
let layout: ReturnType<typeof createLayout> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
function tick() {
  if (!layout) return;
  const copy = layout.step(3).slice();
  self.postMessage({ positions: copy, iteration: layout.iteration }, [copy.buffer]);
  if (layout.iteration < 600) timer = setTimeout(tick, layout.positions.length > 4000 ? 60 : 25);
}
self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    clearTimeout(timer);
    layout = createLayout(message.nodes, message.edges);
    tick();
  }
  if (message.type === 'pin' && layout) layout.pin(message.id, message.x, message.y);
};
