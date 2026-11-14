"""Baseline allocators that model how utilities behave today, for comparison with Omni Grid Harness.

- uncoordinated: every utility grabs its full load in arbitrary (random) order until the grid
  runs out, with no negotiation, priorities, or safety layer.
- static_priority: a fixed priority list (hospitals always first) where each utility in turn
  takes its full load. Life-critical loads are protected, but lower priorities starve for hours.
"""
from __future__ import annotations

import random

from .config import UTILITY_BY_ID
from .utility import Need


def uncoordinated(supply: float, needs: dict[str, Need], rng: random.Random) -> dict[str, float]:
    order = list(needs)
    rng.shuffle(order)
    remaining = supply
    alloc = {}
    for uid in order:
        give = min(remaining, needs[uid].full)
        alloc[uid] = give
        remaining -= give
    return alloc


def static_priority(supply: float, needs: dict[str, Need]) -> dict[str, float]:
    order = sorted(needs, key=lambda u: (-UTILITY_BY_ID[u].base_priority, u))
    remaining = supply
    alloc = {}
    for uid in order:
        give = min(remaining, needs[uid].full)
        alloc[uid] = give
        remaining -= give
    return alloc
