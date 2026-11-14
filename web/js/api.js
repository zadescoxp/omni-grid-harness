// Thin wrapper around the Omni Grid Harness HTTP API.

async function get(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  meta: () => get("/api/meta"),
  run: (scenario, policy, learn) =>
    get(`/api/run?scenario=${encodeURIComponent(scenario)}&policy=${encodeURIComponent(policy)}&learn=${learn ? 1 : 0}`),
  compare: (scenario) => get(`/api/compare?scenario=${encodeURIComponent(scenario)}`),
  learning: () => get("/api/learning"),
};
