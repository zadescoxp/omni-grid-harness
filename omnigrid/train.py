"""Train the Q-learning agents on randomised disasters and record a learning curve.

    python -m omnigrid.train --episodes 3000

Every `--eval-every` episodes the greedy policy is evaluated (no exploration, no learning)
on the three named scenarios, and the result is appended to models/learning_curve.json.
The best evaluated policy is kept, so a late unlucky update never makes the saved model worse.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import random
import shutil
import time
from pathlib import Path

from .agents import QTeam
from .config import UTILITY_IDS
from .scenario import SCENARIOS, get_scenario, random_scenario
from .simulation import Simulation

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT / "models"
DATA_DIR = Path(os.environ.get("OMNIGRID_DATA_DIR", str(DEFAULT_DATA_DIR))).expanduser()
MODEL_PATH = DATA_DIR / "qtable.json"
CURVE_PATH = DATA_DIR / "learning_curve.json"


def initialize_data_dir(data_dir: Path = DATA_DIR, source_dir: Path = DEFAULT_DATA_DIR) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    if data_dir.resolve() == source_dir.resolve():
        return
    for name in ("qtable.json", "learning_curve.json"):
        source = source_dir / name
        destination = data_dir / name
        if source.is_file() and not destination.exists():
            shutil.copy2(source, destination)


def evaluate(team: QTeam, policy: str = "harness_rl") -> dict[str, float]:
    team.set_learning(False)
    out = {}
    for sid in SCENARIOS:
        sim = Simulation(get_scenario(sid), policy, team=team, narrate=False)
        sim.run()
        out[sid] = round(sim.total_damage, 2)
    out["total"] = round(sum(out.values()), 2)
    return out


def load_curve() -> list[dict]:
    if CURVE_PATH.exists():
        return json.loads(CURVE_PATH.read_text())
    return []


def save_curve(curve: list[dict]) -> None:
    CURVE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CURVE_PATH.write_text(json.dumps(curve, indent=1))


def train(episodes: int, eval_every: int, seed: int, eps_start: float, eps_end: float,
          fresh: bool) -> None:
    initialize_data_dir()
    rng = random.Random(seed)
    team = QTeam(UTILITY_IDS, seed=seed)
    curve: list[dict] = []
    if not fresh and team.load(MODEL_PATH):
        curve = load_curve()
        print(f"resuming from {team.episodes} episodes")

    baseline = evaluate(team, "harness_rules")
    best = evaluate(team)
    best_team = copy.deepcopy(team)
    print(f"heuristic baseline: {baseline}")
    print(f"start policy:       {best}")
    if not curve:
        curve.append({"episode": team.episodes, "kind": "eval", **best, "heuristic_total": baseline["total"]})

    start = time.time()
    for ep in range(1, episodes + 1):
        frac = ep / episodes
        epsilon = eps_start + (eps_end - eps_start) * frac
        team.set_learning(True, epsilon)
        # Mix randomised disasters with the named ones so agents generalise but also see the demos.
        scenario = random_scenario(rng) if rng.random() < 0.75 else get_scenario(rng.choice(list(SCENARIOS)))
        sim = Simulation(scenario, "harness_rl", team=team, seed=rng.randint(0, 10**6),
                         learn=True, narrate=False)
        sim.run()

        if ep % eval_every == 0 or ep == episodes:
            result = evaluate(team)
            point = {"episode": team.episodes, "kind": "eval", **result,
                     "heuristic_total": baseline["total"], "epsilon": round(epsilon, 3)}
            curve.append(point)
            marker = ""
            if result["total"] < best["total"]:
                best = result
                best_team = copy.deepcopy(team)
                marker = "  * new best"
            print(f"ep {team.episodes:5d}  eps {epsilon:.3f}  eval {result['total']:9.1f}  "
                  f"(heuristic {baseline['total']:.1f})  states {team.state_count()}  "
                  f"{time.time() - start:5.1f}s{marker}")

    best_team.episodes = team.episodes
    best_team.save(MODEL_PATH)
    save_curve(curve)
    print(f"saved best policy ({best['total']:.1f} vs heuristic {baseline['total']:.1f}) to {MODEL_PATH}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--episodes", type=int, default=3000)
    ap.add_argument("--eval-every", type=int, default=100)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--eps-start", type=float, default=0.3)
    ap.add_argument("--eps-end", type=float, default=0.02)
    ap.add_argument("--fresh", action="store_true", help="ignore any saved model and start over")
    args = ap.parse_args()
    train(args.episodes, args.eval_every, args.seed, args.eps_start, args.eps_end, args.fresh)


if __name__ == "__main__":
    main()
