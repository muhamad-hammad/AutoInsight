import json
from pathlib import Path
import pandas as pd

DATA_DIR = Path("data")
dataset_id = "test-debug-utf16"
dataset_dir = DATA_DIR / dataset_id
dataset_dir.mkdir(parents=True, exist_ok=True)

raw_path = dataset_dir / "raw.csv"
# Create UTF-16 LE with BOM
contents = b"\xff\xfe" + "a,b,c\n1,2,3".encode("utf-16-le")
raw_path.write_bytes(contents)

print("Starting pd.read_csv (UTF-16)...")
try:
    df_empty = pd.read_csv(raw_path, nrows=0)
    print("pd.read_csv success")
    print(f"Columns: {df_empty.columns.tolist()}")
    schema = {col: str(dtype) for col, dtype in df_empty.dtypes.items()}
    spec_path = dataset_dir / "spec.json"
    spec_path.write_text(json.dumps(schema, indent=2))
    print("spec.json success")
except Exception as e:
    print(f"Error: {e}")
