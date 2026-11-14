// 3D Bengaluru map: OpenFreeMap vector tiles, extruded city blocks, and live utility facilities.
/* global maplibregl */

export const STATUS = {
  full: { color: "#F5C342", label: "Fully powered" },
  essential: { color: "#F59E42", label: "Essential only" },
  critical: { color: "#EF6C35", label: "Critical only" },
  buffer: { color: "#8B5CF6", label: "On backup power" },
  dark: { color: "#D93A3F", label: "Below critical" },
};

const FACILITY_SIZE = { hospital: 140, water: 120, emergency: 100, telecom: 75 };
const FACILITY_HEIGHT = { hospital: 95, water: 60, emergency: 70, telecom: 150 };
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

function square(lng, lat, halfMeters) {
  const dLat = halfMeters / 111320;
  const dLng = halfMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[
    [lng - dLng, lat - dLat], [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat],
  ]];
}

// Slight arc so power lines read as overhead feeders rather than straight road-like strokes.
function arc(from, to, steps = 24) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -(y2 - y1) * 0.12;
  const ny = (x2 - x1) * 0.12;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = mx + nx;
    const cy = my + ny;
    pts.push([
      (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2,
      (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2,
    ]);
  }
  return pts;
}

export class CityMap {
  constructor(container, meta, { onSelect } = {}) {
    this.meta = meta;
    this.onSelect = onSelect;
    this.markers = new Map();
    this.labelsVisible = true;
    this.orbiting = false;
    this.dashStep = 0;
    this.ready = new Promise((resolve) => (this._resolveReady = resolve));
    this.failed = false;

    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [77.598, 12.976],
      zoom: 13.4,
      pitch: 58,
      bearing: -72,
      maxPitch: 75,
      antialias: true,
      attributionControl: { compact: true },
    });
    this.container = container;
    this.loadedOnce = false;
    this.map.on("load", () => this._setup());
    // If the basemap cannot load (offline venue Wi-Fi), swap to a blank style so the
    // facilities, feeders and labels still render on their own.
    this._fallbackTimer = setTimeout(() => this._useBlankStyle(), 20000);
  }

  _useBlankStyle() {
    if (this.loadedOnce) return;
    console.warn("Basemap did not load in time; continuing on a blank style");
    this.failed = true;
    this.container.classList.add("map-offline");
    this.map.setStyle({
      version: 8,
      sources: {},
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#E9ECF5" } }],
    });
    this.map.once("styledata", () => this._setup());
  }

  _setup() {
    if (this.loadedOnce) return;
    this.loadedOnce = true;
    clearTimeout(this._fallbackTimer);
    const map = this.map;
    if (map.getLayer("building")) map.setLayoutProperty("building", "visibility", "none");

    // Pale extruded city blocks, in the spirit of an isometric city model.
    if (map.getSource("openmaptiles")) map.addLayer({
      id: "omni-buildings",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 6],
          0, "#dde2f0", 15, "#c7d0e8", 45, "#aebbdf", 100, "#93a5d4",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.88,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    const sub = this.meta.substation;
    map.addSource("feeders", { type: "geojson", data: this._feeders({}) });
    map.addLayer({
      id: "feeders-glow", type: "line", source: "feeders",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["*", ["get", "width"], 2.2],
               "line-opacity": 0.14, "line-blur": 2 },
    });
    map.addLayer({
      id: "feeders-dash", type: "line", source: "feeders",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"],
               "line-opacity": ["get", "opacity"], "line-dasharray": [0, 4, 3] },
    });

    map.addSource("facilities", { type: "geojson", data: this._facilities({}) });
    map.addLayer({
      id: "facility-plinth", type: "fill-extrusion", source: "facilities",
      paint: { "fill-extrusion-color": "#3b3551", "fill-extrusion-height": 3,
               "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.9 },
    });
    map.addLayer({
      id: "facilities-3d", type: "fill-extrusion", source: "facilities",
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 3,
        "fill-extrusion-opacity": 0.97,
        "fill-extrusion-vertical-gradient": true,
      },
    });
    map.on("click", "facilities-3d", (e) => {
      const id = e.features && e.features[0] && e.features[0].properties.id;
      if (id && id !== "substation" && this.onSelect) this.onSelect(id);
    });
    map.on("mouseenter", "facilities-3d", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "facilities-3d", () => (map.getCanvas().style.cursor = ""));

    this._makeMarker({ id: "substation", name: sub.name, short: "Substation", icon: "⚡", lng: sub.lng, lat: sub.lat }, true);
    for (const u of this.meta.utilities) this._makeMarker(u, false);

    this._animate();
    this.home(0);
    this._resolveReady();
  }

  /** Camera that fits every facility (and its label) between the side panels and the dock. */
  _homeCamera() {
    const pts = this.meta.utilities.map((u) => [u.lng, u.lat]).concat([[this.meta.substation.lng, this.meta.substation.lat]]);
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
    const css = getComputedStyle(document.documentElement);
    const left = parseFloat(css.getPropertyValue("--left-w")) || 330;
    const right = parseFloat(css.getPropertyValue("--right-w")) || 370;
    const wide = window.innerWidth > 960;
    // Horizontal padding leaves room for the half-width of a facility label.
    const padding = wide
      ? { top: 110, bottom: 190, left: left + 140, right: right + 140 }
      : { top: 60, bottom: 40, left: 90, right: 90 };
    const bearing = -72;   // rotates the network's long axis away from the screen's width
    const cam = this.map.cameraForBounds(bounds, { padding, bearing })
      || { center: [77.598, 12.976], zoom: 13.4 };
    // Stay at z13+ so the vector tiles include buildings.
    return { center: cam.center, zoom: Math.max(13.05, Math.min(cam.zoom, 15)), pitch: 58, bearing };
  }

  _facilities(utilities) {
    const features = this.meta.utilities.map((u) => {
      const s = utilities[u.id];
      const status = s ? s.status : "full";
      return {
        type: "Feature",
        properties: { id: u.id, color: STATUS[status].color, height: FACILITY_HEIGHT[u.kind] },
        geometry: { type: "Polygon", coordinates: square(u.lng, u.lat, FACILITY_SIZE[u.kind]) },
      };
    });
    const sub = this.meta.substation;
    features.push({
      type: "Feature",
      properties: { id: "substation", color: "#5B4FD6", height: 45 },
      geometry: { type: "Polygon", coordinates: square(sub.lng, sub.lat, 150) },
    });
    return { type: "FeatureCollection", features };
  }

  _feeders(utilities) {
    const sub = this.meta.substation;
    return {
      type: "FeatureCollection",
      features: this.meta.utilities.map((u) => {
        const s = utilities[u.id];
        const alloc = s ? s.alloc : u.full;
        const status = s ? s.status : "full";
        return {
          type: "Feature",
          properties: {
            id: u.id,
            color: STATUS[status].color,
            width: 1.2 + Math.min(3.8, alloc / 5),
            opacity: alloc > 0.05 ? 0.9 : 0.12,
          },
          geometry: { type: "LineString", coordinates: arc([sub.lng, sub.lat], [u.lng, u.lat]) },
        };
      }),
    };
  }

  _makeMarker(u, isSubstation) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "map-label" + (isSubstation ? " substation" : "");
    el.innerHTML = `
      <span class="dot"></span>
      <span class="ml-icon">${u.icon}</span>
      <span class="ml-name" title="${u.name}">${u.short || u.name}</span>
      <span class="ml-mw"></span>
      <span class="ml-chip"></span>`;
    if (!isSubstation) el.addEventListener("click", (ev) => { ev.stopPropagation(); this.onSelect && this.onSelect(u.id); });
    // MapLibre positions the marker element with its own transform, so styling lives on an inner element.
    const wrap = document.createElement("div");
    wrap.className = "map-label-anchor";
    wrap.appendChild(el);
    const marker = new maplibregl.Marker({ element: wrap, anchor: "bottom", offset: [0, -6] })
      .setLngLat([u.lng, u.lat])
      .addTo(this.map);
    this.markers.set(u.id, { marker, el, lastAction: null });
  }

  update(tick) {
    if (!this.map.getSource("facilities")) return;
    this.map.getSource("facilities").setData(this._facilities(tick.utilities));
    this.map.getSource("feeders").setData(this._feeders(tick.utilities));

    const sub = this.markers.get("substation");
    if (sub) sub.el.querySelector(".ml-mw").textContent = `${tick.supply.toFixed(0)} MW`;

    for (const u of this.meta.utilities) {
      const m = this.markers.get(u.id);
      const s = tick.utilities[u.id];
      if (!m || !s) continue;
      m.el.style.setProperty("--status", STATUS[s.status].color);
      m.el.dataset.status = s.status;
      m.el.querySelector(".ml-mw").textContent = `${s.served.toFixed(1)} MW`;
      const chip = m.el.querySelector(".ml-chip");
      const action = s.action;
      if (action !== null && action !== undefined && action !== m.lastAction && action !== 0) {
        chip.textContent = ["", "−deferrable", "critical only", "on backup"][action];
        chip.classList.remove("show");
        void chip.offsetWidth;   // restart the CSS animation
        chip.classList.add("show");
      }
      m.lastAction = action;
    }
  }

  reset() {
    for (const m of this.markers.values()) {
      m.lastAction = null;
      m.el.querySelector(".ml-chip").classList.remove("show");
    }
  }

  setSelected(id) {
    for (const [uid, m] of this.markers) m.el.classList.toggle("selected", uid === id);
  }

  flyTo(id) {
    const u = this.meta.utilities.find((x) => x.id === id);
    if (!u) return;
    this.map.flyTo({ center: [u.lng, u.lat], zoom: 15.2, pitch: 62, duration: 1400, essential: true });
  }

  home(duration = 1400) {
    const cam = this._homeCamera();
    const recentre = () => {
      // With pitch and rotation the projected network is not symmetric; nudge it so the
      // outermost labels sit evenly between the two side panels.
      if (window.innerWidth <= 960) return;
      const css = getComputedStyle(document.documentElement);
      const left = (parseFloat(css.getPropertyValue("--left-w")) || 330) + 32;
      const right = window.innerWidth - (parseFloat(css.getPropertyValue("--right-w")) || 370) - 32;
      const xs = this.meta.utilities.map((u) => this.map.project([u.lng, u.lat]).x);
      const dx = (Math.min(...xs) + Math.max(...xs)) / 2 - (left + right) / 2;
      if (Math.abs(dx) > 4) this.map.panBy([dx, 0], { duration: duration ? 500 : 0 });
    };
    if (duration) {
      this.map.once("moveend", recentre);
      this.map.flyTo({ ...cam, duration });
    } else {
      this.map.jumpTo(cam);
      recentre();
    }
  }

  setLabels(visible) {
    this.labelsVisible = visible;
    for (const m of this.markers.values()) m.el.classList.toggle("hidden", !visible);
  }

  setOrbit(on) {
    this.orbiting = on;
  }

  _animate() {
    // Marching-ants feeders: cycle the dash pattern to show power flowing out of the substation.
    const seq = [
      [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
      [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
    ];
    let last = 0;
    const frame = (ts) => {
      if (ts - last > 70 && this.map.getLayer("feeders-dash")) {
        this.dashStep = (this.dashStep + 1) % seq.length;
        this.map.setPaintProperty("feeders-dash", "line-dasharray", seq[this.dashStep]);
        last = ts;
      }
      if (this.orbiting && !this.map.isMoving()) {
        this.map.setBearing((this.map.getBearing() + 0.08) % 360);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
