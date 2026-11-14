"""GridPact negotiation protocol and safety layer.

Per tick:
  1. Every agent sees its own (simulator-computed) need and bids one of four actions.
  2. Up to NEGOTIATION_ROUNDS rounds. Bids are monotonic: within a tick a bid can only go
     down, so the process converges. Nobody holds power during negotiation (no hold-and-wait).
  3. If the bids fit the supply, they are granted and any leftover tops agents up toward full
     need in effective-priority order, so no power is wasted.
  4. Otherwise a deterministic fallback allocates by effective priority (base priority plus
     starvation aging): critical floors first, then the rest weighted by priority.
  5. A Banker's-style safe-state check rejects any allocation that leaves a life-critical
     utility below its critical load while power is still held above another utility's
     critical floor. Rejected allocations are recomputed in safe mode.
  6. The ledger commits the allocation atomically as one-tick leases.

Deadlock freedom: no hold-and-wait (grants exist only after commit), leases expire every tick
(preemption), conflicts resolve in one global order (priority, then id: no circular wait),
and negotiation is bounded with a guaranteed fallback, so every tick terminates.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum
from typing import Protocol

from .config import AGING_STEP, EPS, NEGOTIATION_ROUNDS, UTILITY_BY_ID
from .utility import Need


class Action(IntEnum):
    FULL = 0            # critical + essential + deferrable
    ESSENTIAL = 1       # critical + essential
    CRITICAL = 2        # critical only
    DRAW_BUFFER = 3     # below critical, covering the gap from the backup buffer


ACTION_LABELS = {Action.FULL: "requests full load", Action.ESSENTIAL: "trims to essential load",
                 Action.CRITICAL: "concedes to critical-only", Action.DRAW_BUFFER: "draws on its backup"}


@dataclass(frozen=True)
class Observation:
    uid: str
    round: int
    supply: float
    need: Need
    buffer_fraction: float
    has_buffer: bool
    starvation_credit: int
    supply_ratio: float          # supply / total full demand
    shortfall_ratio: float       # (current total bids - supply) / supply
    critical_ratio: float        # total critical demand / supply
    upstream_down: bool          # an upstream dependency was down last tick
    life_critical: bool


class Agent(Protocol):
    def act(self, obs: Observation) -> Action: ...


def bid_amount(action: Action, need: Need) -> float:
    if action == Action.FULL:
        return need.full
    if action == Action.ESSENTIAL:
        return need.operational
    if action == Action.CRITICAL:
        return need.critical
    cover = min(need.buffer_rate, 0.75 * need.critical)
    return max(0.0, need.critical - cover)


def effective_priority(uid: str, credit: int) -> float:
    return UTILITY_BY_ID[uid].base_priority + AGING_STEP * credit


@dataclass
class RoundRecord:
    round: int
    actions: dict[str, int]
    bids: dict[str, float]
    total: float


@dataclass
class NegotiationResult:
    allocation: dict[str, float]
    rounds: list[RoundRecord]
    agreed: bool
    fallback_used: bool
    safety_intervened: bool
    safety_reason: str = ""
    final_actions: dict[str, int] = field(default_factory=dict)


# ---- Allocators ----------------------------------------------------------------------------

def _order(ids, priority: dict[str, float]) -> list[str]:
    return sorted(ids, key=lambda i: (-priority[i], i))


def top_up(allocation: dict[str, float], needs: dict[str, Need], supply: float,
           priority: dict[str, float]) -> dict[str, float]:
    """Hand any unallocated supply to agents still below full need, highest priority first."""
    remaining = supply - sum(allocation.values())
    if remaining <= EPS:
        return allocation
    out = dict(allocation)
    for tier in ("operational", "full"):
        for uid in _order(out, priority):
            if remaining <= EPS:
                return out
            target = getattr(needs[uid], tier)
            extra = min(remaining, max(0.0, target - out[uid]))
            out[uid] += extra
            remaining -= extra
    return out


def weighted_fill(wants: dict[str, float], budget: float, priority: dict[str, float]) -> dict[str, float]:
    """Split `budget` across `wants` in proportion to priority, capping each at its want (water-filling)."""
    grant = {uid: 0.0 for uid in wants}
    active = {uid for uid, w in wants.items() if w > EPS}
    while budget > EPS and active:
        total_w = sum(priority[u] for u in active)
        spent = 0.0
        done = set()
        for uid in active:
            share = budget * priority[uid] / total_w
            give = min(share, wants[uid] - grant[uid])
            grant[uid] += give
            spent += give
            if wants[uid] - grant[uid] <= EPS:
                done.add(uid)
        budget -= spent
        active -= done
        if not done:
            break
    return grant


def priority_allocate(supply: float, needs: dict[str, Need], bids: dict[str, float],
                      priority: dict[str, float], life_first: bool = False) -> dict[str, float]:
    """Deterministic fallback: critical floors in priority order, then the remainder weighted by priority."""
    alloc = {uid: 0.0 for uid in needs}
    remaining = supply
    order = _order(needs, priority)
    if life_first:
        order = ([u for u in order if UTILITY_BY_ID[u].life_critical]
                 + [u for u in order if not UTILITY_BY_ID[u].life_critical])
    for uid in order:
        floor = needs[uid].critical if (life_first and UTILITY_BY_ID[uid].life_critical) \
            else min(bids[uid], needs[uid].critical)
        give = min(remaining, floor)
        alloc[uid] = give
        remaining -= give
    wants = {uid: max(0.0, max(bids[uid], alloc[uid]) - alloc[uid]) for uid in needs}
    extra = weighted_fill(wants, remaining, priority)
    for uid in alloc:
        alloc[uid] = min(needs[uid].full, alloc[uid] + extra[uid])
    return alloc


def check_safe(allocation: dict[str, float], needs: dict[str, Need]) -> tuple[bool, str]:
    """Banker's-style safe-state test for life-critical utilities.

    A life-critical utility whose grid allocation plus available backup cannot cover its
    critical load is only acceptable if no power remains to reclaim: every other utility
    must already be at or below its own critical floor.
    """
    for uid, alloc in allocation.items():
        spec = UTILITY_BY_ID[uid]
        if not spec.life_critical:
            continue
        secured = alloc + needs[uid].buffer_rate
        if secured + 1e-4 < needs[uid].critical:
            reclaimable = sum(max(0.0, allocation[o] - needs[o].critical)
                              for o in allocation if o != uid)
            if reclaimable > 1e-3:
                return False, (f"{spec.name} would be {needs[uid].critical - secured:.1f} MW short of critical "
                               f"while {reclaimable:.1f} MW sits above other utilities' critical floors")
    return True, ""


# ---- Negotiation ---------------------------------------------------------------------------

def negotiate(tick: int, supply: float, needs: dict[str, Need], agents: dict[str, Agent],
              context: dict[str, dict]) -> NegotiationResult:
    """Run bounded, monotonic negotiation rounds, then fall back and safety-check if needed.

    `context[uid]` carries buffer_fraction, has_buffer, starvation_credit and upstream_down.
    """
    ids = list(needs)
    total_full = sum(n.full for n in needs.values())
    total_crit = sum(n.critical for n in needs.values())
    priority = {uid: effective_priority(uid, context[uid]["starvation_credit"]) for uid in ids}

    bids = {uid: needs[uid].full for uid in ids}
    actions = {uid: int(Action.FULL) for uid in ids}
    rounds: list[RoundRecord] = []
    agreed = False
    for r in range(NEGOTIATION_ROUNDS):
        current_total = sum(bids.values())
        shortfall = (current_total - supply) / supply if supply > EPS else 1.0
        new_bids = {}
        for uid in ids:
            ctx = context[uid]
            obs = Observation(uid=uid, round=r, supply=supply, need=needs[uid],
                              buffer_fraction=ctx["buffer_fraction"], has_buffer=ctx["has_buffer"],
                              starvation_credit=ctx["starvation_credit"],
                              supply_ratio=supply / total_full if total_full > EPS else 1.0,
                              shortfall_ratio=shortfall,
                              critical_ratio=total_crit / supply if supply > EPS else 9.0,
                              upstream_down=ctx["upstream_down"],
                              life_critical=UTILITY_BY_ID[uid].life_critical)
            action = Action(agents[uid].act(obs))
            actions[uid] = int(action)
            new_bids[uid] = min(bids[uid], bid_amount(action, needs[uid]))   # monotonic concession
        bids = new_bids
        total = sum(bids.values())
        rounds.append(RoundRecord(r, dict(actions), {k: round(v, 3) for k, v in bids.items()}, round(total, 3)))
        if total <= supply + EPS:
            agreed = True
            break

    if agreed:
        allocation = top_up(dict(bids), needs, supply, priority)
        fallback = False
    else:
        allocation = priority_allocate(supply, needs, bids, priority)
        fallback = True

    safe, reason = check_safe(allocation, needs)
    intervened = False
    if not safe:
        intervened = True
        allocation = priority_allocate(supply, needs, bids, priority, life_first=True)
        safe2, reason2 = check_safe(allocation, needs)
        if not safe2:   # cannot happen by construction; fail loudly rather than commit an unsafe state
            raise RuntimeError(f"safe-mode allocation still unsafe: {reason2}")

    allocation = {uid: round(max(0.0, mw), 6) for uid, mw in allocation.items()}
    _trim_to_capacity(allocation, supply)
    return NegotiationResult(allocation, rounds, agreed, fallback, intervened, reason, dict(actions))


def _trim_to_capacity(allocation: dict[str, float], supply: float) -> None:
    """Remove float rounding excess so the committed total never exceeds supply."""
    excess = sum(allocation.values()) - supply
    if excess > 0:
        for uid in sorted(allocation, key=lambda u: -allocation[u]):
            cut = min(excess, allocation[uid])
            allocation[uid] -= cut
            excess -= cut
            if excess <= 0:
                break
