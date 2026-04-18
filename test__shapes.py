import sys
sys.path.append('.')
import tensorflow as tf
from backend.pipeline.ingest import build_dataset

schema = {
    "age": "float64",
    "city": "object"
}

import pandas as pd
df = pd.DataFrame({"age": [20.5, 30.1, 40.0], "city": ["SF", "NY", "SF"]})
import os
os.makedirs("data", exist_ok=True)
df.to_csv("data/debug.csv", index=False)

ds = build_dataset("data/debug.csv", schema)
print("SPEC:", ds.element_spec)

for x in ds.take(1):
    print("X['age'] shape:", x['age'].shape)
    print("X['city'] shape:", x['city'].shape)
