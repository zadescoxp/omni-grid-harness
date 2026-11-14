"""Unit tests for the negotiation protocol, safety layer and ledger invariants."""
import random
import unittest

from omnigrid.agents import HeuristicAgent
from omnigrid.config import NEGOTIATION_ROUNDS, UTILITIES, UTILITY_BY_ID, UTILITY_IDS
from omnigrid.ledger import InvariantViolation, Ledger
from omnigrid.protocol import (Action, check_safe, effective_priority, negotiate, priority_allocate,
                               weighted_fill)
from omnigrid.utility import Need, UtilityState


def needs_at(mult: float = 1.0) -> dict[str, Need]:
    return {u.id: UtilityState(u).need(mult, mult) for u in UTILITIES}


def context(credit: int = 0, buffer_fraction: float = 1.0) -> dict[str, dict]:
    return {u.id: {"buffer_fraction": buffer_fraction, "has_buffer": u.buffer_capacity > 0,
                   "starvation_credit": credit, "upstream_down": False} for u in UTILITIES}


class AlwaysFull:
    def act(self, obs):
        return Action.FULL


class RandomAgent:
    def __init__(self, seed):
        self.rng = random.Random(seed)

    def act(self, obs):
        return Action(self.rng.randrange(4))


class ProtocolTests(unittest.TestCase):
    def test_never_exceeds_capacity_for_any_supply_and_any_agent_behaviour(self):
        rng = random.Random(1)
        for i in range(400):
            supply = rng.uniform(0, 110)
            needs = needs_at(rng.uniform(0.8, 1.6))
            agents = {uid: RandomAgent(i * 10 + k) for k, uid in enumerate(UTILITY_IDS)}
            result = negotiate(i, supply, needs, agents, context(rng.randint(0, 6), rng.random()))
            self.assertLessEqual(sum(result.allocation.values()), supply + 1e-6)
            for uid, mw in result.allocation.items():
                self.assertGreaterEqual(mw, 0.0)
                self.assertLessEqual(mw, needs[uid].full + 1e-6)

    def test_negotiation_is_bounded(self):
        agents = {uid: AlwaysFull() for uid in UTILITY_IDS}
        result = negotiate(0, 20.0, needs_at(), agents, context())
        self.assertLessEqual(len(result.rounds), NEGOTIATION_ROUNDS)
        self.assertTrue(result.fallback_used)
        self.assertAlmostEqual(sum(result.allocation.values()), 20.0, places=4)

    def test_bids_are_monotonic_within_a_tick(self):
        agents = {uid: RandomAgent(k) for k, uid in enumerate(UTILITY_IDS)}
        result = negotiate(0, 30.0, needs_at(), agents, context())
        for prev, cur in zip(result.rounds, result.rounds[1:]):
            for uid in UTILITY_IDS:
                self.assertLessEqual(cur.bids[uid], prev.bids[uid] + 1e-9)

    def test_ample_supply_grants_everyone_full_load(self):
        needs = needs_at()
        agents = {uid: HeuristicAgent() for uid in UTILITY_IDS}
        result = negotiate(0, 200.0, needs, agents, context())
        self.assertTrue(result.agreed)
        for uid in UTILITY_IDS:
            self.assertAlmostEqual(result.allocation[uid], needs[uid].full, places=4)

    def test_leftover_supply_is_not_wasted(self):
        needs = needs_at()
        agents = {uid: HeuristicAgent() for uid in UTILITY_IDS}
        supply = 70.0
        result = negotiate(0, supply, needs, agents, context())
        self.assertAlmostEqual(sum(result.allocation.values()), supply, places=3)

    def test_safety_layer_protects_life_critical_loads(self):
        needs = needs_at()
        # Greedy non-hospitals and hospitals with empty generators: the safe state must still hold.
        for uid in UTILITY_IDS:
            if UTILITY_BY_ID[uid].life_critical:
                n = needs[uid]
                needs[uid] = Need(n.critical, n.essential, n.deferrable, 0.0)
        agents = {uid: AlwaysFull() for uid in UTILITY_IDS}
        result = negotiate(0, 30.0, needs, agents, context())
        ok, reason = check_safe(result.allocation, needs)
        self.assertTrue(ok, reason)
        for uid in ("victoria_hospital", "bowring_hospital"):
            self.assertAlmostEqual(result.allocation[uid], needs[uid].critical, places=4)

    def test_check_safe_rejects_unsafe_allocation(self):
        needs = needs_at()
        n = needs["victoria_hospital"]
        needs["victoria_hospital"] = Need(n.critical, n.essential, n.deferrable, 0.0)
        alloc = {uid: needs[uid].full for uid in UTILITY_IDS}
        alloc["victoria_hospital"] = 0.0
        ok, _ = check_safe(alloc, needs)
        self.assertFalse(ok)

    def test_aging_raises_priority(self):
        self.assertGreater(effective_priority("sewage_lift", 5), effective_priority("sewage_lift", 0))

    def test_priority_allocate_gives_critical_floors_first(self):
        needs = needs_at()
        bids = {uid: n.full for uid, n in needs.items()}
        priority = {uid: effective_priority(uid, 0) for uid in UTILITY_IDS}
        total_critical = sum(n.critical for n in needs.values())
        alloc = priority_allocate(total_critical, needs, bids, priority)
        for uid in UTILITY_IDS:
            self.assertAlmostEqual(alloc[uid], needs[uid].critical, places=4)

    def test_weighted_fill_respects_caps_and_budget(self):
        grant = weighted_fill({"a": 2.0, "b": 10.0}, 6.0, {"a": 1.0, "b": 1.0})
        self.assertAlmostEqual(grant["a"], 2.0)
        self.assertAlmostEqual(grant["b"], 4.0)


class LedgerTests(unittest.TestCase):
    def test_commit_is_atomic_and_rejects_overallocation(self):
        ledger = Ledger(UTILITY_IDS)
        needs = needs_at()
        alloc = {uid: needs[uid].full for uid in UTILITY_IDS}
        with self.assertRaises(InvariantViolation):
            ledger.commit(0, 10.0, alloc, needs)
        self.assertEqual(ledger.commits, [])
        self.assertEqual(ledger.rejected, 1)

    def test_rejects_double_commit_and_missing_holders(self):
        ledger = Ledger(UTILITY_IDS)
        needs = needs_at()
        alloc = {uid: 0.0 for uid in UTILITY_IDS}
        ledger.commit(0, 50.0, alloc, needs)
        with self.assertRaises(InvariantViolation):
            ledger.commit(0, 50.0, alloc, needs)
        partial = dict(alloc)
        partial.pop("telecom")
        with self.assertRaises(InvariantViolation):
            ledger.commit(1, 50.0, partial, needs)

    def test_leases_expire_after_one_tick(self):
        ledger = Ledger(UTILITY_IDS)
        needs = needs_at()
        ledger.commit(0, 50.0, {uid: 1.0 for uid in UTILITY_IDS}, needs)
        self.assertEqual(len(ledger.active_leases(0)), len(UTILITY_IDS))
        self.assertEqual(ledger.active_leases(1), ())


if __name__ == "__main__":
    unittest.main()
