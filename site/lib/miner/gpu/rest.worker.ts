// The GPU loop's clock for its duty cycle. A page's own timers slow to about one a second while its tab
// is hidden; a worker's do not. So the rests between dispatches are timed here, and the GPU keeps mining
// in a background tab as the CPU threads do.
const ctx = self as unknown as {
  postMessage: (id: number) => void;
  onmessage: ((e: MessageEvent<{ id: number; ms: number }>) => void) | null;
};

ctx.onmessage = (e) => {
  const { id, ms } = e.data;
  setTimeout(() => ctx.postMessage(id), ms);
};
