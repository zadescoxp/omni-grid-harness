// Omni Grid Harness dashboard: wires the API, the 3D map, playback and the side panels together.
import { api } from "./api.js";
import { drawLearning, drawTimeline } from "./charts.js";
import { CityMap, STATUS } from "./map.js";
import { renderAgents, renderCompare, renderLog } from "./panels.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  meta: null,
  scenario: "monsoon_flood",
  policy: "gridpact_rl",
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
};

const BASE_TICK_MS = 650;

function scenarioMeta(id = state.scenario) {
  return state.meta.scenarios.find((s) => s.id === id);
}

function banner(text, kind = "info") {
  const el = $("#banner");
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `banner ${kind}`;
  el.textContent = text;
}

// ---------------------------------------------------------------- controls
function buildControls() {
  $("#scenario-list").innerHTML = state.meta.scenarios.map((s) => `
    <button type="button" class="chip" data-scenario="${s.id}">${s.name}</button>`).join("");
  $("#policy-list").innerHTML = state.meta.policies.map((p) => `
    <label class="policy" data-policy="${p.id}">
      <input type="radio" name="policy" value="${p.id}">
      <span class="policy-swatch p-${p.id}"></span>
      <span class="policy-name">${p.name}</span>
    </label>`).join("");
  $("#legend").innerHTML = Object.values(STATUS).map((s) =>
    `<span><i style="background:${s.color}"></i>${s.label}</span>`).join("");

  $("#scenario-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-scenario]");
    if (!b || state.loading) return;
    state.scenario = b.dataset.scenario;
    syncControls();
    loadCompare();
    run();
  });
  $("#policy-list").addEventListener("change", (e) => {
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
  $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  $("#pane-agents").addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (card) select(card.dataset.id, false);
  });

  const canvas = $("#timeline");
  let dragging = false;
  const scrub = (ev) => {
    if (!state.episode || !state.timelineGeom) return;
    const rect = canvas.getBoundingClientRect();
    const { x0, width, n } = state.timelineGeom;
    const t = Math.round(((ev.clientX - rect.left - x0) / width) * (n - 1));
    setIndex(Math.max(0, Math.min(state.episode.ticks.length - 1, t)));
  };
  canvas.addEventListener("pointerdown", (ev) => { dragging = true; pause(); canvas.setPointerCapture(ev.pointerId); scrub(ev); });
  canvas.addEventListener("pointermove", (ev) => dragging && scrub(ev));
  canvas.addEventListener("pointerup", () => (dragging = false));
  window.addEventListener("resize", () => { drawTimelineNow(); drawLearning($("#learning-canvas"), state.curve); });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.code === "ArrowRight" && state.episode) { pause(); setIndex(Math.min(state.index + 1, state.episode.ticks.length - 1)); }
    if (e.code === "ArrowLeft" && state.episode) { pause(); setIndex(Math.max(state.index - 1, 0)); }
  });
  syncControls();
}

function syncControls() {
  $$("[data-scenario]").forEach((b) => b.classList.toggle("active", b.dataset.scenario === state.scenario));
  $$(".policy").forEach((l) => {
    const on = l.dataset.policy === state.policy;
    l.classList.toggle("active", on);
    l.querySelector("input").checked = on;
  });
  $("#scenario-desc").textContent = scenarioMeta().description;
  $("#learn-row").hidden = state.policy !== "gridpact_rl";
  const m = state.meta.model;
  $("#model-info").textContent = m.trained
    ? `RL agents trained on ${m.episodes.toLocaleString()} episodes · ${m.states.toLocaleString()} learned states`
    : "RL agents untrained: run python -m omnigrid.train";
}

function setTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $$(".pane").forEach((p) => (p.hidden = p.id !== `pane-${tab}`));
  renderPanels();
  if (tab === "compare") requestAnimationFrame(() => drawLearning($("#learning-canvas"), state.curve));
}

function select(id, fly = true) {
  state.selected = id;
  state.map.setSelected(id);
  if (state.tab !== "agents") setTab("agents");
  else renderPanels();
  const card = $(`#pane-agents [data-id="${id}"]`);
  if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (fly) state.map.flyTo(id);
}

// ---------------------------------------------------------------- playback
function currentTick() {
  return state.episode ? state.episode.ticks[state.index] : null;
}

function setIndex(i) {
  state.index = i;
  const tick = currentTick();
  if (tick) state.map.update(tick);
  renderKpis();
  renderPanels();
  drawTimelineNow();
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
  if (state.index >= state.episode.ticks.length - 1) setIndex(0), state.map.reset();
  state.playing = true;
  $("#play-btn").classList.add("playing");
  $("#play-btn").setAttribute("aria-label", "Pause");
  schedule();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timer);
  $("#play-btn").classList.remove("playing");
  $("#play-btn").setAttribute("aria-label", "Play");
}

function togglePlay() {
  state.playing ? pause() : play();
}

// ---------------------------------------------------------------- rendering
function drawTimelineNow() {
  const sc = scenarioMeta();
  state.timelineGeom = drawTimeline($("#timeline"), {
    ticks: state.episode ? state.episode.ticks : null,
    supply: state.episode ? state.episode.ticks.map((t) => t.supply) : sc.supply,
    events: sc.events,
    index: state.index,
  });
}

function renderKpis() {
  const t = currentTick();
  const s = state.episode ? state.episode.summary : null;
  $("#clock").textContent = t ? t.time : "00:00";
  $("#kpi-supply").textContent = t ? `${t.supply.toFixed(1)}` : "—";
  $("#kpi-demand").textContent = t ? `crit ${t.demand.critical.toFixed(0)} · full ${t.demand.full.toFixed(0)} MW` : "";
  $("#kpi-damage").textContent = t ? Math.round(t.damage_total).toLocaleString() : "—";
  $("#kpi-damage-sub").textContent = t ? `+${t.damage_tick.toFixed(1)} this tick` : "";
  $("#kpi-fair").textContent = t ? t.fairness.toFixed(3) : "—";
  $("#kpi-cascades").textContent = t ? String(t.cascade_events) : "—";
  $("#kpi-cascades-sub").textContent = t && t.cascades.length ? `${t.cascades.length} active now` : "none active";
  $("#kpi-viol").textContent = t ? String(t.violations) : "—";
  const nego = t && t.rounds.length
    ? (t.safety_intervened ? "safety layer intervened" : t.fallback ? `fallback after ${t.rounds.length} rounds` : `agreed in ${t.rounds.length} round${t.rounds.length > 1 ? "s" : ""}`)
    : (state.policy.startsWith("gridpact") ? "—" : "no negotiation");
  $("#kpi-viol-sub").textContent = t ? `safe state ${t.safe_state ? "✓" : "✗"} · ${nego}` : "";
  const dark = t ? Object.values(t.utilities).filter((u) => u.status === "dark").length : 0;
  $("#hud-dark").textContent = t ? (dark ? `${dark} below critical` : "all critical loads met") : "";
  $("#hud-dark").classList.toggle("bad", dark > 0);
  if (s) $("#episode-tag").textContent = `${state.meta.policies.find((p) => p.id === s.policy).name}`;
}

function renderPanels() {
  const t = currentTick();
  if (state.tab === "log") renderLog($("#pane-log"), state.episode && state.episode.ticks, state.index);
  if (state.tab === "agents") renderAgents($("#pane-agents"), state.meta, t, state.selected);
  if (state.tab === "compare") renderCompare($("#compare-body"), state.compare, state.meta.policies, state.policy);
}

// ---------------------------------------------------------------- data
async function run() {
  if (state.loading) return;
  state.loading = true;
  pause();
  $("#run-btn").disabled = true;
  $("#run-btn").textContent = "Negotiating…";
  banner(`Running 24h “${scenarioMeta().name}” with ${state.meta.policies.find((p) => p.id === state.policy).name}…`);
  try {
    const data = await api.run(state.scenario, state.policy, state.learn && state.policy === "gridpact_rl");
    state.episode = data;
    state.map.reset();
    state.meta.model = data.model;
    syncControls();
    setIndex(0);
    banner(data.learned ? `Agents learned from this run: now ${data.model.episodes.toLocaleString()} episodes of experience.` : "");
    if (data.learned) { loadLearning(); loadCompare(); }
    if (data.learned) setTimeout(() => banner(""), 4000);
    play();
  } catch (err) {
    banner(`Simulation failed: ${err.message}`, "error");
  } finally {
    state.loading = false;
    $("#run-btn").disabled = false;
    $("#run-btn").textContent = "Run simulation";
  }
}

async function loadCompare() {
  const scenario = state.scenario;
  state.compare = null;
  renderPanels();
  try {
    const data = await api.compare(scenario);
    if (scenario === state.scenario) state.compare = data;
  } catch (err) {
    $("#compare-body").innerHTML = `<div class="empty">Comparison failed: ${err.message}</div>`;
    return;
  }
  renderPanels();
}

async function loadLearning() {
  try {
    const data = await api.learning();
    state.curve = data.curve || [];
    const evals = state.curve.filter((p) => p.kind === "eval");
    if (evals.length >= 2) {
      const best = Math.min(...evals.map((p) => p.total));
      const base = evals[0].heuristic_total;
      $("#learning-note").innerHTML =
        `Best greedy policy: <b>${Math.round(best).toLocaleString()}</b> harm across the 3 scenarios vs ` +
        `<b>${Math.round(base).toLocaleString()}</b> for the rule-based agents (${Math.round((1 - best / base) * 100)}% better).`;
    }
    if (state.tab === "compare") drawLearning($("#learning-canvas"), state.curve);
  } catch (err) {
    $("#learning-note").textContent = `Learning curve unavailable: ${err.message}`;
  }
}

async function init() {
  try {
    state.meta = await api.meta();
  } catch (err) {
    banner(`Cannot reach the Omni Grid Harness server: ${err.message}`, "error");
    return;
  }
  state.map = new CityMap($("#map"), state.meta, { onSelect: (id) => select(id) });
  window.omni = state;   // handy for poking at the live state from the browser console
  buildControls();
  renderKpis();
  renderPanels();
  drawTimelineNow();
  loadCompare();
  loadLearning();
  // Run even if the basemap tiles are unreachable (offline demo): the simulation does not need them.
  await Promise.race([state.map.ready, new Promise((r) => setTimeout(r, 8000))]);
  run();
}

init();
