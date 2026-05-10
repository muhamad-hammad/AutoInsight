"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DataProfile, FeatureStat } from "@/lib/types";

interface Props {
  profile: DataProfile;
  onSelectTarget?: (col: string) => void;
}

function approxHistogram(stat: FeatureStat, bins = 10) {
  const { mean, variance, min_val, max_val } = stat;
  if (mean == null || variance == null || min_val == null || max_val == null) return [];
  const std = Math.sqrt(Math.max(variance, 1e-9));
  const range = max_val - min_val;
  if (range === 0) return [];
  const binW = range / bins;
  return Array.from({ length: bins }, (_, i) => {
    const center = min_val + (i + 0.5) * binW;
    const z = (center - mean) / std;
    const density = Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
    return { bin: center.toFixed(2), freq: +(density * binW).toFixed(4) };
  });
}

const RED_STEPS = [
  "bg-red-50","bg-red-100","bg-red-200","bg-red-300","bg-red-400",
  "bg-red-500","bg-red-600","bg-red-700","bg-red-800","bg-red-900",
];
const BLUE_STEPS = [
  "bg-blue-50","bg-blue-100","bg-blue-200","bg-blue-300","bg-blue-400",
  "bg-blue-500","bg-blue-600","bg-blue-700","bg-blue-800","bg-blue-900",
];

function correlationClass(r: number): string {
  const idx = Math.min(9, Math.round(Math.abs(r) * 9));
  if (r > 0.05) return RED_STEPS[idx];
  if (r < -0.05) return BLUE_STEPS[idx];
  return "bg-gray-100";
}

export default function ProfileCharts({ profile, onSelectTarget }: Props) {
  const numericFeatures = profile.features.filter((f) => f.dtype === "float32");
  const corrKeys = Object.keys(profile.correlation_matrix);

  return (
    <div className="space-y-4">
      {/* Null heatmap */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Null rates</h3>
        <div className="flex flex-wrap gap-2">
          {profile.features.map((f) => {
            const pct = f.null_pct;
            const bg =
              pct === 0
                ? "bg-green-100 text-green-700"
                : pct < 5
                ? "bg-yellow-100 text-yellow-700"
                : "bg-red-100 text-red-700";
            return (
              <div
                key={f.name}
                title={`${f.name}: ${pct.toFixed(1)}% null`}
                className={`rounded px-2 py-1 text-xs font-medium cursor-pointer ${bg}`}
                onClick={() => onSelectTarget?.(f.name)}
              >
                {f.name}
                <span className="ml-1 opacity-70">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Histograms */}
      {numericFeatures.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Distributions (numeric features)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {numericFeatures.map((f) => {
              const data = approxHistogram(f);
              if (data.length === 0) return null;
              return (
                <div key={f.name} className="bg-white rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-medium text-gray-600 mb-2">{f.name}</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="bin" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{ fontSize: 11 }}
                        formatter={(v) => [typeof v === "number" ? v.toFixed(4) : v, "density"]}
                      />
                      <Bar dataKey="freq" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Correlation matrix */}
      {corrKeys.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Correlation matrix</h3>
          <div className="overflow-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="w-20" aria-label="Feature" />
                  {corrKeys.map((col) => (
                    <th
                      key={col}
                      className="px-1 py-0.5 text-center text-gray-500 font-medium max-w-16 truncate"
                      title={col}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrKeys.map((row) => (
                  <tr key={row}>
                    <td
                      className="pr-2 py-0.5 text-right text-gray-500 font-medium truncate max-w-20"
                      title={row}
                    >
                      {row}
                    </td>
                    {corrKeys.map((col) => {
                      const r = profile.correlation_matrix[row]?.[col] ?? 0;
                      return (
                        <td
                          key={col}
                          title={`${row} × ${col}: ${r.toFixed(3)}`}
                          className={`w-10 h-8 text-center ${correlationClass(r)}`}
                        >
                          <span className="text-gray-800">{r.toFixed(2)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Red = positive correlation · Blue = negative correlation
          </p>
        </section>
      )}

      {/* Narrative */}
      {profile.narrative && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">AI Insight</h3>
          <p className="text-sm text-gray-600 leading-relaxed bg-blue-50 rounded-lg p-4">
            {profile.narrative}
          </p>
        </section>
      )}
    </div>
  );
}
