"""Append-only allocation ledger with atomic, invariant-checked commits and expiring leases.

A tick's allocation is validated as a whole before anything is recorded. If any invariant
fails, nothing is committed and InvariantViolation is raised, so the system can never sit in
a half-applied state where two utilities believe they hold the same megawatts.
"""
from __future__ import annotations

from dataclasses import dataclass

from .config import EPS
from .utility import Need


class InvariantViolation(Exception):
    pass


@dataclass(frozen=True)
class Lease:
    holder: str
    mw: float
    granted_tick: int
    expires_tick: int        # power is leased for one tick, then renegotiated


@dataclass(frozen=True)
class Commit:
    version: int
    tick: int
    supply: float
    leases: tuple[Lease, ...]

    @property
    def allocated(self) -> float:
        return sum(l.mw for l in self.leases)


class Ledger:
    def __init__(self, holders: tuple[str, ...]):
        self.holders = holders
        self.commits: list[Commit] = []
        self.rejected = 0

    @property
    def last_tick(self) -> int:
        return self.commits[-1].tick if self.commits else -1

    def validate(self, tick: int, supply: float, allocation: dict[str, float],
                 needs: dict[str, Need]) -> None:
        if tick <= self.last_tick:
            raise InvariantViolation(f"tick {tick} already committed (last {self.last_tick})")
        if set(allocation) != set(self.holders):
            raise InvariantViolation("allocation must cover every utility exactly once")
        total = 0.0
        for uid, mw in allocation.items():
            if mw < -EPS:
                raise InvariantViolation(f"negative allocation for {uid}: {mw}")
            if mw > needs[uid].full + 1e-4:
                raise InvariantViolation(f"{uid} allocated {mw:.3f} MW above its full need {needs[uid].full:.3f}")
            total += mw
        if total > supply + 1e-4:
            raise InvariantViolation(f"capacity exceeded: {total:.3f} MW allocated of {supply:.3f} MW")

    def commit(self, tick: int, supply: float, allocation: dict[str, float],
               needs: dict[str, Need]) -> Commit:
        """Atomically validate and record the whole allocation, or record nothing."""
        try:
            self.validate(tick, supply, allocation, needs)
        except InvariantViolation:
            self.rejected += 1
            raise
        leases = tuple(Lease(uid, round(max(0.0, allocation[uid]), 6), tick, tick + 1)
                       for uid in self.holders)
        record = Commit(len(self.commits) + 1, tick, supply, leases)
        self.commits.append(record)
        return record

    def active_leases(self, tick: int) -> tuple[Lease, ...]:
        if not self.commits:
            return ()
        last = self.commits[-1]
        return tuple(l for l in last.leases if l.granted_tick <= tick < l.expires_tick)
