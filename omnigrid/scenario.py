"""Disaster scenarios: a fluctuating power supply plus timed demand surges and refuels.

Named scenarios are deterministic (seeded noise) so runs are comparable across policies.
`random_scenario` produces varied episodes for training so agents do not memorise one timeline.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .config import EPISODE_HOURS, TICKS_PER_HOUR, UTILITY_IDS


@dataclass(frozen=True)
class SupplyEvent:
    hour: float
    mw: float
    label: str


@dataclass(frozen=True)
class DemandEvent:
    start_hour: float
    end_hour: float
    target: str
    critical_mult: float
    essential_mult: float
    label: str


@dataclass(frozen=True)
class RefuelEvent:
    hour: float
    target: str
    mwh: float
    label: str


@dataclass
class Scenario:
    id: str
    name: str
    description: str
    supply_events: list[SupplyEvent]
    demand_events: list[DemandEvent] = field(default_factory=list)
    refuel_events: list[RefuelEvent] = field(default_factory=list)
    noise_mw: float = 2.0
    seed: int = 7

    def __post_init__(self) -> None:
        self.supply_events = sorted(self.supply_events, key=lambda e: e.hour)
        rng = random.Random(self.seed)
        n = EPISODE_HOURS * TICKS_PER_HOUR
        self._noise = [rng.uniform(-self.noise_mw, self.noise_mw) for _ in range(n)]

    @staticmethod
    def hour_of(tick: int) -> float:
        return tick / TICKS_PER_HOUR

    def supply_at(self, tick: int) -> float:
        hour = self.hour_of(tick)
        level = self.supply_events[0].mw
        for ev in self.supply_events:
            if ev.hour <= hour + 1e-9:
                level = ev.mw
            else:
                break
        noise = self._noise[tick % len(self._noise)]
        return max(0.0, round(level + noise, 2))

    def supply_events_at(self, tick: int) -> list[SupplyEvent]:
        hour = self.hour_of(tick)
        return [e for e in self.supply_events if abs(e.hour - hour) < 1e-9 and e.hour > 0]

    def demand_multipliers(self, tick: int, uid: str) -> tuple[float, float]:
        hour = self.hour_of(tick)
        crit, ess = diurnal(uid, hour)
        for ev in self.demand_events:
            if ev.target == uid and ev.start_hour <= hour < ev.end_hour:
                crit *= ev.critical_mult
                ess *= ev.essential_mult
        return crit, ess

    def demand_events_starting(self, tick: int) -> list[DemandEvent]:
        hour = self.hour_of(tick)
        return [e for e in self.demand_events if abs(e.start_hour - hour) < 1e-9]

    def demand_events_ending(self, tick: int) -> list[DemandEvent]:
        hour = self.hour_of(tick)
        return [e for e in self.demand_events if abs(e.end_hour - hour) < 1e-9]

    def refuels_at(self, tick: int) -> list[RefuelEvent]:
        hour = self.hour_of(tick)
        return [e for e in self.refuel_events if abs(e.hour - hour) < 1e-9]

    def describe(self) -> dict:
        return {"id": self.id, "name": self.name, "description": self.description,
                "supply": [self.supply_at(t) for t in range(EPISODE_HOURS * TICKS_PER_HOUR)],
                "events": [{"hour": e.hour, "label": e.label} for e in self.supply_events if e.hour > 0]
                + [{"hour": e.start_hour, "label": e.label} for e in self.demand_events]
                + [{"hour": e.hour, "label": e.label} for e in self.refuel_events]}


def diurnal(uid: str, hour: float) -> tuple[float, float]:
    """Everyday demand shape: water peaks morning and evening, telecom is busier by day."""
    h = hour % 24
    if uid == "water_main":
        peak = 1.15 if (6 <= h < 9 or 18 <= h < 21) else 1.0
        return peak, peak
    if uid == "telecom":
        day = 1.0 + 0.08 * max(0.0, math.sin(math.pi * (h - 7) / 15)) if 7 <= h <= 22 else 1.0
        return day, day
    return 1.0, 1.0


# ---- Named scenarios ----------------------------------------------------------------------

def monsoon_flood() -> Scenario:
    return Scenario(
        id="monsoon_flood",
        name="Monsoon Flash Flood",
        description="A cloudburst floods low-lying substations across central Bengaluru. "
                    "Casualties surge, pumps work overtime and a second feeder trips at midday.",
        supply_events=[
            SupplyEvent(0, 88, "Normal grid supply"),
            SupplyEvent(2, 56, "Cloudburst floods the Seshadripuram feeder; supply down to 56 MW"),
            SupplyEvent(4, 44, "Second substation bay shuts for safety; supply falls to 44 MW"),
            SupplyEvent(7, 52, "Repair crews restore one bay; supply up to 52 MW"),
            SupplyEvent(9, 62, "Mobile transformer energised; supply up to 62 MW"),
            SupplyEvent(12, 40, "Waterlogged cable trips the ring main; supply crashes to 40 MW"),
            SupplyEvent(15, 55, "Cable bypass completed; supply up to 55 MW"),
            SupplyEvent(18, 68, "Flood water recedes; supply up to 68 MW"),
            SupplyEvent(21, 82, "Most feeders back online; supply up to 82 MW"),
        ],
        demand_events=[
            DemandEvent(3, 9, "victoria_hospital", 1.35, 1.2, "Flood casualties surge at Victoria Hospital"),
            DemandEvent(2, 10, "sewage_lift", 1.5, 1.3, "Storm-water backflow floods the Shanthinagar sump"),
            DemandEvent(4, 12, "water_main", 1.2, 1.1, "Emergency pumping for flooded wards"),
            DemandEvent(3, 12, "dispatch_hq", 1.4, 1.5, "Emergency call volume triples"),
            DemandEvent(5, 8, "fire_station", 1.8, 1.5, "Building collapse rescue in Halasuru"),
            DemandEvent(10, 14, "bowring_hospital", 1.3, 1.2, "Evacuees overflow to Bowring Hospital"),
        ],
        refuel_events=[RefuelEvent(14, "victoria_hospital", 12.0, "Diesel tanker reaches Victoria Hospital"),
                       RefuelEvent(16, "bowring_hospital", 4.0, "Diesel tanker reaches Bowring Hospital")],
        seed=11,
    )


def heatwave() -> Scenario:
    return Scenario(
        id="heatwave",
        name="Summer Heatwave",
        description="A 42 °C afternoon pushes city demand past what the grid can generate. "
                    "Rotating load-shedding hits while heatstroke cases climb.",
        supply_events=[
            SupplyEvent(0, 86, "Normal grid supply"),
            SupplyEvent(10, 62, "Generation shortfall; supply down to 62 MW"),
            SupplyEvent(12, 50, "Peak heat trips a generating unit; supply down to 50 MW"),
            SupplyEvent(15, 47, "Transmission line sags; supply down to 47 MW"),
            SupplyEvent(17, 56, "Evening cooling; supply up to 56 MW"),
            SupplyEvent(20, 70, "Unit resynchronised; supply up to 70 MW"),
            SupplyEvent(22, 84, "Demand eases; supply up to 84 MW"),
        ],
        demand_events=[
            DemandEvent(10, 18, "water_main", 1.3, 1.25, "Heatwave water demand spike"),
            DemandEvent(12, 18, "victoria_hospital", 1.2, 1.15, "Heatstroke admissions at Victoria"),
            DemandEvent(12, 18, "bowring_hospital", 1.2, 1.15, "Heatstroke admissions at Bowring"),
            DemandEvent(11, 19, "telecom", 1.15, 1.1, "Cooling load on telecom exchange"),
            DemandEvent(13, 16, "fire_station", 1.6, 1.3, "Grass fires on the city outskirts"),
        ],
        seed=23,
    )


def grid_collapse() -> Scenario:
    return Scenario(
        id="grid_collapse",
        name="Cascading Grid Collapse",
        description="A transmission fault cascades into a near-blackout. Supply falls below the "
                    "city's combined critical load for hours before a slow restoration.",
        supply_events=[
            SupplyEvent(0, 80, "Normal grid supply"),
            SupplyEvent(1, 45, "Transmission fault islands the city; supply down to 45 MW"),
            SupplyEvent(3, 32, "Protection relays trip more feeders; supply down to 32 MW"),
            SupplyEvent(6, 38, "Black-start unit online; supply up to 38 MW"),
            SupplyEvent(10, 46, "Second unit synchronised; supply up to 46 MW"),
            SupplyEvent(14, 58, "Interconnector restored; supply up to 58 MW"),
            SupplyEvent(18, 72, "Most generation back; supply up to 72 MW"),
        ],
        demand_events=[
            DemandEvent(1, 8, "dispatch_hq", 1.3, 1.4, "Blackout emergency calls"),
            DemandEvent(2, 10, "victoria_hospital", 1.15, 1.1, "Patients transferred from dark clinics"),
            DemandEvent(4, 7, "fire_station", 1.5, 1.2, "Generator fire in Shivajinagar"),
        ],
        refuel_events=[RefuelEvent(9, "victoria_hospital", 10.0, "Diesel tanker reaches Victoria Hospital")],
        seed=5,
    )


SCENARIOS = {s.id: s for s in (monsoon_flood(), heatwave(), grid_collapse())}


def get_scenario(scenario_id: str) -> Scenario:
    factories = {"monsoon_flood": monsoon_flood, "heatwave": heatwave, "grid_collapse": grid_collapse}
    if scenario_id not in factories:
        raise KeyError(f"unknown scenario '{scenario_id}'")
    return factories[scenario_id]()


def random_scenario(rng: random.Random) -> Scenario:
    """Randomised disaster for training: random supply drops, recoveries, surges and refuels."""
    events = [SupplyEvent(0, rng.uniform(75, 92), "Normal grid supply")]
    hour = rng.uniform(0.5, 3.0)
    level = events[0].mw
    while hour < EPISODE_HOURS - 1:
        if rng.random() < 0.55:
            level = max(28.0, level - rng.uniform(8, 25))
            label = f"Supply drops to {level:.0f} MW"
        else:
            level = min(92.0, level + rng.uniform(5, 18))
            label = f"Supply recovers to {level:.0f} MW"
        events.append(SupplyEvent(round(hour * 4) / 4, level, label))
        hour += rng.uniform(1.0, 4.0)

    demand = []
    for _ in range(rng.randint(2, 6)):
        start = round(rng.uniform(0, 18) * 4) / 4
        length = round(rng.uniform(2, 8) * 4) / 4
        uid = rng.choice(UTILITY_IDS)
        cm = rng.uniform(1.1, 1.8)
        demand.append(DemandEvent(start, min(EPISODE_HOURS, start + length), uid, cm,
                                  rng.uniform(1.0, cm), f"Demand surge at {uid}"))
    refuels = []
    if rng.random() < 0.6:
        refuels.append(RefuelEvent(round(rng.uniform(8, 18) * 4) / 4,
                                   rng.choice(["victoria_hospital", "bowring_hospital"]),
                                   rng.uniform(4, 12), "Diesel refuel"))
    return Scenario(id="random", name="Randomised training disaster", description="",
                    supply_events=events, demand_events=demand, refuel_events=refuels,
                    noise_mw=rng.uniform(1.0, 3.0), seed=rng.randint(0, 10**6))
