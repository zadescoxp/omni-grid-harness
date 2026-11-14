// Side-panel renderers: live negotiation log, agent cards and the policy comparison.
import { STATUS } from "./map.js";

const ACTIONS = ["Full request", "Essential only", "Critical only", "Drawing backup"];
const LOG_ICONS = {
  event: "event", negotiation: "nego", agreement: "ok", fallback: "fallback", safety: "safety",
  alert: "alert", recovery: "ok", cascade: "cascade", info: "info",
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 1) => Number(v).toFixed(d);

export function renderLog(el, ticks, index) {
  if (!ticks || !ticks.length) {
    el.innerHTML = `<div class="empty">Run a simulation to watch the agents negotiate.</div>`;
    return;
  }
  const items = [];
  for (let i = Math.min(index, ticks.length - 1); i >= 0 && items.length < 220; i--) {
    for (let j = ticks[i].log.length - 1; j >= 0; j--) items.push(ticks[i].log[j]);
  }
  if (!items.length) {
    el.innerHTML = `<div class="empty">Grid is stable: supply covers every utility’s full load.</div>`;
    return;
  }
  el.innerHTML = items.map((m) => `
    <div class="log-item k-${LOG_ICONS[m.kind] || "info"}">
      <span class="log-time">${esc(m.time)}</span>
      <span class="log-text">${esc(m.text)}</span>
    </div>`).join("");
}

export function renderAgents(el, meta, tick, selected) {
  el.innerHTML = meta.utilities.map((u) => {
    const s = tick ? tick.utilities[u.id] : null;
    const status = s ? s.status : "full";
    const full = s ? s.critical + s.essential + s.deferrable : u.full;
    const pct = (v) => `${Math.max(0, Math.min(100, (v / full) * 100)).toFixed(1)}%`;
    const crit = s ? s.critical : u.critical;
    const ess = s ? s.essential : u.essential;
    const served = s ? s.served : u.full;
    const alloc = s ? s.alloc : u.full;
    const buffer = s ? s.buffer_pct : 1;
    const action = s && s.action !== null && s.action !== undefined ? ACTIONS[s.action] : "—";
    const deps = u.depends_on.length
      ? u.depends_on.map((d) => meta.utilities.find((x) => x.id === d).name.split(" ")[0]).join(", ")
      : "none";
    return `
      <article class="agent ${selected === u.id ? "selected" : ""}" data-id="${u.id}" style="--status:${STATUS[status].color}">
        <header>
          <span class="agent-icon">${u.icon}</span>
          <div class="agent-title">
            <h4>${esc(u.name)}</h4>
            <span>${esc(u.area)} · priority ${fmt(u.base_priority, 1)}${u.life_critical ? " · life-critical" : ""}</span>
          </div>
          <span class="pill">${STATUS[status].label}</span>
        </header>
        <div class="tiers" title="Critical | essential | deferrable load">
          <span class="t-crit" style="width:${pct(crit)}"></span>
          <span class="t-ess" style="width:${pct(ess)}"></span>
          <span class="t-def" style="width:${pct(full - crit - ess)}"></span>
          <i class="served" style="width:${pct(served)}"></i>
        </div>
        <dl>
          <div><dt>Grid</dt><dd>${fmt(alloc)} MW</dd></div>
          <div><dt>Served</dt><dd>${fmt(served)} / ${fmt(full)}</dd></div>
          <div><dt>Backup</dt><dd>${u.buffer_capacity > 0 ? `${Math.round(buffer * 100)}%` : "none"}</dd></div>
          <div><dt>Last bid</dt><dd>${action}</dd></div>
          <div><dt>Credit</dt><dd>${s ? s.credit : 0}</dd></div>
          <div><dt>Harm/tick</dt><dd>${s ? fmt(s.damage) : "0.0"}</dd></div>
        </dl>
        <footer>Depends on: ${esc(deps)}${s && s.effectiveness < 1 ? ` · <b>effectiveness ${Math.round(s.effectiveness * 100)}%</b>` : ""}</footer>
      </article>`;
  }).join("");
}

export function renderCompare(el, data, policies, activePolicy) {
  if (!data) {
    el.innerHTML = `<div class="empty">Loading comparison…</div>`;
    return;
  }
  const rows = policies.map((p) => ({ ...p, s: data.results[p.id].summary }));
  const maxD = Math.max(...rows.map((r) => r.s.total_damage));
  const bestBase = Math.min(data.results.static_priority.summary.total_damage,
                            data.results.uncoordinated.summary.total_damage);
  const rl = data.results.gridpact_rl.summary.total_damage;
  const cut = bestBase > 0 ? Math.round((1 - rl / bestBase) * 100) : 0;
  el.innerHTML = `
    <div class="headline"><b>${cut}%</b> less total damage than the best non-negotiating baseline</div>
    <div class="bars">
      ${rows.map((r) => `
        <div class="bar-row ${r.id === activePolicy ? "active" : ""}">
          <span class="bar-name">${esc(r.name)}</span>
          <span class="bar-track"><span class="bar-fill p-${r.id}" style="width:${((r.s.total_damage / maxD) * 100).toFixed(1)}%"></span></span>
          <span class="bar-val">${Math.round(r.s.total_damage).toLocaleString()}</span>
        </div>`).join("")}
    </div>
    <table class="metrics">
      <thead><tr><th></th>${rows.map((r) => `<th>${esc(r.name.replace("GridPact · ", "").replace(" (today)", ""))}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><td>Cascade events</td>${rows.map((r) => `<td>${r.s.cascade_events}</td>`).join("")}</tr>
        <tr><td>Critical hours lost</td>${rows.map((r) => `<td>${fmt(r.s.critical_hours_lost)}</td>`).join("")}</tr>
        <tr><td>Longest outage (h)</td>${rows.map((r) => `<td>${fmt(r.s.max_starvation_ticks / 4)}</td>`).join("")}</tr>
        <tr><td>Avg fairness (Jain)</td>${rows.map((r) => `<td>${fmt(r.s.avg_fairness, 3)}</td>`).join("")}</tr>
        <tr><td>Capacity violations</td>${rows.map((r) => `<td>${r.s.capacity_violations}</td>`).join("")}</tr>
        <tr><td>Max rounds / tick</td>${rows.map((r) => `<td>${r.s.max_rounds || "—"}</td>`).join("")}</tr>
      </tbody>
    </table>`;
}
