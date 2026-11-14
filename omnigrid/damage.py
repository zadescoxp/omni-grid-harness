"""Damage and cascade model.

Each tick a utility accrues harm from unmet critical load (heavily weighted, growing the longer
it lasts) and unmet essential load. A utility whose critical coverage falls below DOWN_THRESHOLD
counts as "down", and every utility that depends on it loses effectiveness: that is how a
telecom outage cripples emergency dispatch even when dispatch itself still has power.
"""
from __future__ import annotations

from dataclasses import dataclass

from .config import (CRITICAL_GAP_WEIGHT, DEPENDENCIES, DEPENDENCY_PENALTY, DOWN_THRESHOLD,
                     DURATION_CAP, DURATION_STEP, ESSENTIAL_GAP_WEIGHT, UTILITY_BY_ID)
from .utility import ServiceOutcome


@dataclass
class DamageReport:
    per_utility: dict[str, float]
    effectiveness: dict[str, float]
    down: set[str]
    cascades: list[tuple[str, str]]      # (failed upstream, affected downstream)

    @property
    def total(self) -> float:
        return sum(self.per_utility.values())


def assess(outcomes: dict[str, ServiceOutcome], dark_streaks: dict[str, int]) -> DamageReport:
    down = {uid for uid, o in outcomes.items() if o.critical_cover < DOWN_THRESHOLD}

    effectiveness: dict[str, float] = {}
    cascades: list[tuple[str, str]] = []
    for uid in outcomes:
        eff = 1.0
        for upstream in DEPENDENCIES.get(uid, ()):
            if upstream in down:
                eff *= 1.0 - DEPENDENCY_PENALTY
                cascades.append((upstream, uid))
        effectiveness[uid] = eff

    per_utility: dict[str, float] = {}
    for uid, o in outcomes.items():
        spec = UTILITY_BY_ID[uid]
        eff = effectiveness[uid]
        crit_gap = 1.0 - o.critical_cover * eff
        ess_gap = 1.0 - o.essential_cover * eff
        duration = min(DURATION_CAP, 1.0 + DURATION_STEP * dark_streaks.get(uid, 0))
        harm = spec.weight * (CRITICAL_GAP_WEIGHT * crit_gap * duration + ESSENTIAL_GAP_WEIGHT * ess_gap)
        per_utility[uid] = round(harm, 4)
    return DamageReport(per_utility, effectiveness, down, cascades)
