"""Runs one disaster episode tick by tick under a chosen allocation policy."""
from __future__ import annotations

import random
from dataclasses import dataclass

from .agents import HeuristicAgent, QTeam
from .baselines import static_priority, uncoordinated
from .config import (DEPENDENCIES, EPISODE_TICKS, TICK_HOURS, TICK_MINUTES, UTILITIES, UTILITY_BY_ID,
                     UTILITY_IDS)
from .damage import assess
from .ledger import InvariantViolation, Ledger
from .narrator import Narrator
from .protocol import NegotiationResult, check_safe, effective_priority, negotiate, priority_allocate
from .scenario import Scenario
from .utility import UtilityState

POLICIES = {
    "gridpact_rl": "GridPact · RL agents",
    "gridpact_heuristic": "GridPact · rule-based agents",
    "static_priority": "Static priority list",
    "uncoordinated": "Uncoordinated (today)",
}
NEGOTIATING = {"gridpact_rl", "gridpact_heuristic"}

SHARED_REWARD = 0.7
OWN_REWARD = 0.3
REWARD_SCALE = 10.0


def jain(values: list[float]) -> float:
    sq = sum(v * v for v in values)
    if sq <= 0:
        return 0.0
    return (sum(values) ** 2) / (len(values) * sq)


def clock(tick: int) -> str:
    minutes = tick * TICK_MINUTES
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


@dataclass
class EpisodeSummary:
    policy: str
    scenario: str
    total_damage: float
    cascade_events: int
    capacity_violations: int
    fallback_ticks: int
    safety_interventions: int
    max_rounds: int
    avg_fairness: float
    min_fairness: float
    max_starvation_ticks: int
    critical_hours_lost: float
    unserved_mwh: float
    damage_by_utility: dict[str, float]

    def to_dict(self) -> dict:
        return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


class Simulation:
    def __init__(self, scenario: Scenario, policy: str, team: QTeam | None = None, seed: int = 0,
                 learn: bool = False, narrate: bool = True):
        if policy not in POLICIES:
            raise KeyError(f"unknown policy '{policy}'")
        if policy == "gridpact_rl" and team is None:
            raise ValueError("gridpact_rl needs a QTeam")
        self.scenario = scenario
        self.policy = policy
        self.team = team
        self.learn = learn and policy == "gridpact_rl"
        if policy == "gridpact_rl":
            self.agents = team.agents
            team.set_learning(self.learn)
        else:
            heuristic = HeuristicAgent()
            self.agents = {uid: heuristic for uid in UTILITY_IDS}
        self.states = {u.id: UtilityState(u) for u in UTILITIES}
        self.ledger = Ledger(UTILITY_IDS)
        self.narrator = Narrator() if narrate else None
        self.rng = random.Random(seed)
        self.tick = 0
        self.prev_down: set[str] = set()
        self.prev_cascades: set[tuple[str, str]] = set()
        self.prev_supply: float | None = None
        self.total_damage = 0.0
        self.damage_by_utility = {uid: 0.0 for uid in UTILITY_IDS}
        self.cascade_events = 0
        self.violations = 0
        self.fallback_ticks = 0
        self.safety_interventions = 0
        self.max_rounds = 0
        self.fairness: list[float] = []

    @property
    def done(self) -> bool:
        return self.tick >= EPISODE_TICKS

    def step(self) -> dict:
        t = self.tick
        sc = self.scenario
        supply = sc.supply_at(t)

        refuels = sc.refuels_at(t)
        for ev in refuels:
            self.states[ev.target].refuel(ev.mwh)

        needs = {uid: self.states[uid].need(*sc.demand_multipliers(t, uid)) for uid in UTILITY_IDS}
        credits = {uid: self.states[uid].starvation_credit for uid in UTILITY_IDS}

        result: NegotiationResult | None = None
        if self.policy in NEGOTIATING:
            context = {uid: {"buffer_fraction": self.states[uid].buffer_fraction,
                             "has_buffer": UTILITY_BY_ID[uid].buffer_capacity > 0,
                             "starvation_credit": credits[uid],
                             "upstream_down": any(d in self.prev_down for d in _upstream(uid))}
                       for uid in UTILITY_IDS}
            result = negotiate(t, supply, needs, self.agents, context)
            allocation = result.allocation
            self.max_rounds = max(self.max_rounds, len(result.rounds))
            self.fallback_ticks += int(result.fallback_used)
            self.safety_interventions += int(result.safety_intervened)
        elif self.policy == "static_priority":
            allocation = static_priority(supply, needs)
        else:
            allocation = uncoordinated(supply, needs, self.rng)

        try:
            self.ledger.commit(t, supply, allocation, needs)
        except InvariantViolation:
            # Never apply a rejected allocation. Recompute in safe mode and commit that instead.
            self.violations += 1
            priority = {uid: effective_priority(uid, credits[uid]) for uid in UTILITY_IDS}
            allocation = priority_allocate(supply, needs, {u: n.full for u, n in needs.items()},
                                           priority, life_first=True)
            self.ledger.commit(t, supply, allocation, needs)

        outcomes = {uid: self.states[uid].apply(allocation[uid], needs[uid]) for uid in UTILITY_IDS}
        report = assess(outcomes, {uid: s.dark_streak for uid, s in self.states.items()})

        self.total_damage += report.total
        for uid, d in report.per_utility.items():
            self.damage_by_utility[uid] += d
        cascades = set(report.cascades)
        self.cascade_events += len(cascades - self.prev_cascades)

        operational_share = [min(1.0, outcomes[u].served / needs[u].operational) for u in UTILITY_IDS]
        fairness = jain(operational_share)
        self.fairness.append(fairness)

        if self.learn:
            n = len(UTILITY_IDS)
            for uid, agent in self.agents.items():
                r = -(SHARED_REWARD * report.total / n + OWN_REWARD * report.per_utility[uid]) / REWARD_SCALE
                agent.reward(r)

        log = []
        if self.narrator is not None:
            log = self.narrator.tick(
                time=clock(t), supply=supply, prev_supply=self.prev_supply,
                supply_labels=[e.label for e in sc.supply_events_at(t)],
                demand_labels=[e.label for e in sc.demand_events_starting(t)],
                ended_labels=[e.label for e in sc.demand_events_ending(t)],
                refuel_labels=[e.label for e in refuels],
                needs=needs, result=result, policy=self.policy, outcomes=outcomes,
                buffers={uid: s.buffer_fraction for uid, s in self.states.items()},
                cascades=sorted(cascades),
                credits={uid: s.starvation_credit for uid, s in self.states.items()}
                if self.policy in NEGOTIATING else {})

        safe_ok, _ = check_safe(allocation, needs)
        record = {
            "tick": t,
            "time": clock(t),
            "supply": round(supply, 2),
            "demand": {"critical": round(sum(n.critical for n in needs.values()), 2),
                       "operational": round(sum(n.operational for n in needs.values()), 2),
                       "full": round(sum(n.full for n in needs.values()), 2)},
            "allocated": round(sum(allocation.values()), 3),
            "utilities": {
                uid: {
                    "alloc": round(allocation[uid], 3),
                    "served": round(outcomes[uid].served, 3),
                    "discharged": round(outcomes[uid].discharged, 3),
                    "critical": round(needs[uid].critical, 3),
                    "essential": round(needs[uid].essential, 3),
                    "deferrable": round(needs[uid].deferrable, 3),
                    "buffer_pct": round(self.states[uid].buffer_fraction, 4),
                    "status": outcomes[uid].status,
                    "credit": self.states[uid].starvation_credit,
                    "damage": round(report.per_utility[uid], 3),
                    "effectiveness": round(report.effectiveness[uid], 3),
                    "action": result.final_actions.get(uid) if result else None,
                } for uid in UTILITY_IDS},
            "rounds": [r.__dict__ for r in result.rounds] if result else [],
            "agreed": result.agreed if result else None,
            "fallback": result.fallback_used if result else None,
            "safety_intervened": result.safety_intervened if result else False,
            "safe_state": safe_ok,
            "damage_tick": round(report.total, 3),
            "damage_total": round(self.total_damage, 3),
            "cascades": [list(c) for c in sorted(cascades)],
            "cascade_events": self.cascade_events,
            "fairness": round(fairness, 4),
            "violations": self.violations,
            "log": log,
        }
        self.prev_down = report.down
        self.prev_cascades = cascades
        self.prev_supply = supply
        self.tick += 1
        if self.done and self.learn:
            self.team.end_episode()
            self.team.episodes += 1
        return record

    def run(self) -> list[dict]:
        records = []
        while not self.done:
            records.append(self.step())
        return records

    def summary(self) -> EpisodeSummary:
        return EpisodeSummary(
            policy=self.policy,
            scenario=self.scenario.id,
            total_damage=self.total_damage,
            cascade_events=self.cascade_events,
            capacity_violations=self.violations,
            fallback_ticks=self.fallback_ticks,
            safety_interventions=self.safety_interventions,
            max_rounds=self.max_rounds,
            avg_fairness=sum(self.fairness) / len(self.fairness) if self.fairness else 0.0,
            min_fairness=min(self.fairness) if self.fairness else 0.0,
            max_starvation_ticks=max(s.max_dark_streak for s in self.states.values()),
            critical_hours_lost=sum(s.ticks_below_critical for s in self.states.values()) * TICK_HOURS,
            unserved_mwh=sum(s.unserved_mwh for s in self.states.values()),
            damage_by_utility=dict(self.damage_by_utility),
        )


def _upstream(uid: str) -> tuple[str, ...]:
    return DEPENDENCIES.get(uid, ())
