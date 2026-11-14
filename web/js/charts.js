// Canvas infographics: dot-matrix timeline, hourly damage bars, policy bars, cumulative lines, learning curve.

export const COLORS = {
  ink: "#0E0F0C",
  ink2: "#3B3D36",
  muted: "#878980",
  line: "#ECECE6",
  soft: "#F4F4F0",
  lime: "#C8F031",
  limeDeep: "#8DB512",
  red: "#F04438",
  future: "#D9D9D2",
  ghost: "#EFEFEA",
};

export const POLICY_COLORS = {
  harness_rl: COLORS.lime,
  harness_rules: COLORS.ink,
  static_priority: "#B9BBB2",
  uncoordinated: "#F04438",
};

const FONT = "600 10.5px Manrope, Inter, system-ui, sans-serif";

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
  ctx.font = FONT;
  return { ctx, w, h };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hatch(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  for (let i = -h; i < w + h; i += 5) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

const fmt = (v) => Math.round(v).toLocaleString();

/**
 * Dot-matrix timeline. Each column is one 15-minute tick; dots stack up to the grid supply.
 * Past ticks: ink = critical load served from the grid, lime = essential/deferrable served,
 * red rings = critical demand the grid could not cover. Future ticks show forecast supply in grey.
 */
export function drawDotTimeline(canvas, { ticks, supply, index }) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 50, r: 6, t: 14, b: 18 };
  const n = supply.length;
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const col = iw / n;
  const rows = Math.max(6, Math.floor(ih / col));
  const rowH = ih / rows;
  const r = Math.max(1, Math.min(col, rowH) * 0.32);
  const peak = Math.max(...supply, ...(ticks || []).map((t) => t.demand.critical));
  const maxV = Math.ceil((peak * 1.06) / 10) * 10;
  const step = maxV / rows;
  const cx = (i) => pad.l + col * (i + 0.5);
  const cy = (k) => pad.t + ih - rowH * (k + 0.5);
  const hasRun = ticks && ticks.length;
  const now = hasRun ? Math.min(index, ticks.length - 1) : -1;

  // axis labels
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  for (const v of [0, Math.round(maxV / 2), maxV]) {
    const y = pad.t + ih - (v / maxV) * ih;
    ctx.fillText(v === maxV ? `${v} MW` : `${v}`, pad.l - 8, y + 3.5);
  }
  ctx.textAlign = "center";
  for (let hr = 0; hr <= 24; hr += 3) {
    const x = pad.l + (hr * 4 / n) * iw;
    ctx.fillText(`${String(hr).padStart(2, "0")}:00`, Math.min(Math.max(x, pad.l + 14), w - 18), h - 3);
  }

  for (let i = 0; i < n; i++) {
    const past = hasRun && i <= now;
    const t = past ? ticks[i] : null;
    const sup = t ? t.supply : supply[i];
    const alloc = t ? t.allocated : 0;
    const crit = t ? t.demand.critical : 0;
    for (let k = 0; k < rows; k++) {
      const v = (k + 0.5) * step;
      let fill = null;
      let ring = null;
      if (past) {
        if (v <= Math.min(alloc, crit)) fill = COLORS.ink;
        else if (v <= alloc) fill = COLORS.lime;
        else if (v <= crit) ring = COLORS.red;
        else if (v <= sup) fill = COLORS.future;
        else fill = COLORS.ghost;
      } else {
        fill = v <= sup ? COLORS.future : COLORS.ghost;
      }
      ctx.beginPath();
      ctx.arc(cx(i), cy(k), ring ? r * 0.95 : r, 0, Math.PI * 2);
      if (ring) {
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
  }

  if (hasRun) {
    const x = cx(now);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, pad.t - 2);
    ctx.lineTo(x, pad.t + ih + 2);
    ctx.stroke();
    const label = ticks[now].time;
    ctx.font = "800 10.5px Manrope, Inter, system-ui, sans-serif";
    const tw = ctx.measureText(label).width + 12;
    const bx = Math.min(Math.max(x - tw / 2, pad.l), w - tw - 2);
    ctx.fillStyle = COLORS.ink;
    roundRect(ctx, bx, 0, tw, 14, 7);
    ctx.fill();
    ctx.fillStyle = COLORS.lime;
    ctx.textAlign = "center";
    ctx.fillText(label, bx + tw / 2, 10.5);
  }
  return { x0: pad.l, width: iw, n };
}

/** 24 hourly bars of damage: past hours ink, the current hour lime, future hours ghosted. */
export function drawDamageBars(canvas, ticks, index) {
  const { ctx, w, h } = setup(canvas);
  const hours = new Array(24).fill(0);
  const hasRun = ticks && ticks.length;
  const now = hasRun ? Math.min(index, ticks.length - 1) : -1;
  if (hasRun) for (let i = 0; i <= now; i++) hours[Math.floor(i / 4)] += ticks[i].damage_tick;
  const curHour = now >= 0 ? Math.floor(now / 4) : -1;
  const max = Math.max(1, ...hours);
  const gap = 2;
  const bw = (w - gap * 23) / 24;
  for (let k = 0; k < 24; k++) {
    const x = k * (bw + gap);
    const v = hours[k];
    const bh = v > 0 ? Math.max(3, (v / max) * (h - 2)) : 3;
    ctx.fillStyle = k === curHour ? COLORS.lime : k < curHour ? COLORS.ink : COLORS.ghost;
    roundRect(ctx, x, h - bh, bw, bh, Math.min(3, bw / 2));
    ctx.fill();
  }
}

/** Vertical bars per policy. Omni Grid Harness bars are solid; baselines are hatched. */
export function drawPolicyBars(canvas, rows) {
  const { ctx, w, h } = setup(canvas);
  if (!rows || !rows.length) return;
  const pad = { l: 8, r: 8, t: 26, b: 34 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(...rows.map((r) => r.value)) * 1.05;
  const slot = iw / rows.length;
  const bw = Math.min(86, slot * 0.58);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (ih * g) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }
  rows.forEach((r, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    const bh = Math.max(6, (r.value / max) * ih);
    const y = pad.t + ih - bh;
    roundRect(ctx, x, y, bw, bh, 14);
    if (r.solid) {
      ctx.fillStyle = r.color;
      ctx.fill();
    } else {
      ctx.fillStyle = COLORS.soft;
      ctx.fill();
      ctx.save();
      roundRect(ctx, x, y, bw, bh, 14);
      ctx.clip();
      hatch(ctx, x, y, bw, bh, r.color);
      ctx.restore();
    }
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "center";
    ctx.font = "800 13px Manrope, Inter, system-ui, sans-serif";
    ctx.fillText(fmt(r.value), x + bw / 2, y - 8);
    ctx.font = FONT;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(r.label, x + bw / 2, h - 16);
    if (r.sub) ctx.fillText(r.sub, x + bw / 2, h - 3);
  });
}

/** Cumulative damage per policy over the 24h episode. */
export function drawCumulative(canvas, series) {
  const { ctx, w, h } = setup(canvas);
  const ids = Object.keys(series || {});
  if (!ids.length) return;
  const pad = { l: 46, r: 12, t: 10, b: 20 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = series[ids[0]].length;
  const max = Math.max(...ids.map((id) => series[id][n - 1])) * 1.05;
  const x = (i) => pad.l + (i / (n - 1)) * iw;
  const y = (v) => pad.t + ih - (v / max) * ih;

  ctx.strokeStyle = COLORS.line;
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  for (let g = 0; g <= 4; g++) {
    const v = (max * g) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
    ctx.fillText(fmt(v), pad.l - 8, y(v) + 3.5);
  }
  ctx.textAlign = "center";
  for (let hr = 0; hr <= 24; hr += 6) ctx.fillText(`${String(hr).padStart(2, "0")}:00`, x(Math.min(n - 1, hr * 4)), h - 4);

  const order = ["static_priority", "uncoordinated", "harness_rules", "harness_rl"].filter((id) => series[id]);
  for (const id of order) {
    const s = series[id];
    const rl = id === "harness_rl";
    if (rl) {
      ctx.beginPath();
      ctx.moveTo(x(0), y(0));
      s.forEach((v, i) => ctx.lineTo(x(i), y(v)));
      ctx.lineTo(x(n - 1), y(0));
      ctx.closePath();
      ctx.fillStyle = "rgba(200, 240, 49, 0.28)";
      ctx.fill();
    }
    ctx.beginPath();
    s.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = rl ? COLORS.ink : POLICY_COLORS[id];
    ctx.lineWidth = rl ? 2.6 : 1.8;
    ctx.setLineDash(id === "static_priority" ? [5, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x(n - 1), y(s[n - 1]), rl ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = rl ? COLORS.lime : POLICY_COLORS[id];
    ctx.fill();
    if (rl) { ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.6; ctx.stroke(); }
  }
}

/** Greedy-policy damage across training, against the rule-based baseline, with live runs marked. */
export function drawLearning(canvas, curve) {
  const { ctx, w, h } = setup(canvas);
  const evals = (curve || []).filter((p) => p.kind === "eval");
  const live = (curve || []).filter((p) => p.kind === "live");
  if (evals.length < 2) {
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("Train the agents to see a learning curve: python3 -m omnigrid.train", 8, h / 2);
    return;
  }
  const pad = { l: 46, r: 12, t: 12, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const maxE = Math.max(...evals.map((p) => p.episode), ...live.map((p) => p.episode), 1);
  const vals = evals.map((p) => p.total).concat(evals.map((p) => p.heuristic_total));
  const lo = Math.min(...vals) * 0.96;
  const hi = Math.max(...vals) * 1.03;
  const x = (e) => pad.l + (e / maxE) * iw;
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  ctx.strokeStyle = COLORS.line;
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  for (let g = 0; g <= 3; g++) {
    const v = lo + ((hi - lo) * g) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
    ctx.fillText(fmt(v), pad.l - 8, y(v) + 3.5);
  }
  ctx.textAlign = "left";
  ctx.fillText("Episode 0", pad.l, h - 4);
  ctx.textAlign = "right";
  ctx.fillText(`${maxE.toLocaleString()} episodes`, w - pad.r, h - 4);

  const base = evals[0].heuristic_total;
  ctx.strokeStyle = "#B9BBB2";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(pad.l, y(base)); ctx.lineTo(w - pad.r, y(base)); ctx.stroke();
  ctx.setLineDash([]);

  // raw evaluations as faint dots, with a rolling mean as the main line
  ctx.fillStyle = "rgba(14, 15, 12, 0.18)";
  for (const p of evals) { ctx.beginPath(); ctx.arc(x(p.episode), y(p.total), 2, 0, Math.PI * 2); ctx.fill(); }
  const win = Math.max(1, Math.round(evals.length / 8));
  const smooth = evals.map((p, i) => {
    const part = evals.slice(Math.max(0, i - win), Math.min(evals.length, i + win + 1));
    return { episode: p.episode, total: part.reduce((a, q) => a + q.total, 0) / part.length };
  });
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  smooth.forEach((p, i) => (i ? ctx.lineTo(x(p.episode), y(p.total)) : ctx.moveTo(x(p.episode), y(p.total))));
  ctx.stroke();

  let best = evals[0];
  for (const p of evals) if (p.total < best.total) best = p;
  const bx = x(best.episode);
  const by = y(best.total);
  ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.lime; ctx.fill();
  ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.8; ctx.stroke();
  const label = `best ${fmt(best.total)}`;
  ctx.font = "800 10.5px Manrope, Inter, system-ui, sans-serif";
  const tw = ctx.measureText(label).width + 12;
  const lx = Math.min(Math.max(bx - tw / 2, pad.l), w - pad.r - tw);
  const ly = by + 28 > pad.t + ih ? by - 26 : by + 10;   // flip above the point near the bottom
  ctx.fillStyle = COLORS.ink;
  roundRect(ctx, lx, ly, tw, 16, 8); ctx.fill();
  ctx.fillStyle = COLORS.lime; ctx.textAlign = "center";
  ctx.fillText(label, lx + tw / 2, ly + 11.5);

  for (const p of live) {
    ctx.beginPath(); ctx.arc(x(p.episode), pad.t + 4, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.lime; ctx.fill();
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.2; ctx.stroke();
  }
}
