"""Runtime state of one utility: its load tiers this tick, its backup buffer and its history."""
from __future__ import annotations

from dataclasses import dataclass, field

from .config import (EPS, MAX_STARVATION_CREDIT, RECHARGE_EFFICIENCY, TICK_HOURS,
                     UtilitySpec)


@dataclass(frozen=True)
class Need:
    """Load tiers for one tick. Computed by the simulator from true state, so agents cannot inflate them."""
    critical: float
    essential: float
    deferrable: float
    buffer_rate: float          # MW the backup buffer can deliver this tick

    @property
    def full(self) -> float:
        return self.critical + self.essential + self.deferrable

    @property
    def operational(self) -> float:
        return self.critical + self.essential


@dataclass
class ServiceOutcome:
    allocated: float
    discharged: float           # MW drawn from the buffer
    served: float               # allocated + discharged
    critical_cover: float       # 0..1 share of critical load met
    essential_cover: float      # 0..1 share of essential load met
    status: str                 # full | essential | critical | buffer | dark


@dataclass
class UtilityState:
    spec: UtilitySpec
    buffer: float = field(default=-1.0)       # MWh remaining; -1 means "start full"
    dark_streak: int = 0                       # consecutive ticks below critical
    max_dark_streak: int = 0
    starvation_credit: int = 0
    ticks_below_critical: int = 0
    unserved_mwh: float = 0.0

    def __post_init__(self) -> None:
        if self.buffer < 0:
            self.buffer = self.spec.buffer_capacity

    @property
    def buffer_fraction(self) -> float:
        cap = self.spec.buffer_capacity
        return self.buffer / cap if cap > 0 else 0.0

    def need(self, critical_mult: float = 1.0, essential_mult: float = 1.0) -> Need:
        s = self.spec
        rate = min(s.buffer_max_rate, self.buffer / TICK_HOURS) if s.buffer_capacity > 0 else 0.0
        return Need(critical=s.critical * critical_mult,
                    essential=s.essential * essential_mult,
                    deferrable=s.deferrable,
                    buffer_rate=max(0.0, rate))

    def apply(self, allocated: float, need: Need) -> ServiceOutcome:
        """Consume one tick of power: draw the buffer to cover any critical deficit, recharge from surplus."""
        s = self.spec
        deficit = max(0.0, need.critical - allocated)
        discharged = min(deficit, need.buffer_rate)
        self.buffer = max(0.0, self.buffer - discharged * TICK_HOURS)
        served = allocated + discharged

        if s.rechargeable and allocated > need.operational + EPS:
            surplus = min(allocated - need.operational, need.deferrable)
            self.buffer = min(s.buffer_capacity,
                              self.buffer + surplus * TICK_HOURS * RECHARGE_EFFICIENCY)

        critical_cover = min(1.0, served / need.critical) if need.critical > EPS else 1.0
        essential_part = max(0.0, served - need.critical)
        essential_cover = min(1.0, essential_part / need.essential) if need.essential > EPS else 1.0

        if critical_cover < 1.0 - 1e-3:
            status = "dark"
            self.dark_streak += 1
            self.ticks_below_critical += 1
        else:
            self.dark_streak = 0
            if discharged > EPS:
                status = "buffer"
            elif essential_cover >= 1.0 - 1e-3:
                status = "full"
            elif essential_cover > 0.0:
                status = "essential"
            else:
                status = "critical"
        self.max_dark_streak = max(self.max_dark_streak, self.dark_streak)
        self.unserved_mwh += max(0.0, need.operational - served) * TICK_HOURS

        # Starvation credit (priority aging): grows while the utility is held below normal operation.
        if served + EPS < need.operational:
            self.starvation_credit = min(MAX_STARVATION_CREDIT, self.starvation_credit + 1)
        elif self.starvation_credit > 0:
            self.starvation_credit -= 1

        return ServiceOutcome(allocated, discharged, served, critical_cover, essential_cover, status)

    def refuel(self, mwh: float) -> None:
        self.buffer = min(self.spec.buffer_capacity, self.buffer + mwh)
