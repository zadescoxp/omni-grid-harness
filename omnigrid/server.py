"""HTTP server for the Omni Grid Harness dashboard. Standard library only.

    python -m omnigrid.server            # http://localhost:8000

API
  GET /api/meta                         utilities, substation, scenarios, policies, model info
  GET /api/run?scenario=&policy=&learn= full episode (96 ticks) plus summary
  GET /api/compare?scenario=            all four policies side by side
  GET /api/learning                     RL learning curve
Everything else is served from web/.
"""
from __future__ import annotations

import json
import os
import threading
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .agents import QTeam
from .config import (DEPENDENCIES, EPISODE_TICKS, KIND_ICONS, SHORT_NAMES, SUBSTATION, TICK_MINUTES,
                     UTILITIES, UTILITY_IDS)
from .scenario import SCENARIOS, get_scenario
from .simulation import POLICIES, Simulation
from .train import MODEL_PATH, load_curve, save_curve

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

_team_lock = threading.Lock()
_team = QTeam(UTILITY_IDS)
_team.load(MODEL_PATH)
_compare_cache: dict[tuple[str, int], dict] = {}


def model_info() -> dict:
    return {"episodes": _team.episodes, "states": _team.state_count(), "trained": MODEL_PATH.exists()}


def meta() -> dict:
    return {
        "name": "Omni Grid Harness",
        "city": "Bengaluru",
        "tick_minutes": TICK_MINUTES,
        "episode_ticks": EPISODE_TICKS,
        "utilities": [{**{k: getattr(u, k) for k in u.__dataclass_fields__}, "full": u.full,
                       "icon": KIND_ICONS[u.kind], "short": SHORT_NAMES[u.id], "depends_on": list(DEPENDENCIES.get(u.id, ()))}
                      for u in UTILITIES],
        "substation": SUBSTATION,
        "scenarios": [s.describe() for s in SCENARIOS.values()],
        "policies": [{"id": k, "name": v} for k, v in POLICIES.items()],
        "model": model_info(),
    }


def run_episode(scenario_id: str, policy: str, learn: bool) -> dict:
    scenario = get_scenario(scenario_id)
    if policy == "gridpact_rl":
        with _team_lock:
            if learn:
                for agent in _team.agents.values():
                    agent.epsilon = 0.0     # learn from the live run without random exploration
            sim = Simulation(scenario, policy, team=_team, learn=learn)
            ticks = sim.run()
            _team.set_learning(False)
            if learn:
                _team.save(MODEL_PATH)
                curve = load_curve()
                curve.append({"episode": _team.episodes, "kind": "live", "scenario": scenario_id,
                              "damage": round(sim.total_damage, 2)})
                save_curve(curve)
                _compare_cache.clear()
    else:
        sim = Simulation(scenario, policy)
        ticks = sim.run()
    return {"scenario": scenario_id, "policy": policy, "learned": learn and policy == "gridpact_rl",
            "summary": sim.summary().to_dict(), "ticks": ticks, "model": model_info()}


def compare(scenario_id: str) -> dict:
    key = (scenario_id, _team.episodes)
    if key in _compare_cache:
        return _compare_cache[key]
    results = {}
    for policy in POLICIES:
        if policy == "gridpact_rl":
            with _team_lock:
                sim = Simulation(get_scenario(scenario_id), policy, team=_team, narrate=False)
                ticks = sim.run()
        else:
            sim = Simulation(get_scenario(scenario_id), policy, narrate=False)
            ticks = sim.run()
        results[policy] = {"summary": sim.summary().to_dict(),
                           "cumulative_damage": [t["damage_total"] for t in ticks]}
    out = {"scenario": scenario_id, "results": results, "model": model_info()}
    _compare_cache[key] = out
    return out


class Handler(SimpleHTTPRequestHandler):
    server_version = "OmniGridHarness/1.0"

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet except for errors
        if args and isinstance(args[1], str) and args[1].startswith(("4", "5")):
            super().log_message(fmt, *args)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, payload: dict | list, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        q = {k: v[-1] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/meta":
                return self._json(meta())
            if url.path == "/api/run":
                scenario = q.get("scenario", "monsoon_flood")
                policy = q.get("policy", "gridpact_rl")
                if scenario not in SCENARIOS or policy not in POLICIES:
                    return self._json({"error": "unknown scenario or policy"}, HTTPStatus.BAD_REQUEST)
                return self._json(run_episode(scenario, policy, q.get("learn") == "1"))
            if url.path == "/api/compare":
                scenario = q.get("scenario", "monsoon_flood")
                if scenario not in SCENARIOS:
                    return self._json({"error": "unknown scenario"}, HTTPStatus.BAD_REQUEST)
                return self._json(compare(scenario))
            if url.path == "/api/learning":
                return self._json({"curve": load_curve(), "model": model_info()})
            return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except (BrokenPipeError, ConnectionResetError):
            return None
        except Exception as exc:  # report, never crash the server thread silently
            self.log_error("API error on %s: %r", url.path, exc)
            return self._json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    handler = partial(Handler, directory=str(WEB_DIR))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Omni Grid Harness running at http://localhost:{port}  "
          f"(RL model: {_team.episodes} training episodes)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
