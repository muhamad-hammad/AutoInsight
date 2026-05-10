"use client";

import { useCallback, useState } from "react";

interface UploadedFile {
  file: File;
  progress: number; // 0–100, 100 = done
  error?: string;
  datasetId?: string;
}

interface Props {
  onUploaded: (datasetId: string) => void;
  onClose: () => void;
}

const ACCEPTED = [".csv", ".json"];
const MAX_BYTES = 500 * 1024 * 1024;

export default function UploadDropzone({ onUploaded, onClose }: Props) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const uploadFile = useCallback(
    async (file: File) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!ACCEPTED.includes(ext)) {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === file ? { ...f, error: "Only .csv or .json accepted" } : f
          )
        );
        return;
      }
      if (file.size > MAX_BYTES) {
        setFiles((prev) =>
          prev.map((f) =>
            f.file === file ? { ...f, error: "Exceeds 500 MB limit" } : f
          )
        );
        return;
      }

      // Simulate upload progress via XHR so we get real progress events
      return new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append("file", file);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 90);
            setFiles((prev) =>
              prev.map((f) => (f.file === file ? { ...f, progress: pct } : f))
            );
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const data = JSON.parse(xhr.responseText);
            setFiles((prev) =>
              prev.map((f) =>
                f.file === file
                  ? { ...f, progress: 100, datasetId: data.dataset_id }
                  : f
              )
            );
          } else {
            setFiles((prev) =>
              prev.map((f) =>
                f.file === file
                  ? { ...f, error: `Upload failed (${xhr.status})` }
                  : f
              )
            );
          }
          resolve();
        });

        xhr.addEventListener("error", () => {
          setFiles((prev) =>
            prev.map((f) =>
              f.file === file ? { ...f, error: "Network error" } : f
            )
          );
          resolve();
        });

        xhr.open("POST", "/api/upload");
        xhr.send(form);
      });
    },
    []
  );

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const arr = Array.from(incoming);
      const newEntries: UploadedFile[] = arr.map((f) => ({
        file: f,
        progress: 0,
      }));
      setFiles((prev) => [...prev, ...newEntries]);
      arr.forEach(uploadFile);
    },
    [uploadFile]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  const removeFile = (file: File) =>
    setFiles((prev) => prev.filter((f) => f.file !== file));

  const allDone =
    files.length > 0 && files.every((f) => f.progress === 100 || f.error);

  const handleContinue = () => {
    const first = files.find((f) => f.datasetId);
    if (first?.datasetId) onUploaded(first.datasetId);
  };

  const fmtSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / 1024).toFixed(0) + " KB";
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Modal card */}
      <div className="relative w-full max-w-md rounded-2xl bg-[#1a1a2e] text-white shadow-2xl p-6 space-y-5">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold">Create a new project</h2>
          <p className="text-sm text-gray-400">Drag and drop files to create a new project.</p>
        </div>

        {/* Drop zone */}
        <label
          data-testid="upload-dropzone"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            "flex flex-col items-center justify-center gap-3 w-full rounded-xl border-2 border-dashed cursor-pointer transition-all py-8",
            dragging
              ? "border-violet-400 bg-violet-500/10"
              : "border-gray-600 bg-white/5 hover:border-gray-500 hover:bg-white/[0.07]",
          ].join(" ")}
        >
          <input
            type="file"
            accept=".csv,.json"
            multiple
            className="sr-only"
            onChange={onInputChange}
          />
          {/* Folder icon */}
          <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <p className="text-sm text-gray-300 font-medium">Drag and drop files to upload</p>
          <p className="text-xs text-gray-500">
            or,{" "}
            <span className="underline text-gray-300 cursor-pointer">click to browse</span>
            {" "}(500 MB max)
          </p>
        </label>

        {/* Select files button */}
        <label className="block">
          <input
            type="file"
            accept=".csv,.json"
            multiple
            className="sr-only"
            onChange={onInputChange}
          />
          <span className="flex items-center justify-center w-full rounded-lg border border-gray-600 bg-transparent py-2 text-sm text-gray-300 cursor-pointer hover:bg-white/5 transition-colors">
            Select files
          </span>
        </label>

        {/* File list */}
        {files.length > 0 && (
          <ul className="space-y-2 max-h-44 overflow-y-auto pr-1">
            {files.map(({ file, progress, error }) => (
              <li
                key={file.name + file.size}
                className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2"
              >
                {/* Paperclip icon */}
                <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>

                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate text-gray-200">{file.name}</p>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>

                <span className="text-xs text-gray-400 shrink-0">{fmtSize(file.size)}</span>

                {/* Spinner while uploading, checkmark when done */}
                {!error && (
                  progress < 100 ? (
                    <svg className="w-4 h-4 shrink-0 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )
                )}

                <button
                  onClick={() => removeFile(file)}
                  className="text-gray-500 hover:text-white transition-colors shrink-0"
                  aria-label="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Footer buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-600 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleContinue}
            disabled={!allDone || files.every((f) => f.error)}
            className="flex-1 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
