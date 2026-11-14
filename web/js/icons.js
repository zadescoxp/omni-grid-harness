// Logo and line icons (24px grid, stroke = currentColor), replacing emoji in the UI.

const P = {
  hospital: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/>',
  water: '<path d="M12 3.5c3.2 4 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.8-6.6 6-10.6Z"/><path d="M9.2 14.5a2.9 2.9 0 0 0 2.8 2.6"/>',
  emergency: '<path d="M6.5 17v-4.5a5.5 5.5 0 0 1 11 0V17"/><path d="M4.5 17h15v3h-15z"/><path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
  telecom: '<path d="M12 10.5v10M8.5 20.5h7"/><circle cx="12" cy="8.5" r="2"/><path d="M7.8 4.8a6 6 0 0 0 0 7.4M16.2 4.8a6 6 0 0 1 0 7.4M5 2.8a9.5 9.5 0 0 0 0 11.4M19 2.8a9.5 9.5 0 0 1 0 11.4"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z"/>',
  play: '<path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5.5h3v13H8zM13 5.5h3v13h-3z" fill="currentColor" stroke="none"/>',
  orbit: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  tag: '<path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5-8.5-8.5Z"/><circle cx="8" cy="8" r="1.2"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  arrow: '<path d="M7 17 17 7M9 7h8v8"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2M12 17.2v.1"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M21.5 10.5v3M6 10.5v3M9.5 10.5v3"/>',
  fuel: '<path d="M4.5 20.5v-15a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20.5h13M4.5 10h10"/><path d="M14.5 8.5h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  rise: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  scale: '<path d="M12 3.5v17M7 20.5h10M4.5 7h15"/><path d="m4.5 7-2.5 6a2.8 2.8 0 0 0 5 0L4.5 7ZM19.5 7 17 13a2.8 2.8 0 0 0 5 0l-2.5-6Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  minus: '<path d="M5 12h14"/>',
  wave: '<path d="M2.5 12h4l2.5-6 4 12 3-9 1.5 3h4"/>',
  sparkle: '<path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8L12 3.5Z"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
};

export function icon(name, size = 18, extra = "") {
  const body = P[name] || P.info;
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const KIND_ICON = { hospital: "hospital", water: "water", emergency: "emergency", telecom: "telecom" };

export const LOG_ICON = {
  event: "bolt", negotiation: "scale", agreement: "check", fallback: "scale", safety: "shield",
  alert: "alert", recovery: "check", cascade: "link", info: "info", refuel: "fuel", backup: "battery",
  aging: "rise",
};

/**
 * Omni Grid Harness mark: a ring (the city grid) harnessing three nodes to a central hub.
 * Lime on near-black, matching the product palette.
 */
export function logo(size = 34) {
  const nodes = [-90, 30, 150].map((deg) => {
    const r = (deg * Math.PI) / 180;
    return [16 + 9 * Math.cos(r), 16 + 9 * Math.sin(r)];
  });
  const spokes = nodes.map(([x, y]) => `<path d="M16 16L${x.toFixed(2)} ${y.toFixed(2)}"/>`).join("");
  const dots = nodes.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.3" fill="#0E0F0C" stroke="#C8F031" stroke-width="1.6"/>`).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-label="Omni Grid Harness" role="img">
    <rect width="32" height="32" rx="10" fill="#0E0F0C"/>
    <circle cx="16" cy="16" r="9" fill="none" stroke="#C8F031" stroke-width="2.2" stroke-dasharray="15.85 3" transform="rotate(159.55 16 16)"/>
    <g stroke="#C8F031" stroke-width="1.6" stroke-linecap="round">${spokes}</g>
    ${dots}
    <circle cx="16" cy="16" r="3.1" fill="#C8F031"/>
  </svg>`;
}
