import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import CollapsibleCourseTree from "../components/CollapsibleCourseTree";
import { api } from "../lib/api";

export default function TextWorkspace() {
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [selectedVideos, setSelectedVideos] = useState(() => new Set());
  const [courseDetail, setCourseDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [transcriptState, setTranscriptState] = useState(null);
  const [error, setError] = useState("");

  async function loadCourses() {
    try {
      const data = await api.listCourses();
      setCourses(data);
      if (!selectedCourseId && data.length) {
        setSelectedCourseId(String(data[0].id));
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadCourseDetail(courseId) {
    if (!courseId) return;
    try {
      const data = await api.getCourse(courseId);
      setCourseDetail(data);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { loadCourses(); }, []);

  useEffect(() => {
    if (selectedCourseId) {
      loadCourseDetail(selectedCourseId);
      setRefreshKey(Date.now());
      setSelectedVideos(new Set());
    }
  }, [selectedCourseId]);

  async function importSelectedTranscripts() {
    if (!selectedVideos.size) return;
    setTranscriptState({ status: "running", progress: 0, done: 0, total: selectedVideos.size });
    try {
      const { job_id } = await api.importTranscripts({
        target_type: "video",
        ids: Array.from(selectedVideos),
      });
      const timer = setInterval(async () => {
        const status = await api.getTranscriptStatus(job_id);
        setTranscriptState(status);
        if (["done", "error"].includes(status.status)) {
          clearInterval(timer);
          if (status.status === "done") toast.success("✅ تم جلب النصوص");
          else toast.error(`فشل: ${status.message || "غير معروف"}`);
          await loadCourseDetail(selectedCourseId);
        }
      }, 1500);
    } catch (e) {
      setError(e.message);
      toast.error(`فشل: ${e.message}`);
    }
  }

  function exportAll(fmt) {
    if (!selectedCourseId) return;
    window.open(api.exportCourse(selectedCourseId, fmt), "_blank");
  }

  function exportSelected(fmt) {
    selectedVideos.forEach((id) => window.open(api.exportVideo(id, fmt), "_blank"));
  }

  const stats = useMemo(() => {
    if (!courseDetail) return { total: 0, available: 0, missing: 0 };
    const videos = courseDetail.chapters.flatMap((c) => c.videos);
    const total = videos.length;
    const available = videos.filter((v) => (v.transcript || "").trim()).length;
    const missing = total - available;
    return { total, available, missing };
  }, [courseDetail]);

  const card = "rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-[#111827]";

  return (
    <section className="space-y-4 animate-fade-in text-gray-900 dark:text-gray-100" dir="rtl">
      {/* Header card */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-lg font-bold text-gray-900 dark:text-white">
            📝 مساحة النصوص
          </h1>

          {/* Course selector */}
          <select
            value={selectedCourseId || ""}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-[#0B0F1A] dark:text-gray-200"
          >
            {!courses.length && <option value="">لا يوجد كورسات</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>

          {/* Export all buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => exportAll("pdf")}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              تصدير الكل PDF
            </button>
            <button
              onClick={() => exportAll("md")}
              className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300"
            >
              تصدير الكل MD
            </button>
            <button
              onClick={() => exportAll("json")}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400"
            >
              JSON
            </button>
          </div>
        </div>

        {/* Stats row */}
        {courseDetail && (
          <div className="mt-3 flex flex-wrap gap-3">
            <span className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
              📹 إجمالي: {stats.total}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              ✅ متاح: {stats.available}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              🔵 لم يُجلب: {stats.missing}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Course tree */}
      {selectedCourseId && (
        <div className={card}>
          <CollapsibleCourseTree
            course={{ id: selectedCourseId }}
            refreshKey={refreshKey}
            selectedVideos={selectedVideos}
            setSelectedVideos={setSelectedVideos}
            onCourseRefresh={() => {
              loadCourses();
              loadCourseDetail(selectedCourseId);
              setRefreshKey(Date.now());
            }}
            showTranscriptControls={true}
            showStatus={true}
            showExports={true}
            showDeleteButtons={false}
            showCopyButton={true}
          />
        </div>
      )}

      {/* Bottom action bar -- appears when videos selected */}
      {selectedVideos.size > 0 && (
        <div className="sticky bottom-4 z-10 animate-slide-up flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200/80 bg-white/90 px-4 py-3 shadow-card backdrop-blur dark:border-white/10 dark:bg-[#111827]/90">
          <span className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
              {selectedVideos.size}
            </span>
            فيديو محدد
          </span>
          <div className="flex flex-wrap gap-2 mr-auto">
            <button
              onClick={importSelectedTranscripts}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
              disabled={transcriptState?.status === "running"}
            >
              جلب النصوص
            </button>
            <button
              onClick={() => exportSelected("pdf")}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              تصدير PDF
            </button>
            <button
              onClick={() => exportSelected("md")}
              className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300"
            >
              تصدير MD
            </button>
            <button
              onClick={() => setSelectedVideos(new Set())}
              className="rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5"
            >
              إلغاء التحديد
            </button>
          </div>
        </div>
      )}

      {/* Transcript progress */}
      {transcriptState && (
        <div className={card}>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${transcriptState.progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs font-medium text-gray-600 dark:text-gray-300">
            {transcriptState.status === "done"
              ? "✅ اكتمل جلب النصوص"
              : transcriptState.status === "error"
                ? `❌ خطأ: ${transcriptState.message}`
                : `⏳ جاري: ${transcriptState.done || 0} / ${transcriptState.total || "?"}`}
          </p>
        </div>
      )}
    </section>
  );
}
