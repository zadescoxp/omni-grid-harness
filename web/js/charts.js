// Small hand-rolled canvas charts: the episode timeline and the RL learning curve.

const C = {
  supply: "#2B2A3F",
  critical: "#D93A3F",
  allocated: "rgba(91, 79, 214, 0.22)",
  allocatedLine: "#5B4FD6",
  grid: "rgba(43, 42, 63, 0.08)",
  text: "#6B6880",
  event: "rgba(217, 58, 63, 0.55)",
  playhead: "#F5A524",
  heuristic: "#9A97AE",
  rl: "#5B4FD6",
  live: "#F5A524",
};

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Supply, critical demand and allocated power across the 24h episode, with a playhead. */
export function drawTimeline(canvas, { ticks, supply, events, index }) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 30, r: 8, t: 8, b: 16 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = supply.length;
  const maxV = Math.max(100, ...supply, ...(ticks || []).map((t) => t.demand.full)) * 1.05;
  const x = (i) => pad.l + (i / (n - 1)) * iw;
  const y = (v) => pad.t + ih - (v / maxV) * ih;

  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (const v of [0, 25, 50, 75, 100]) {
    if (v > maxV) continue;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
    ctx.fillText(String(v), 4, y(v) + 3);
  }
  for (let hr = 0; hr <= 24; hr += 6) {
    const xi = x(Math.min(n - 1, hr * 4));
    ctx.fillText(`${String(hr).padStart(2, "0")}h`, Math.min(xi - 8, w - 24), h - 3);
  }

  for (const ev of events || []) {
    const xi = x(Math.min(n - 1, ev.hour * 4));
    ctx.strokeStyle = C.event;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(xi, pad.t); ctx.lineTo(xi, pad.t + ih); ctx.stroke();
    ctx.setLineDash([]);
  }

  if (ticks && ticks.length) {
    const upto = Math.min(index, ticks.length - 1);
    ctx.fillStyle = C.allocated;
    ctx.beginPath();
    ctx.moveTo(x(0), y(0));
    for (let i = 0; i <= upto; i++) ctx.lineTo(x(i), y(ticks[i].allocated));
    ctx.lineTo(x(upto), y(0));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.allocatedLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) i ? ctx.lineTo(x(i), y(ticks[i].allocated)) : ctx.moveTo(x(i), y(ticks[i].allocated));
    ctx.stroke();

    ctx.strokeStyle = C.critical;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ticks.forEach((t, i) => (i ? ctx.lineTo(x(i), y(t.demand.critical)) : ctx.moveTo(x(i), y(t.demand.critical))));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = C.supply;
  ctx.lineWidth = 2;
  ctx.beginPath();
  supply.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.stroke();

  if (ticks && ticks.length) {
    const px = x(Math.min(index, n - 1));
    ctx.strokeStyle = C.playhead;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, pad.t - 4); ctx.lineTo(px, pad.t + ih); ctx.stroke();
    ctx.fillStyle = C.playhead;
    ctx.beginPath(); ctx.arc(px, pad.t - 2, 4, 0, Math.PI * 2); ctx.fill();
  }
  return { x0: pad.l, width: iw, n };
}

/** Greedy-policy damage on the three demo scenarios across training, against the rule-based baseline. */
export function drawLearning(canvas, curve) {
  const { ctx, w, h } = setup(canvas);
  const evals = curve.filter((p) => p.kind === "eval");
  const live = curve.filter((p) => p.kind === "live");
  ctx.font = "10px Inter, system-ui, sans-serif";
  if (evals.length < 2) {
    ctx.fillStyle = C.text;
    ctx.fillText("Train the agents to see a learning curve: python -m omnigrid.train", 8, h / 2);
    return;
  }
  const pad = { l: 40, r: 10, t: 10, b: 18 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const maxE = Math.max(...evals.map((p) => p.episode), ...live.map((p) => p.episode), 1);
  const vals = evals.map((p) => p.total).concat(evals.map((p) => p.heuristic_total));
  const lo = Math.min(...vals) * 0.97;
  const hi = Math.max(...vals) * 1.02;
  const x = (e) => pad.l + (e / maxE) * iw;
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  ctx.strokeStyle = C.grid;
  ctx.fillStyle = C.text;
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
    ctx.fillText(Math.round(v).toLocaleString(), 2, y(v) + 3);
  }
  ctx.fillText("0", pad.l - 3, h - 4);
  const endLabel = `${maxE.toLocaleString()} episodes`;
  ctx.fillText(endLabel, w - pad.r - ctx.measureText(endLabel).width, h - 4);

  const base = evals[0].heuristic_total;
  ctx.strokeStyle = C.heuristic;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, y(base)); ctx.lineTo(w - pad.r, y(base)); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = C.rl;
  ctx.lineWidth = 2;
  ctx.beginPath();
  evals.forEach((p, i) => (i ? ctx.lineTo(x(p.episode), y(p.total)) : ctx.moveTo(x(p.episode), y(p.total))));
  ctx.stroke();

  let best = evals[0];
  for (const p of evals) if (p.total < best.total) best = p;
  ctx.fillStyle = C.rl;
  ctx.beginPath(); ctx.arc(x(best.episode), y(best.total), 4, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = C.live;
  for (const p of live) {
    ctx.beginPath(); ctx.arc(x(p.episode), pad.t + 4, 3, 0, Math.PI * 2); ctx.fill();
  }
}
