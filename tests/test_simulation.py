"""End-to-end tests: every scenario under every policy keeps the hard guarantees."""
import random
import unittest

from omnigrid.agents import QTeam
from omnigrid.config import EPISODE_TICKS, UTILITIES, UTILITY_IDS
from omnigrid.damage import assess
from omnigrid.scenario import SCENARIOS, get_scenario, random_scenario
from omnigrid.simulation import POLICIES, Simulation, jain
from omnigrid.utility import UtilityState


class SimulationTests(unittest.TestCase):
    def test_all_policies_respect_capacity_and_commit_every_tick(self):
        for sid in SCENARIOS:
            for policy in POLICIES:
                with self.subTest(scenario=sid, policy=policy):
                    sim = Simulation(get_scenario(sid), policy, team=QTeam(UTILITY_IDS))
                    ticks = sim.run()
                    self.assertEqual(len(ticks), EPISODE_TICKS)
                    self.assertEqual(len(sim.ledger.commits), EPISODE_TICKS)
                    self.assertEqual(sim.summary().capacity_violations, 0)
                    for t in ticks:
                        self.assertLessEqual(t["allocated"], t["supply"] + 1e-3)

    def test_harness_beats_baselines_on_named_scenarios(self):
        for sid in SCENARIOS:
            damage = {}
            for policy in ("harness_rules", "static_priority", "uncoordinated"):
                sim = Simulation(get_scenario(sid), policy, narrate=False)
                sim.run()
                damage[policy] = sim.total_damage
            self.assertLess(damage["harness_rules"], damage["static_priority"], sid)
            self.assertLess(damage["harness_rules"], damage["uncoordinated"], sid)

    def test_negotiation_terminates_within_bound_every_tick(self):
        sim = Simulation(get_scenario("grid_collapse"), "harness_rules")
        for t in sim.run():
            self.assertLessEqual(len(t["rounds"]), 3)
            self.assertTrue(t["safe_state"])

    def test_learning_updates_q_table_and_episode_count(self):
        team = QTeam(UTILITY_IDS)
        sim = Simulation(random_scenario(random.Random(3)), "harness_rl", team=team, learn=True,
                         narrate=False)
        sim.run()
        self.assertEqual(team.episodes, 1)
        self.assertGreater(team.state_count(), 0)

    def test_scenarios_are_deterministic(self):
        a = get_scenario("monsoon_flood")
        b = get_scenario("monsoon_flood")
        self.assertEqual([a.supply_at(t) for t in range(EPISODE_TICKS)],
                         [b.supply_at(t) for t in range(EPISODE_TICKS)])


class ModelTests(unittest.TestCase):
    def test_buffer_covers_critical_deficit_and_drains(self):
        spec = next(u for u in UTILITIES if u.id == "telecom")
        state = UtilityState(spec)
        need = state.need()
        start = state.buffer
        outcome = state.apply(need.critical - 2.0, need)
        self.assertAlmostEqual(outcome.discharged, 2.0)
        self.assertEqual(outcome.status, "buffer")
        self.assertLess(state.buffer, start)

    def test_dependency_outage_cascades(self):
        states = {u.id: UtilityState(u) for u in UTILITIES}
        outcomes = {}
        for uid, s in states.items():
            n = s.need()
            outcomes[uid] = s.apply(0.0 if uid == "telecom" else n.full, n)
        # Telecom has a large battery, so drain it to force an outage.
        states["telecom"].buffer = 0.0
        n = states["telecom"].need()
        outcomes["telecom"] = states["telecom"].apply(0.0, n)
        report = assess(outcomes, {uid: s.dark_streak for uid, s in states.items()})
        self.assertIn("telecom", report.down)
        self.assertIn(("telecom", "dispatch_hq"), report.cascades)
        self.assertLess(report.effectiveness["dispatch_hq"], 1.0)

    def test_jain_index(self):
        self.assertAlmostEqual(jain([1, 1, 1]), 1.0)
        self.assertAlmostEqual(jain([1, 0, 0]), 1 / 3)


if __name__ == "__main__":
    unittest.main()
