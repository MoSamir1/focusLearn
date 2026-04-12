import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import CollapsibleCourseTree from "../components/CollapsibleCourseTree";
import { api } from "../lib/api";

export default function ImportPage() {
  const [courseUrl, setCourseUrl] = useState(
    () => localStorage.getItem("import_url") || "",
  );
  const [cookie, setCookie] = useState(
    () => localStorage.getItem("import_cookie") || "",
  );
  const [showCookie, setShowCookie] = useState(false);
  const [courses, setCourses] = useState([]);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [importing, setImporting] = useState(false);

  const [selectedVideos, setSelectedVideos] = useState(() => new Set());
  const [transcriptState, setTranscriptState] = useState(null);

  const [error, setError] = useState("");
  const [transcriptError, setTranscriptError] = useState("");

  // Persistence
  useEffect(() => { localStorage.setItem("import_url", courseUrl); }, [courseUrl]);
  useEffect(() => { localStorage.setItem("import_cookie", cookie); }, [cookie]);

  async function refresh() {
    try {
      const data = await api.listCourses();
      setCourses(data);
      setTreeRefreshKey(Date.now());
    } catch (e) {
      console.error("Refresh failed", e);
    }
  }

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);

  async function importCourse() {
    if (!courseUrl.trim()) { setError("من فضلك أدخل رابط الكورس"); return; }
    setError("");
    setImporting(true);
    try {
      await api.importCourse({ course_url: courseUrl, cookie: cookie || null });
      await refresh();
      toast.success("تم استيراد الكورس بنجاح!");
    } catch (e) {
      setError(e.message);
      toast.error("فشل الاستيراد");
    } finally {
      setImporting(false);
    }
  }

  async function importTranscripts() {
    setTranscriptError("");
    const ids = Array.from(selectedVideos);
    if (!ids.length) { setTranscriptError("اختر فيديو واحد على الأقل"); return; }
    setTranscriptState({ status: "running", progress: 0, done: 0, total: ids.length });
    try {
      const { job_id } = await api.importTranscripts({ target_type: "video", ids });
      const timer = setInterval(async () => {
        const status = await api.getTranscriptStatus(job_id);
        setTranscriptState(status);
        if (["done", "error"].includes(status.status)) {
          clearInterval(timer);
          if (status.status === "done") toast.success("✅ تم جلب النصوص بنجاح");
          else toast.error(`فشل جلب النص: ${status.message || "غير معروف"}`);
          await refresh();
        }
      }, 1500);
    } catch (e) {
      setTranscriptError(e.message);
      toast.error(`فشل جلب النص: ${e.message}`);
    }
  }

  const card = "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-white/10 dark:bg-[#111827]";
  const inputCls = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-[#0B0F1A] dark:text-gray-100 dark:focus:border-brandDark";
  const btnPrimary = "rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 transition disabled:opacity-50";

  return (
    <section className="space-y-5 animate-fade-in text-gray-900 dark:text-gray-100">

      {/* ── 1. Import Course ── */}
      <div className={card}>
        <h2 className="mb-4 flex items-center gap-2 text-base font-bold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">1</span>
          استيراد كورس جديد
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              رابط الكورس
            </label>
            <input
              value={courseUrl}
              onChange={(e) => setCourseUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && importCourse()}
              placeholder="https://maharatech.gov.eg/course/view.php?id=..."
              className={inputCls}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                MoodleSession Cookie <span className="normal-case font-normal text-gray-400">(للكورسات الخاصة)</span>
              </label>
              <button
                onClick={() => setShowCookie((v) => !v)}
                className="text-xs text-brand dark:text-brandDark"
              >
                {showCookie ? "إخفاء" : "إظهار"}
              </button>
            </div>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="MoodleSession=abc123..."
              rows={showCookie ? 3 : 1}
              className={`${inputCls} resize-none`}
              style={{ WebkitTextSecurity: showCookie ? "none" : "disc" }}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          {error && (
            <p className="flex-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            onClick={importCourse}
            disabled={importing}
            className={`${btnPrimary} mr-auto flex items-center gap-2`}
          >
            {importing ? (
              <><span className="animate-spin">⏳</span> جاري الاستيراد...</>
            ) : (
              "استيراد الكورس ▶"
            )}
          </button>
        </div>
      </div>

      {/* ── 2. Transcripts ── */}
      <div className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">2</span>
            جلب النصوص (Transcripts)
          </h2>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
              {selectedVideos.size} محدد
            </span>
            <button
              onClick={importTranscripts}
              disabled={transcriptState?.status === "running" || selectedVideos.size === 0}
              className={btnPrimary}
            >
              جلب المحدد ▶
            </button>
          </div>
        </div>
        <div className="max-h-80 overflow-auto space-y-2 rounded-xl border border-gray-100 bg-gray-50/50 p-2 dark:border-white/5 dark:bg-white/5">
          {courses.map((course) => (
            <CollapsibleCourseTree
              key={`trans-${course.id}`}
              course={course}
              refreshKey={treeRefreshKey}
              selectedVideos={selectedVideos}
              setSelectedVideos={setSelectedVideos}
              onCourseRefresh={refresh}
              showTranscriptControls={true}
              showStatus={true}
              showExports={false}
              showDeleteButtons={false}
            />
          ))}
          {!courses.length && (
            <p className="py-8 text-center text-sm text-gray-400">
              لا توجد كورسات. استورد كورساً أولاً من القسم أعلاه.
            </p>
          )}
        </div>
        {transcriptState && (
          <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
            <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
              <div
                className="h-full bg-brand transition-all duration-300 rounded-full"
                style={{ width: `${transcriptState.progress}%` }}
              />
            </div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {transcriptState.status === "done"
                ? "✅ تم جلب جميع النصوص!"
                : transcriptState.status === "error"
                  ? `❌ خطأ: ${transcriptState.message}`
                  : `⏳ جاري المعالجة: ${transcriptState.done || 0} / ${transcriptState.total || "?"} فيديو`}
            </p>
          </div>
        )}
        {transcriptError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {transcriptError}
          </p>
        )}
      </div>
    </section>
  );
}
