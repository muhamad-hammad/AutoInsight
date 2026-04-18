"""Round-trip test: save_dataset → load_dataset preserves element_spec."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import tensorflow as tf

from backend.pipeline.store import _spec_to_json, save_dataset, load_dataset, DATA_DIR


def _make_simple_ds() -> tf.data.Dataset:
    data = {"age": tf.constant([1.0, 2.0, 3.0]), "city": tf.constant([0, 1, 2])}
    return tf.data.Dataset.from_tensor_slices(data)


def test_element_spec_roundtrip(tmp_path: Path) -> None:
    ds = _make_simple_ds()
    dataset_id = "test-roundtrip"
    save_path = tmp_path / dataset_id

    save_dataset(ds, save_path)

    # Patch DATA_DIR so load_dataset resolves to tmp_path
    with patch("backend.pipeline.store.DATA_DIR", tmp_path):
        ds_loaded = load_dataset(dataset_id)

    assert _spec_to_json(ds_loaded.element_spec) == _spec_to_json(ds.element_spec)


def test_spec_serialisation_symmetric() -> None:
    ds = _make_simple_ds()
    spec = ds.element_spec
    serialised = _spec_to_json(spec)
    assert json.dumps(serialised)  # must be JSON-serialisable
    from backend.pipeline.store import _json_to_spec
    restored = _json_to_spec(serialised)
    assert _spec_to_json(restored) == serialised
