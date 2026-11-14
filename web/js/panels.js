// Side-panel and compare-view renderers.
import { icon, KIND_ICON, LOG_ICON } from "./icons.js";
import { STATUS } from "./map.js";
import { POLICY_COLORS } from "./charts.js";

const ACTIONS = ["Full", "Essential", "Critical", "Backup"];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 1) => Number(v).toFixed(d);

export const POLICY_SHORT = {
  harness_rl: "Harness RL",
  harness_rules: "Harness rules",
  static_priority: "Static priority",
  uncoordinated: "Uncoordinated",
};

/** Negotiation feed, newest first, grouped by hour. */
export function renderFeed(el, ticks, index) {
  if (!ticks || !ticks.length) {
    el.innerHTML = `<div class="empty">Run a simulation to watch the agents negotiate.</div>`;
    return;
  }
  const groups = [];
  for (let i = Math.min(index, ticks.length - 1); i >= 0 && groups.reduce((a, g) => a + g.items.length, 0) < 160; i--) {
    const items = ticks[i].log;
    if (!items.length) continue;
    const hour = ticks[i].time.slice(0, 2);
    let g = groups[groups.length - 1];
    if (!g || g.hour !== hour) groups.push((g = { hour, items: [] }));
    for (let j = items.length - 1; j >= 0; j--) g.items.push(items[j]);
  }
  if (!groups.length) {
    el.innerHTML = `<div class="empty">Grid is stable: supply covers every utility’s full load.</div>`;
    return;
  }
  el.innerHTML = groups.map((g) => `
    <div class="feed-hour">${g.hour}:00</div>
    ${g.items.map((m) => `
      <div class="feed-item t-${m.kind}">
        <span class="feed-icon">${icon(LOG_ICON[m.kind] || "info", 16)}</span>
        <span class="feed-text">${esc(m.text)}</span>
        <span class="feed-time">${esc(m.time)}</span>
      </div>`).join("")}`).join("");
}

/** Compact agent rows: status, served MW, a tiered capsule bar, and expandable detail. */
export function renderAgents(el, meta, tick, selected) {
  el.innerHTML = meta.utilities.map((u) => {
    const s = tick ? tick.utilities[u.id] : null;
    const status = s ? s.status : "full";
    const crit = s ? s.critical : u.critical;
    const ess = s ? s.essential : u.essential;
    const def = s ? s.deferrable : u.deferrable;
    const full = crit + ess + def;
    const pct = (v) => `${Math.max(0, Math.min(100, (v / full) * 100)).toFixed(1)}%`;
    const grid = s ? s.alloc : u.full;
    const backup = s ? s.discharged : 0;
    const served = s ? s.served : u.full;
    const deps = u.depends_on.length
      ? u.depends_on.map((d) => meta.utilities.find((x) => x.id === d).short).join(", ")
      : "none";
    const open = selected === u.id;
    return `
      <div class="agent ${open ? "selected" : ""}" data-id="${u.id}" data-status="${status}" style="--status:${STATUS[status].color}">
        <div class="agent-row">
          <span class="agent-icon">${icon(KIND_ICON[u.kind], 17)}</span>
          <div style="min-width:0">
            <div class="agent-name">${esc(u.name)}</div>
            <div class="agent-sub">${esc(STATUS[status].label)} · ${esc(u.area)}</div>
          </div>
          <div class="agent-mw">${fmt(served)}<small>of ${fmt(full)} MW</small></div>
        </div>
        <div class="capsule" title="Critical, essential and deferrable load; dark fill = grid power, striped = backup">
          <span class="c-crit" style="width:${pct(crit)}"></span>
          <span class="c-ess" style="width:${pct(ess)}"></span>
          <span class="c-def" style="width:${pct(def)}"></span>
          <i style="width:${pct(grid)}"></i>
          ${backup > 0.01 ? `<i class="backup" style="left:${pct(grid)};width:${pct(backup)}"></i>` : ""}
        </div>
        ${open ? `
        <dl class="agent-detail">
          <div><dt>Backup</dt><dd>${u.buffer_capacity > 0 ? `${Math.round((s ? s.buffer_pct : 1) * 100)}%` : "none"}</dd></div>
          <div><dt>Last bid</dt><dd>${s && s.action !== null && s.action !== undefined ? ACTIONS[s.action] : "—"}</dd></div>
          <div><dt>Credit</dt><dd>${s ? s.credit : 0}</dd></div>
          <div><dt>Harm</dt><dd>${s ? fmt(s.damage) : "0.0"}</dd></div>
        </dl>
        <div class="agent-foot">Priority ${fmt(u.base_priority)}${u.life_critical ? " · life-critical" : ""} · depends on ${esc(deps)}${s && s.effectiveness < 1 ? ` · <b>effectiveness ${Math.round(s.effectiveness * 100)}%</b>` : ""}</div>` : ""}
      </div>`;
  }).join("");
}

/** Outcome table for the compare view, with the best value in each row highlighted. */
export function renderMetrics(el, data, policies) {
  const rows = [
    ["Total damage", (s) => s.total_damage, (v) => Math.round(v).toLocaleString(), "min"],
    ["Cascade events", (s) => s.cascade_events, (v) => v, "min"],
    ["Critical hours lost", (s) => s.critical_hours_lost, (v) => fmt(v), "min"],
    ["Longest outage", (s) => s.max_starvation_ticks / 4, (v) => `${fmt(v)} h`, "min"],
    ["Avg fairness (Jain)", (s) => s.avg_fairness, (v) => fmt(v, 3), "max"],
    ["Capacity violations", (s) => s.capacity_violations, (v) => v, "none"],
  ];
  el.innerHTML = `
    <table class="metrics">
      <thead><tr><th></th>${policies.map((p) => `<th><span class="pol"><i style="background:${POLICY_COLORS[p.id]};${p.id === "harness_rl" ? "box-shadow:0 0 0 1.5px #0E0F0C" : ""}"></i>${POLICY_SHORT[p.id]}</span></th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map(([label, get, show, mode]) => {
          const vals = policies.map((p) => get(data.results[p.id].summary));
          const best = mode === "min" ? Math.min(...vals) : mode === "max" ? Math.max(...vals) : null;
          return `<tr><td>${label}</td>${vals.map((v) => `<td class="${best !== null && v === best ? "best" : ""}"><span>${show(v)}</span></td>`).join("")}</tr>`;
        }).join("")}
      </tbody>
    </table>`;
}
