// Omni Grid Harness dashboard: wires the API, the 3D map, playback, infographics and panels together.
import { api } from "./api.js";
import { drawCumulative, drawDamageBars, drawDotTimeline, drawLearning, drawPolicyBars, POLICY_COLORS } from "./charts.js";
import { icon, logo } from "./icons.js";
import { CityMap, STATUS } from "./map.js";
import { POLICY_SHORT, renderAgents, renderFeed, renderMetrics } from "./panels.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  meta: null,
  view: "live",
  scenario: "monsoon_flood",
  policy: "harness_rl",
  learn: false,
  episode: null,
  index: 0,
  playing: false,
  speed: 1,
  timer: null,
  tab: "log",
  selected: null,
  compare: null,
  curve: [],
  map: null,
  loading: false,
  runQueued: false,
};

const BASE_TICK_MS = 650;

const scenarioMeta = (id = state.scenario) => state.meta.scenarios.find((s) => s.id === id);
const policyName = (id) => state.meta.policies.find((p) => p.id === id).name;

function banner(text, kind = "info") {
  const el = $("#banner");
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `banner ${kind}`;
  el.textContent = text;
}

// ---------------------------------------------------------------- controls
function buildControls() {
  $("#logo").innerHTML = logo(36);
  $("#orbit-btn").innerHTML = icon("orbit", 18);
  $("#labels-btn").innerHTML = icon("tag", 18);
  $("#home-btn").innerHTML = icon("target", 18);
  setPlayIcon();

  $("#scenario-select").innerHTML = state.meta.scenarios.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  $("#policy-select").innerHTML = state.meta.policies.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  $("#legend").innerHTML = Object.values(STATUS).map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join("");

  $("#scenario-select").addEventListener("change", (e) => {
    state.scenario = e.target.value;
    syncControls();
    loadCompare();
    run();
  });
  $("#policy-select").addEventListener("change", (e) => {
    state.policy = e.target.value;
    syncControls();
    run();
  });
  $("#learn-toggle").addEventListener("change", (e) => (state.learn = e.target.checked));
  $("#run-btn").addEventListener("click", () => run());
  $("#play-btn").addEventListener("click", () => togglePlay());
  $$(".speed").forEach((b) => b.addEventListener("click", () => {
    state.speed = Number(b.dataset.speed);
    $$(".speed").forEach((x) => x.classList.toggle("active", x === b));
    if (state.playing) schedule();
  }));
  $("#orbit-btn").addEventListener("click", (e) => {
    const on = !e.currentTarget.classList.contains("active");
    e.currentTarget.classList.toggle("active", on);
    state.map.setOrbit(on);
  });
  $("#labels-btn").addEventListener("click", (e) => {
    const on = !e.currentTarget.classList.contains("active");
    e.currentTarget.classList.toggle("active", on);
    state.map.setLabels(on);
  });
  $("#home-btn").addEventListener("click", () => state.map.home());
  $$(".view-tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $$(".seg-btn").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  $("#pane-agents").addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (row) select(row.dataset.id, state.selected !== row.dataset.id);
  });

  const canvas = $("#timeline");
  let dragging = false;
  const scrub = (ev) => {
    if (!state.episode || !state.timelineGeom) return;
    const rect = canvas.getBoundingClientRect();
    const { x0, width, n } = state.timelineGeom;
    const t = Math.floor(((ev.clientX - rect.left - x0) / width) * n);
    setIndex(Math.max(0, Math.min(state.episode.ticks.length - 1, t)));
  };
  canvas.addEventListener("pointerdown", (ev) => { dragging = true; pause(); canvas.setPointerCapture(ev.pointerId); scrub(ev); });
  canvas.addEventListener("pointermove", (ev) => dragging && scrub(ev));
  canvas.addEventListener("pointerup", () => (dragging = false));

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { drawLive(); drawCompare(); }, 80);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof Element && e.target.matches("input, select, textarea")) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.code === "ArrowRight" && state.episode) { pause(); setIndex(Math.min(state.index + 1, state.episode.ticks.length - 1)); }
    if (e.code === "ArrowLeft" && state.episode) { pause(); setIndex(Math.max(state.index - 1, 0)); }
  });
  syncControls();
}

function syncControls() {
  $("#scenario-select").value = state.scenario;
  $("#policy-select").value = state.policy;
  $("#learn-row").hidden = state.policy !== "harness_rl";
  $("#hud-scenario").textContent = `${scenarioMeta().name} · ${POLICY_SHORT[state.policy]}`;
}

function setView(view) {
  state.view = view;
  $("#app").dataset.view = view;
  $$(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "live") {
    requestAnimationFrame(() => { state.map.map.resize(); drawLive(); });
  } else {
    if (!state.compare) loadCompare();
    requestAnimationFrame(drawCompare);
  }
}

function setTab(tab) {
  state.tab = tab;
  $$(".seg-btn").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("#pane-log").hidden = tab !== "log";
  $("#pane-agents").hidden = tab !== "agents";
  renderPanels();
}

function select(id, fly = true) {
  state.selected = state.selected === id && !fly ? null : id;
  state.map.setSelected(state.selected);
  if (state.tab !== "agents") setTab("agents");
  else renderPanels();
  const row = $(`#pane-agents [data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (fly && state.selected) state.map.flyTo(id);
}

// ---------------------------------------------------------------- playback
const currentTick = () => (state.episode ? state.episode.ticks[state.index] : null);

function setPlayIcon() {
  $("#play-btn").innerHTML = icon(state.playing ? "pause" : "play", 18);
  $("#play-btn").setAttribute("aria-label", state.playing ? "Pause" : "Play");
}

function setIndex(i) {
  state.index = i;
  const tick = currentTick();
  if (tick) state.map.update(tick);
  renderKpis();
  renderPanels();
  drawLive();
  if (state.episode && i >= state.episode.ticks.length - 1) pause();
}

function schedule() {
  clearTimeout(state.timer);
  state.timer = setTimeout(stepPlay, BASE_TICK_MS / state.speed);
}

function stepPlay() {
  if (!state.playing || !state.episode) return;
  if (state.index < state.episode.ticks.length - 1) {
    setIndex(state.index + 1);
    if (state.playing) schedule();
  } else pause();
}

function play() {
  if (!state.episode) return;
  if (state.index >= state.episode.ticks.length - 1) { state.map.reset(); setIndex(0); }
  state.playing = true;
  setPlayIcon();
  schedule();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timer);
  setPlayIcon();
}

const togglePlay = () => (state.playing ? pause() : play());

// ---------------------------------------------------------------- live rendering
function drawLive() {
  if (state.view !== "live") return;
  const sc = scenarioMeta();
  const ticks = state.episode ? state.episode.ticks : null;
  state.timelineGeom = drawDotTimeline($("#timeline"), {
    ticks,
    supply: ticks ? ticks.map((t) => t.supply) : sc.supply,
    index: state.index,
  });
  drawDamageBars($("#damage-bars"), ticks, state.index);
}

function renderKpis() {
  const t = currentTick();
  $("#clock").textContent = t ? t.time : "00:00";
  if (!t) return;

  const full = t.demand.full;
  const gap = t.supply - t.demand.critical;
  $("#kpi-supply").textContent = t.supply.toFixed(1);
  const pill = $("#kpi-supply-pill");
  if (t.supply >= full - 0.5) { pill.className = "pill"; pill.textContent = "covered"; }
  else if (gap >= 0) { pill.className = "pill dark"; pill.textContent = `−${(full - t.supply).toFixed(0)} MW`; }
  else { pill.className = "pill bad"; pill.textContent = `${gap.toFixed(0)} MW crit`; }
  $("#meter-supply").style.width = `${Math.min(100, (t.supply / full) * 100)}%`;
  $("#meter-crit").style.left = `${Math.min(99.5, (t.demand.critical / full) * 100)}%`;
  $("#kpi-supply-sub").textContent = `Critical ${t.demand.critical.toFixed(0)} · full demand ${full.toFixed(0)} MW`;

  $("#kpi-damage").textContent = Math.round(t.damage_total).toLocaleString();
  const dp = $("#kpi-damage-pill");
  dp.className = t.damage_tick > 25 ? "pill bad" : "pill dark";
  dp.textContent = `+${t.damage_tick.toFixed(1)}`;

  $("#fair-ring").style.setProperty("--v", String(t.fairness));
  $("#kpi-fair").textContent = t.fairness.toFixed(2);

  $("#kpi-cascades").textContent = String(t.cascade_events);
  $("#kpi-viol").textContent = String(t.violations);
  const safe = $("#kpi-safe");
  safe.className = t.safe_state ? "pill" : "pill bad";
  safe.textContent = t.safe_state ? "safe state" : "unsafe";
  $("#kpi-nego").textContent = t.rounds.length
    ? (t.safety_intervened ? "Safety layer re-allocated this tick"
      : t.fallback ? `Priority fallback after ${t.rounds.length} rounds`
        : `Agreed in ${t.rounds.length} round${t.rounds.length > 1 ? "s" : ""}`)
    : "No negotiation under this policy";

  const dark = Object.values(t.utilities).filter((u) => u.status === "dark").length;
  const chip = $("#hud-state");
  chip.className = dark ? "chip bad" : "chip ok";
  chip.textContent = dark ? `${dark} below critical` : "All critical loads met";
}

function renderPanels() {
  const t = currentTick();
  if (state.tab === "log") renderFeed($("#pane-log"), state.episode && state.episode.ticks, state.index);
  else renderAgents($("#pane-agents"), state.meta, t, state.selected);
}

// ---------------------------------------------------------------- compare rendering
function drawCompare() {
  if (state.view !== "compare") return;
  drawLearning($("#learning"), state.curve);
  const data = state.compare;
  if (!data) return;
  const policies = state.meta.policies;
  const S = (id) => data.results[id].summary;

  const bestBase = Math.min(S("static_priority").total_damage, S("uncoordinated").total_damage);
  $("#cmp-cut").textContent = Math.round((1 - S("harness_rl").total_damage / bestBase) * 100);
  $("#cmp-scenario").textContent = scenarioMeta(data.scenario).name;
  const rlVsRules = (1 - S("harness_rl").total_damage / S("harness_rules").total_damage) * 100;
  $("#cmp-rl").textContent = Math.round(rlVsRules);
  $("#cmp-rl-note").textContent =
    `less damage than the hand-written rule-based agents on this scenario, after ${data.model.episodes.toLocaleString()} training episodes.`;
  $("#cmp-viol").textContent = String(policies.reduce((a, p) => a + S(p.id).capacity_violations, 0));

  drawPolicyBars($("#policy-bars"), policies.map((p) => ({
    label: POLICY_SHORT[p.id],
    sub: p.id.startsWith("harness") ? "negotiating" : "baseline",
    value: S(p.id).total_damage,
    color: POLICY_COLORS[p.id],
    solid: p.id.startsWith("harness"),
  })));
  const series = {};
  for (const p of policies) series[p.id] = data.results[p.id].cumulative_damage;
  drawCumulative($("#cumulative"), series);
  $("#cumulative-key").innerHTML = policies.map((p) =>
    `<span><i class="k" style="background:${POLICY_COLORS[p.id]};${p.id === "harness_rl" ? "box-shadow:0 0 0 1.5px #0E0F0C" : ""}"></i>${POLICY_SHORT[p.id]}</span>`).join("");
  renderMetrics($("#metrics"), data, policies);
}

// ---------------------------------------------------------------- data
async function run() {
  if (state.loading) {
    state.runQueued = true;
    return;
  }
  state.loading = true;
  pause();
  $("#run-btn").disabled = true;
  $("#run-btn").textContent = "Negotiating…";
  try {
    const data = await api.run(state.scenario, state.policy, state.learn && state.policy === "harness_rl");
    if (state.runQueued) return;
    state.episode = data;
    state.meta.model = data.model;
    state.map.reset();
    syncControls();
    setIndex(0);
    if (data.learned) {
      banner(`Agents learned from this run: ${data.model.episodes.toLocaleString()} episodes of experience.`);
      setTimeout(() => banner(""), 4000);
      loadLearning();
      loadCompare();
    } else banner("");
    play();
  } catch (err) {
    if (!state.runQueued) banner(`Simulation failed: ${err.message}`, "error");
  } finally {
    state.loading = false;
    $("#run-btn").disabled = false;
    $("#run-btn").textContent = "Run simulation";
    if (state.runQueued) {
      state.runQueued = false;
      run();
    }
  }
}

async function loadCompare() {
  const scenario = state.scenario;
  try {
    const data = await api.compare(scenario);
    if (scenario === state.scenario) { state.compare = data; drawCompare(); }
  } catch (err) {
    $("#metrics").innerHTML = `<div class="empty">Comparison failed: ${err.message}</div>`;
  }
}

async function loadLearning() {
  try {
    const data = await api.learning();
    state.curve = data.curve || [];
    const evals = state.curve.filter((p) => p.kind === "eval");
    if (evals.length >= 2) {
      const best = Math.min(...evals.map((p) => p.total));
      const base = evals[0].heuristic_total;
      $("#learning-note").textContent =
        `Damage across all 3 scenarios: best ${Math.round(best).toLocaleString()} vs ${Math.round(base).toLocaleString()} for rule-based agents (${Math.round((1 - best / base) * 100)}% better).`;
    }
    drawCompare();
  } catch (err) {
    $("#learning-note").textContent = `Learning curve unavailable: ${err.message}`;
  }
}

async function init() {
  try {
    state.meta = await api.meta();
  } catch (err) {
    document.body.insertAdjacentHTML("beforeend", `<div class="banner error" style="position:fixed;top:84px;left:16px">Cannot reach the Omni Grid Harness server: ${err.message}</div>`);
    return;
  }
  state.map = new CityMap($("#map"), state.meta, { onSelect: (id) => select(id) });
  window.omni = state;   // handy for poking at the live state from the browser console
  buildControls();
  renderPanels();
  drawLive();
  loadCompare();
  loadLearning();
  // Run even if the basemap tiles are unreachable (offline demo): the simulation does not need them.
  await Promise.race([state.map.ready, new Promise((r) => setTimeout(r, 8000))]);
  run();
}

init();
