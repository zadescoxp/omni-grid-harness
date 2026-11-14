"""Tabular Q-learning negotiating agent.

Each utility has its own Q-table over a small discretised observation, so the agents stay
decentralised: no agent sees another's private state. Rewards are mostly shared (city-wide
damage) with a smaller individual term, which teaches cooperation instead of greedy bidding.
Unvisited states fall back to the heuristic policy's choice, so an untrained agent never
behaves worse than the rule-based one when exploiting.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from ..protocol import Action, Observation
from .heuristic import HeuristicAgent

N_ACTIONS = len(Action)


def _bucket(value: float, edges: tuple[float, ...]) -> int:
    for i, edge in enumerate(edges):
        if value < edge:
            return i
    return len(edges)


def encode(obs: Observation) -> str:
    supply = _bucket(obs.supply_ratio, (0.5, 0.65, 0.8, 1.0))
    shortfall = 0 if obs.shortfall_ratio <= 0 else 1 + _bucket(obs.shortfall_ratio, (0.15, 0.35))
    buffer = 0 if not obs.has_buffer else 1 + _bucket(obs.buffer_fraction, (0.25, 0.6))
    credit = _bucket(obs.starvation_credit, (1, 3))
    crisis = 1 if obs.critical_ratio > 1.0 else 0
    return f"{obs.round}|{supply}|{shortfall}|{buffer}|{credit}|{crisis}|{int(obs.upstream_down)}"


class QLearningAgent:
    name = "rl"

    def __init__(self, uid: str, alpha: float = 0.1, gamma: float = 0.95, epsilon: float = 0.1,
                 seed: int = 0):
        self.uid = uid
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon
        self.learning = False
        self.q: dict[str, list[float]] = {}
        self.visits: dict[str, int] = {}
        self._prior = HeuristicAgent()
        self._rng = random.Random(seed)
        self._pending: tuple[str, int] | None = None
        self._pending_reward = 0.0

    # ---- acting ----
    def greedy(self, obs: Observation, key: str) -> Action:
        prior = self._prior.act(obs)
        values = self.q.get(key)
        if values is None:
            return prior
        best = max(values)
        # Ties (including unexplored actions at 0) resolve toward the heuristic prior.
        if abs(values[prior] - best) < 1e-9:
            return prior
        return Action(values.index(best))

    def act(self, obs: Observation) -> Action:
        key = encode(obs)
        if self.learning and self._rng.random() < self.epsilon:
            action = Action(self._rng.randrange(N_ACTIONS))
        else:
            action = self.greedy(obs, key)
        if self.learning:
            if self._pending is not None:
                self._update(self._pending, self._pending_reward, key)
            self._pending = (key, int(action))
            self._pending_reward = 0.0
        return action

    # ---- learning ----
    def reward(self, r: float) -> None:
        if self.learning and self._pending is not None:
            self._pending_reward += r

    def end_episode(self) -> None:
        if self.learning and self._pending is not None:
            self._update(self._pending, self._pending_reward, None)
        self._pending = None
        self._pending_reward = 0.0

    def _update(self, pending: tuple[str, int], r: float, next_key: str | None) -> None:
        key, action = pending
        values = self.q.setdefault(key, [0.0] * N_ACTIONS)
        self.visits[key] = self.visits.get(key, 0) + 1
        target = r
        if next_key is not None:
            nxt = self.q.get(next_key)
            target += self.gamma * (max(nxt) if nxt else 0.0)
        values[action] += self.alpha * (target - values[action])

    # ---- persistence ----
    def to_dict(self) -> dict:
        return {"q": self.q, "visits": self.visits}

    def load_dict(self, data: dict) -> None:
        self.q = {k: list(v) for k, v in data.get("q", {}).items()}
        self.visits = dict(data.get("visits", {}))


class QTeam:
    """The seven Q-learning agents plus shared training metadata, saved as one JSON file."""

    def __init__(self, uids, seed: int = 0):
        self.agents = {uid: QLearningAgent(uid, seed=seed + i) for i, uid in enumerate(uids)}
        self.episodes = 0

    def set_learning(self, learning: bool, epsilon: float | None = None) -> None:
        for agent in self.agents.values():
            agent.learning = learning
            if epsilon is not None:
                agent.epsilon = epsilon

    def end_episode(self) -> None:
        for agent in self.agents.values():
            agent.end_episode()

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"episodes": self.episodes,
                "agents": {uid: a.to_dict() for uid, a in self.agents.items()}}
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")))
        tmp.replace(path)

    def load(self, path: Path) -> bool:
        if not path.exists():
            return False
        data = json.loads(path.read_text())
        self.episodes = int(data.get("episodes", 0))
        for uid, blob in data.get("agents", {}).items():
            if uid in self.agents:
                self.agents[uid].load_dict(blob)
        return True

    def state_count(self) -> int:
        return sum(len(a.q) for a in self.agents.values())
