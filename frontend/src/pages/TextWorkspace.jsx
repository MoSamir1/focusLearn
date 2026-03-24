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

  useEffect(() => {
    loadCourses();
  }, []);

  useEffect(() => {
    if (selectedCourseId) {
      loadCourseDetail(selectedCourseId);
      setRefreshKey(Date.now());
      setSelectedVideos(new Set());
    }
  }, [selectedCourseId]);

  async function importSelectedTranscripts() {
    if (!selectedVideos.size) return;
    setTranscriptState({
      status: "running",
      progress: 0,
      done: 0,
      total: selectedVideos.size,
    });
    try {
      const { job_id } = await api.importTranscripts({
        target_type: "video",
        ids: Array.from(selectedVideos),
      });
      const timer = setInterval(async () => {
        const status = await api.getTranscriptStatus(job_id);
        setTranscriptState(status);
        if (status.status === "done" || status.status === "error") {
          clearInterval(timer);
          if (status.status === "done") {
            toast.success("تم جلب النص بنجاح");
          } else {
            toast.error(`فشل جلب النص: ${status.message || "غير معروف"}`);
          }
          await loadCourseDetail(selectedCourseId);
        }
      }, 1500);
    } catch (e) {
      setError(e.message);
      toast.error(`فشل جلب النص: ${e.message}`);
    }
  }

  function exportAll(fmt) {
    if (!selectedCourseId) return;
    window.open(api.exportCourse(selectedCourseId, fmt), "_blank");
  }

  function exportSelected(fmt) {
    selectedVideos.forEach((id) => {
      window.open(api.exportVideo(id, fmt), "_blank");
    });
  }

  const stats = useMemo(() => {
    if (!courseDetail)
      return { total: 0, available: 0, disabled: 0, missing: 0 };
    const videos = courseDetail.chapters.flatMap((c) => c.videos);
    const total = videos.length;
    const available = videos.filter((v) => (v.transcript || "").trim()).length;
    const disabled = 0;
    const missing = total - available - disabled;
    return { total, available, disabled, missing };
  }, [courseDetail]);

  return (
    <section className="space-y-4 text-gray-900 dark:text-gray-100" dir="rtl">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            مساحة النصوص 📝
          </h1>
          <select
            value={selectedCourseId || ""}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {!courses.length && <option value="">لا يوجد كورسات</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => exportAll("pdf")}
              className="rounded-md border border-red-200 bg-red-100 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
            >
              تصدير الكل PDF
            </button>
            <button
              onClick={() => exportAll("md")}
              className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            >
              تصدير الكل MD
            </button>
            <button
              onClick={() => exportAll("json")}
              className="rounded-md border border-yellow-200 bg-yellow-100 px-3 py-2 text-sm text-yellow-700 dark:border-yellow-900/40 dark:bg-yellow-900/30 dark:text-yellow-400"
            >
              JSON
            </button>
          </div>
          <button className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100">
            تحديد متعدد
          </button>
        </div>
        <div className="mt-3 text-sm text-gray-700 dark:text-gray-200">
          إجمالي: {stats.total} فيديو | ✅ {stats.available} نص متاح | ⛔{" "}
          {stats.disabled} غير متاح | 🔵 {stats.missing} لم يُجلب بعد
        </div>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {selectedCourseId && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900">
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
            showDeleteButtons={true}
            showCopyButton={true}
          />
        </div>
      )}

      {selectedVideos.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <span className="text-sm text-gray-800 dark:text-gray-200">
            {selectedVideos.size} فيديو محدد
          </span>
          <button
            onClick={importSelectedTranscripts}
            className="rounded-md bg-brand px-3 py-2 text-sm text-white dark:bg-brandDark"
          >
            جلب النصوص
          </button>
          <button
            onClick={() => exportSelected("pdf")}
            className="rounded-md border border-red-200 bg-red-100 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
          >
            تصدير PDF
          </button>
          <button
            onClick={() => exportSelected("md")}
            className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          >
            تصدير MD
          </button>
          <button
            onClick={() => setSelectedVideos(new Set())}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
          >
            إلغاء التحديد
          </button>
        </div>
      )}

      {transcriptState && (
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${transcriptState.progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-700 dark:text-gray-200">
            {transcriptState.status === "done"
              ? "✅ اكتمل جلب النصوص"
              : transcriptState.status === "error"
                ? `❌ خطأ: ${transcriptState.message}`
                : `⏳ جاري المعالجة: ${transcriptState.done || 0} / ${transcriptState.total || "?"}`}
          </p>
        </div>
      )}
    </section>
  );
}
