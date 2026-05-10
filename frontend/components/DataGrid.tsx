"use client";

import { useEffect, useState, useMemo } from "react";

interface Props {
  datasetId: string;
}

type Row = Record<string, string | number | null>;
type SortDir = "asc" | "desc";

export default function DataGrid({ datasetId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/preview/${datasetId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Preview failed (${r.status})`);
        return r.json() as Promise<Row[]>;
      })
      .then((data) => setRows(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [datasetId]);

  const columns = useMemo(
    () => (rows.length > 0 ? Object.keys(rows[0]) : []),
    [rows]
  );

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading preview…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (rows.length === 0) return <p className="text-sm text-gray-400">No data.</p>;

  return (
    <div data-testid="data-grid" className="w-full overflow-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                onClick={() => handleSort(col)}
                className="px-3 py-2 text-left font-medium text-gray-600 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100"
              >
                {col}
                {sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              {columns.map((col) => {
                const val = row[col];
                const isNull = val === null || val === undefined;
                return (
                  <td
                    key={col}
                    className={[
                      "px-3 py-1.5 whitespace-nowrap",
                      isNull ? "bg-amber-50 text-amber-400 italic" : "text-gray-700",
                    ].join(" ")}
                  >
                    {isNull ? "null" : String(val)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
