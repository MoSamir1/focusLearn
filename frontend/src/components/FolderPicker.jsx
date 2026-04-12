import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function FolderPicker({ currentPath, onSelect, onClose }) {
  const [path, setPath] = useState(currentPath || "/home");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualInput, setManualInput] = useState(currentPath || "/home");

  async function browse(dirPath) {
    setLoading(true);
    setError("");
    try {
      const data = await api.browseDirs(dirPath);
      setEntries(data.entries || []);
      setPath(data.current || dirPath);
      setManualInput(data.current || dirPath);
    } catch (e) {
      setError(e.message || "فشل تصفح المجلد");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { browse(path); }, []);

  function goUp() {
    const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
    browse(parent);
  }

  function enterDir(name) {
    const next = path === "/" ? `/${name}` : `${path}/${name}`;
    browse(next);
  }

  function handleManualGo() {
    if (manualInput.trim()) browse(manualInput.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg animate-slide-up rounded-2xl border border-gray-200/80 bg-white shadow-card dark:border-white/10 dark:bg-[#1a1f35] flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">📂 اختر مجلد الحفظ</h2>
        </div>

        {/* Path bar */}
        <div className="border-b border-gray-100 px-5 py-3 dark:border-white/10">
          <div className="flex gap-2">
            <input
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualGo()}
              className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-brand dark:border-white/10 dark:bg-[#0B0F1A] dark:text-gray-100"
              dir="ltr"
              placeholder="/home/user/Downloads"
            />
            <button
              onClick={handleManualGo}
              className="rounded-xl bg-brand px-3 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              انتقل
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 truncate" dir="ltr">{path}</p>
        </div>

        {/* Entries list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {error && (
            <p className="mx-3 my-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}

          {/* Go up */}
          {path !== "/" && (
            <button
              onClick={goUp}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="text-base">⬆️</span>
              <span className="font-semibold">..</span>
              <span className="text-xs text-gray-400">المجلد الأعلى</span>
            </button>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-gray-400">
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              جاري التحميل...
            </div>
          ) : entries.length === 0 && !error ? (
            <p className="py-8 text-center text-sm text-gray-400">مجلد فارغ</p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => enterDir(entry.name)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5"
              >
                <span className="text-base">📁</span>
                <span className="flex-1 text-start truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-3 flex justify-between gap-2 dark:border-white/10">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
          >
            إلغاء
          </button>
          <button
            onClick={() => onSelect(path)}
            className="rounded-xl bg-brand px-6 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            ✅ اختر هذا المجلد
          </button>
        </div>
      </div>
    </div>
  );
}
