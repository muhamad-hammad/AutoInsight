from pydantic import BaseModel


class DataSchema(BaseModel):
    dataset_id: str
    schema: dict[str, str]
