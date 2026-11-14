"""Turns each tick's negotiation and outcomes into plain-English log lines for the live feed."""
from __future__ import annotations

from .config import KIND_ICONS, UTILITY_BY_ID
from .protocol import Action, NegotiationResult
from .utility import Need, ServiceOutcome


def _n(uid: str) -> str:
    return UTILITY_BY_ID[uid].name


def _icon(uid: str) -> str:
    return KIND_ICONS[UTILITY_BY_ID[uid].kind]


class Narrator:
    def __init__(self) -> None:
        self.prev_status: dict[str, str] = {}
        self.prev_actions: dict[str, int] = {}
        self.prev_cascades: set[tuple[str, str]] = set()
        self.prev_credit: dict[str, int] = {}
        self.prev_mode: str | None = None

    def tick(self, *, time: str, supply: float, prev_supply: float | None, supply_labels: list[str],
             demand_labels: list[str], ended_labels: list[str], refuel_labels: list[str],
             needs: dict[str, Need], result: NegotiationResult | None, policy: str,
             outcomes: dict[str, ServiceOutcome], buffers: dict[str, float],
             cascades: list[tuple[str, str]], credits: dict[str, int]) -> list[dict]:
        log: list[dict] = []

        def add(kind: str, text: str) -> None:
            log.append({"kind": kind, "time": time, "text": text})

        for label in supply_labels:
            add("event", f"⚡ {label}")
        if not supply_labels and prev_supply is not None and abs(supply - prev_supply) >= 6:
            add("event", f"⚡ Supply swings to {supply:.0f} MW")
        for label in demand_labels:
            add("event", f"🚨 {label}")
        for label in ended_labels:
            add("info", f"↘️ Eased: {label}")
        for label in refuel_labels:
            add("info", f"⛽ {label}")

        total_need = sum(n.full for n in needs.values())
        if result is not None:
            changed = []
            for uid, a in result.final_actions.items():
                if a != Action.FULL and self.prev_actions.get(uid) != a:
                    changed.append(uid)
            for uid in changed[:4]:
                a = Action(result.final_actions[uid])
                bid = result.rounds[-1].bids[uid]
                if a == Action.DRAW_BUFFER:
                    spec = UTILITY_BY_ID[uid]
                    add("negotiation", f"{_icon(uid)} {_n(uid)} draws on its {spec.buffer_label} "
                                       f"({buffers[uid]:.0%} left) and bids only {bid:.1f} MW")
                elif a == Action.CRITICAL:
                    add("negotiation", f"{_icon(uid)} {_n(uid)} concedes to critical load: {bid:.1f} MW")
                elif a == Action.ESSENTIAL:
                    add("negotiation", f"{_icon(uid)} {_n(uid)} sheds deferrable load, bids {bid:.1f} MW")
            back = [uid for uid, a in result.final_actions.items()
                    if a == Action.FULL and self.prev_actions.get(uid, Action.FULL) != Action.FULL]
            if back:
                add("info", "🟢 Back to full requests: " + ", ".join(_n(u) for u in back[:4]))
            self.prev_actions = dict(result.final_actions)

            # Report the negotiation outcome when it changes, not on every tick.
            mode = "ample" if total_need <= supply else ("agreed" if result.agreed else "fallback")
            if mode != self.prev_mode:
                if mode == "agreed":
                    add("agreement", f"✅ Agreement in round {len(result.rounds)}: "
                                     f"{sum(result.allocation.values()):.1f} of {supply:.1f} MW allocated")
                elif mode == "fallback":
                    add("fallback", f"⚖️ Bids still exceed {supply:.1f} MW after {len(result.rounds)} rounds: "
                                    f"priority fallback with aging decides")
                elif self.prev_mode is not None:
                    add("recovery", "🟢 Supply covers every utility's full load again")
            self.prev_mode = mode
            if result.safety_intervened:
                add("safety", f"🛡️ Safety layer blocked an unsafe allocation: {result.safety_reason}")
        elif total_need > supply:
            add("info", f"📋 {policy.replace('_', ' ').title()} allocation: "
                        f"{supply:.1f} MW split without negotiation")

        for uid, o in outcomes.items():
            prev = self.prev_status.get(uid)
            if o.status == prev:
                continue
            if o.status == "dark":
                add("alert", f"🔴 {_n(uid)} below critical load ({o.critical_cover:.0%} covered)")
            elif prev == "dark":
                add("recovery", f"🟢 {_n(uid)} critical load restored")
            elif o.status == "buffer" and prev != "buffer":
                add("info", f"🔋 {_n(uid)} running critical load partly on backup")
        self.prev_status = {uid: o.status for uid, o in outcomes.items()}

        current = set(cascades)
        for up, down in sorted(current - self.prev_cascades):
            add("cascade", f"⛓️ Cascade: {_n(up)} outage is degrading {_n(down)}")
        self.prev_cascades = current

        for uid, c in credits.items():
            if c >= 3 and self.prev_credit.get(uid, 0) < 3:
                add("info", f"⏫ {_n(uid)} has been starved for a while; its priority rises (credit {c})")
        self.prev_credit = dict(credits)
        return log
