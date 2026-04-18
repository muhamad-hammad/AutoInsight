from __future__ import annotations

import json
from pathlib import Path

import tensorflow as tf

DATA_DIR = Path("data")


def save_dataset(ds: tf.data.Dataset, path: str | Path) -> None:
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)

    tfrecord_path = str(path / "dataset.tfrecord")
    ds.save(tfrecord_path)

    spec = ds.element_spec
    spec_json = _spec_to_json(spec)
    (path / "element_spec.json").write_text(json.dumps(spec_json, indent=2))


def load_dataset(dataset_id: str) -> tf.data.Dataset:
    path = DATA_DIR / dataset_id
    tfrecord_path = str(path / "dataset.tfrecord")
    spec_json = json.loads((path / "element_spec.json").read_text())

    saved_spec = _json_to_spec(spec_json)
    ds = tf.data.Dataset.load(tfrecord_path, element_spec=saved_spec)

    reconstructed_spec = ds.element_spec
    assert _spec_to_json(reconstructed_spec) == spec_json, (
        f"element_spec mismatch after load:\n"
        f"  saved:         {spec_json}\n"
        f"  reconstructed: {_spec_to_json(reconstructed_spec)}"
    )
    return ds


# ── spec serialisation helpers ────────────────────────────────────────────────

def _spec_to_json(spec) -> dict | list:
    if isinstance(spec, dict):
        return {k: _spec_to_json(v) for k, v in spec.items()}
    if isinstance(spec, (list, tuple)):
        return [_spec_to_json(s) for s in spec]
    if isinstance(spec, tf.TensorSpec):
        return {
            "__type__": "TensorSpec",
            "shape": spec.shape.as_list(),
            "dtype": spec.dtype.name,
            "name": spec.name,
        }
    raise TypeError(f"Unsupported spec type: {type(spec)}")


def _json_to_spec(obj: dict | list) -> tf.TensorSpec | dict | list:
    if isinstance(obj, list):
        return [_json_to_spec(v) for v in obj]
    if isinstance(obj, dict):
        if obj.get("__type__") == "TensorSpec":
            return tf.TensorSpec(
                shape=obj["shape"],
                dtype=tf.as_dtype(obj["dtype"]),
                name=obj.get("name"),
            )
        return {k: _json_to_spec(v) for k, v in obj.items()}
    raise TypeError(f"Unexpected JSON node: {type(obj)}")
