from __future__ import annotations

import csv
import random

import pytest


def _write_csv(path, fieldnames: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


@pytest.fixture
def small_csv(tmp_path):
    """1 000 rows: numeric (age, score, income), categorical (city), target (label)."""
    path = tmp_path / "small.csv"
    rng = random.Random(42)
    cities = ["London", "Paris", "Berlin", "Madrid", "Rome"]
    rows = [
        {
            "age": round(rng.uniform(18, 80), 2),
            "score": round(rng.uniform(0, 100), 2),
            "income": round(rng.uniform(20_000, 120_000), 2),
            "city": rng.choice(cities),
            "label": round(rng.uniform(0, 1), 4),
        }
        for _ in range(1_000)
    ]
    _write_csv(path, ["age", "score", "income", "city", "label"], rows)
    return path


@pytest.fixture
def medium_csv(tmp_path):
    """100 000 rows, same schema as small_csv."""
    path = tmp_path / "medium.csv"
    rng = random.Random(7)
    cities = ["London", "Paris", "Berlin", "Madrid", "Rome"]
    rows = [
        {
            "age": round(rng.uniform(18, 80), 2),
            "score": round(rng.uniform(0, 100), 2),
            "income": round(rng.uniform(20_000, 120_000), 2),
            "city": rng.choice(cities),
            "label": round(rng.uniform(0, 1), 4),
        }
        for _ in range(100_000)
    ]
    _write_csv(path, ["age", "score", "income", "city", "label"], rows)
    return path


@pytest.fixture
def all_null_col_csv(tmp_path):
    """200 rows where the 'broken' column is entirely empty (becomes NaN on read)."""
    path = tmp_path / "null_col.csv"
    rows = [
        {"value": round(i * 0.1, 4), "broken": "", "label": float(i % 2)}
        for i in range(200)
    ]
    _write_csv(path, ["value", "broken", "label"], rows)
    return path


@pytest.fixture
def cat_only_csv(tmp_path):
    """300 rows where every column is categorical (string)."""
    path = tmp_path / "cat_only.csv"
    options = {
        "country": ["US", "UK", "DE", "FR"],
        "product": ["A", "B", "C"],
        "status": ["active", "inactive"],
        "label": ["yes", "no"],
    }
    rng = random.Random(99)
    rows = [
        {col: rng.choice(vals) for col, vals in options.items()}
        for _ in range(300)
    ]
    _write_csv(path, list(options.keys()), rows)
    return path


@pytest.fixture
def fixture_50mb_csv(tmp_path):
    """~50 MB CSV streamed to disk — never held in RAM at once."""
    path = tmp_path / "big.csv"
    target_bytes = 50 * 1024 * 1024
    cats = ["alpha", "beta", "gamma", "delta"]
    with open(path, "w") as fh:
        fh.write("a,b,c,cat,label\n")
        written = 17  # len("a,b,c,cat,label\n")
        i = 0
        while written < target_bytes:
            row = (
                f"{i * 0.001:.6f},{i * 0.002:.6f},{i * 0.003:.6f},"
                f"{cats[i % 4]},{i % 2}\n"
            )
            fh.write(row)
            written += len(row)
            i += 1
    return path
