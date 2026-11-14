"""Static configuration: time constants, the seven Bengaluru utility agents, and their dependencies.

Power figures are in MW, buffer energy in MWh. Facility locations are approximate
neighbourhood coordinates in Bengaluru used for the simulation map; the facilities
themselves are simulated and do not model real plant data.
"""
from __future__ import annotations

from dataclasses import dataclass

# ---- Time ----------------------------------------------------------------------------
TICK_MINUTES = 15
TICK_HOURS = TICK_MINUTES / 60.0
TICKS_PER_HOUR = 60 // TICK_MINUTES
EPISODE_HOURS = 24
EPISODE_TICKS = EPISODE_HOURS * TICKS_PER_HOUR

# ---- Negotiation ---------------------------------------------------------------------
NEGOTIATION_ROUNDS = 3          # bounded rounds per tick -> guaranteed termination
AGING_STEP = 0.6                # priority gained per unit of starvation credit
MAX_STARVATION_CREDIT = 6
EPS = 1e-6

# ---- Damage model --------------------------------------------------------------------
CRITICAL_GAP_WEIGHT = 4.0       # harm multiplier for unmet critical load
ESSENTIAL_GAP_WEIGHT = 1.0      # harm multiplier for unmet essential load
DURATION_STEP = 0.1             # extra harm per consecutive tick below critical
DURATION_CAP = 3.0
DEPENDENCY_PENALTY = 0.4        # effectiveness lost per failed upstream dependency
DOWN_THRESHOLD = 0.5            # below this share of critical load a utility counts as "down"
RECHARGE_EFFICIENCY = 0.9


@dataclass(frozen=True)
class UtilitySpec:
    id: str
    name: str
    kind: str                   # hospital | water | emergency | telecom
    area: str
    lng: float
    lat: float
    critical: float             # MW needed to avoid severe harm
    essential: float            # MW on top of critical for normal operation
    deferrable: float           # MW that can wait (for rechargeable buffers: charging)
    buffer_capacity: float      # MWh of backup (diesel, tank, battery, UPS)
    buffer_max_rate: float      # MW the backup can deliver at most
    rechargeable: bool          # whether surplus grid power refills the buffer
    weight: float               # damage weight (how much harm per unit shortfall)
    base_priority: float
    life_critical: bool         # protected by the safety layer's safe-state check
    buffer_label: str

    @property
    def full(self) -> float:
        return self.critical + self.essential + self.deferrable


UTILITIES: tuple[UtilitySpec, ...] = (
    UtilitySpec("victoria_hospital", "Victoria Hospital", "hospital", "K.R. Market",
                77.5733, 12.9636, 12.0, 8.0, 5.0, 24.0, 9.0, False, 10.0, 10.0, True,
                "diesel generator"),
    UtilitySpec("bowring_hospital", "Bowring Hospital", "hospital", "Shivajinagar",
                77.6047, 12.9829, 6.0, 4.0, 2.0, 6.0, 4.5, False, 8.0, 9.0, True,
                "diesel generator"),
    UtilitySpec("water_main", "Malleshwaram Pumping Station", "water", "Malleshwaram",
                77.5712, 12.9988, 10.0, 6.0, 6.0, 30.0, 8.0, True, 5.0, 6.0, False,
                "reservoir tank"),
    UtilitySpec("sewage_lift", "Shanthinagar Lift Station", "water", "Shanthinagar",
                77.5995, 12.9562, 4.0, 2.0, 2.0, 6.0, 3.0, True, 3.0, 4.0, False,
                "sump capacity"),
    UtilitySpec("dispatch_hq", "Emergency Command Centre", "emergency", "Ambedkar Veedhi",
                77.5907, 12.9794, 4.0, 2.0, 1.0, 2.0, 4.0, True, 6.0, 8.0, False,
                "UPS bank"),
    UtilitySpec("fire_station", "Halasuru Fire Station", "emergency", "Halasuru",
                77.6236, 12.9817, 2.0, 2.0, 1.0, 0.0, 0.0, False, 5.0, 7.0, False,
                "none"),
    UtilitySpec("telecom", "MG Road Telecom Exchange", "telecom", "MG Road",
                77.6066, 12.9755, 6.0, 3.0, 2.0, 24.0, 5.0, True, 7.0, 7.5, False,
                "battery bank"),
)

UTILITY_BY_ID: dict[str, UtilitySpec] = {u.id: u for u in UTILITIES}
UTILITY_IDS: tuple[str, ...] = tuple(u.id for u in UTILITIES)

# Upstream services each utility relies on. A "down" upstream utility cuts the
# dependent's effectiveness by DEPENDENCY_PENALTY even if the dependent has power.
DEPENDENCIES: dict[str, tuple[str, ...]] = {
    "victoria_hospital": ("water_main", "dispatch_hq"),
    "bowring_hospital": ("water_main", "dispatch_hq"),
    "dispatch_hq": ("telecom",),
    "fire_station": ("telecom", "water_main"),
    "sewage_lift": (),
    "water_main": ("telecom",),
    "telecom": (),
}

SUBSTATION = {"id": "substation", "name": "Grid Substation", "area": "Seshadripuram",
              "lng": 77.5795, "lat": 12.9870}

# Compact names for map labels, where space between the side panels is tight.
SHORT_NAMES = {
    "victoria_hospital": "Victoria Hospital",
    "bowring_hospital": "Bowring Hospital",
    "water_main": "Malleshwaram Pumps",
    "sewage_lift": "Shanthinagar Lift",
    "dispatch_hq": "Command Centre",
    "fire_station": "Halasuru Fire",
    "telecom": "MG Rd Exchange",
}

KIND_ICONS = {"hospital": "🏥", "water": "💧", "emergency": "🚒", "telecom": "📡"}
