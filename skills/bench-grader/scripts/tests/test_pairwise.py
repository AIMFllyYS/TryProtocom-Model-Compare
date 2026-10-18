import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from benchlib.pairwise import bradley_terry, to_scale  # noqa: E402


def test_strength_follows_wins():
    comps = [("a", "b", 1), ("a", "c", 1), ("b", "c", 1), ("a", "b", 1), ("b", "c", 0.5)]
    s = bradley_terry(comps)
    assert s["a"] > s["b"] > s["c"]
    assert abs(sum(s.values())) < 1e-6


def test_all_ties_gives_equal_scores():
    s = to_scale(bradley_terry([("a", "b", 0.5), ("b", "c", 0.5), ("a", "c", 0.5)]))
    assert set(s.values()) == {1.5}


def test_scale_is_0_to_3_and_monotonic():
    s = to_scale(bradley_terry([("x", "y", 1), ("y", "z", 1), ("x", "z", 1)]))
    assert s["x"] == 3.0 and s["z"] == 0.0 and 0 < s["y"] < 3


def test_unbeaten_does_not_diverge():
    s = bradley_terry([("a", "b", 1)] * 5)
    assert abs(s["a"]) < 5 and s["a"] > s["b"]
