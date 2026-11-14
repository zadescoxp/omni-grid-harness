"""Rule-based negotiating agent: the hand-written policy GridPact's RL agents start from and are measured against."""
from __future__ import annotations

from ..protocol import Action, Observation


class HeuristicAgent:
    """Concede in proportion to the shortfall, spend backup buffers when they are healthy,
    and hold the line once starvation credit builds up."""

    name = "heuristic"

    def act(self, obs: Observation) -> Action:
        if obs.shortfall_ratio <= 0:
            return Action.FULL

        starving = obs.starvation_credit >= 3

        if obs.life_critical:
            if obs.round == 0:
                return Action.ESSENTIAL
            # Hospitals spend diesel only in a deep crisis and while the tank is healthy.
            if obs.round >= 2 and obs.critical_ratio > 1.0 and obs.buffer_fraction > 0.5:
                return Action.DRAW_BUFFER
            return Action.CRITICAL

        if obs.has_buffer and obs.buffer_fraction > 0.6 and not starving:
            return Action.DRAW_BUFFER if obs.round >= 1 or obs.shortfall_ratio > 0.3 else Action.CRITICAL
        if obs.round == 0 and obs.shortfall_ratio < 0.15:
            return Action.ESSENTIAL
        if starving and obs.round < 2:
            return Action.ESSENTIAL
        if obs.has_buffer and obs.buffer_fraction > 0.3 and obs.round >= 2:
            return Action.DRAW_BUFFER
        return Action.CRITICAL
