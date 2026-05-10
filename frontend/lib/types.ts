export interface FeatureStat {
  name: string;
  dtype: string;
  mean?: number | null;
  variance?: number | null;
  min_val?: number | null;
  max_val?: number | null;
  null_count: number;
  null_pct: number;
  cardinality?: number | null;
  high_correlation: string[];
}

export interface DataProfile {
  dataset_id: string;
  row_count: number;
  feature_count: number;
  features: FeatureStat[];
  correlation_matrix: Record<string, Record<string, number>>;
  narrative: string;
  computed_at: string;
}

export interface ModelRoadmap {
  rank: number;
  model_type: string;
  architecture_summary: string;
  keras_layers: string[];
  confidence: number;
  rationale: string;
  keras_snippet: string;
  target_type: string;
}
