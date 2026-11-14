"""Reproduce the named-scenario scores and evaluate on seeded random disasters.

    python -m omnigrid.benchmark --seed 42 --random-cases 200

The benchmark loads the checked-in Q-table, evaluates every named scenario once,
then compares RL with the rule-based policy on the same generated random cases.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from .agents import QTeam
from .config import UTILITY_IDS
from .scenario import SCENARIOS, get_scenario, random_scenario
from .simulation import Simulation
from .train import MODEL_PATH


def evaluate(policy: str, scenario, seed: int, team: QTeam | None = None) -> float:
    sim = Simulation(scenario, policy, team=team, seed=seed, narrate=False)
    sim.run()
    return sim.total_damage


def benchmark(seed: int, random_cases: int) -> dict:
    if random_cases < 1:
        raise ValueError("random-cases must be at least 1")
    team = QTeam(UTILITY_IDS, seed=seed)
    if not team.load(MODEL_PATH):
        raise FileNotFoundError(f"trained model not found: {MODEL_PATH}")
    team.set_learning(False)

    named = {}
    for scenario_id in SCENARIOS:
        scenario = get_scenario(scenario_id)
        named[scenario_id] = {
            "gridpact_rl": round(evaluate("gridpact_rl", scenario, seed, team), 2),
            "gridpact_heuristic": round(evaluate("gridpact_heuristic", scenario, seed), 2),
            "static_priority": round(evaluate("static_priority", scenario, seed), 2),
            "uncoordinated": round(evaluate("uncoordinated", scenario, seed), 2),
        }

    rng = random.Random(seed)
    rl_scores = []
    heuristic_scores = []
    wins = 0
    for case_index in range(random_cases):
        scenario = random_scenario(rng)
        case_seed = seed + case_index
        rl = evaluate("gridpact_rl", scenario, case_seed, team)
        heuristic = evaluate("gridpact_heuristic", scenario, case_seed)
        rl_scores.append(rl)
        heuristic_scores.append(heuristic)
        wins += rl < heuristic

    rl_mean = sum(rl_scores) / random_cases
    heuristic_mean = sum(heuristic_scores) / random_cases
    return {
        "seed": seed,
        "random_cases": random_cases,
        "method": "Each random scenario is generated once and evaluated by both policies with the same per-case simulation seed; lower damage wins.",
        "model": {"path": str(MODEL_PATH.name), "episodes": team.episodes, "states": team.state_count()},
        "named_scenarios": named,
        "random_results": {
            "gridpact_rl_mean_damage": round(rl_mean, 2),
            "gridpact_heuristic_mean_damage": round(heuristic_mean, 2),
            "rl_damage_reduction_percent": round((1 - rl_mean / heuristic_mean) * 100, 2)
            if heuristic_mean else 0.0,
            "rl_wins": wins,
            "cases": random_cases,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--random-cases", type=int, default=200)
    parser.add_argument("--output", type=Path, help="also save the JSON report at this path")
    args = parser.parse_args()
    report = benchmark(args.seed, args.random_cases)
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
