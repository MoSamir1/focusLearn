import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import CollapsibleCourseTree from "../components/CollapsibleCourseTree";
import FolderPicker from "../components/FolderPicker";
import { api } from "../lib/api";

/* ── Size estimation helpers ── */
const BITRATE_MAP = {
  "360":  { label: "360p",  kbps: 500 },
  "480":  { label: "480p",  kbps: 800 },
  "720":  { label: "720p",  kbps: 1500 },
  "1080": { label: "1080p", kbps: 4000 },
  audio:  { label: "صوت",   kbps: 128 },
};

function estimateMB(durationSec, kbps) {
  if (!durationSec || durationSec <= 0) return 0;
  return Math.round((durationSec * kbps) / 8 / 1024 * 10) / 10;
}

function fmtSize(mb) {
  if (!mb) return "0 MB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/* ── Component ── */
export default function VideoDownloadPage() {
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [courseDetail, setCourseDetail] = useState(null);
  const [selectedVideos, setSelectedVideos] = useState(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  const [quality, setQuality] = useState(() => localStorage.getItem("dl_quality") || "720");
  const [audioOnly, setAudioOnly] = useState(false);
  const [downloadPath, setDownloadPath] = useState(() => localStorage.getItem("dl_path") || "");
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const [downloadState, setDownloadState] = useState(null);
  const downloadTimerRef = useRef(null);
  const downloadNotifiedRef = useRef(false);

  const [error, setError] = useState("");

  /* ── Persistence ── */
  useEffect(() => { localStorage.setItem("dl_quality", quality); }, [quality]);
  useEffect(() => { localStorage.setItem("dl_path", downloadPath); }, [downloadPath]);

  /* ── Data loading ── */
  async function loadCourses() {
    try {
      const data = await api.listCourses();
      setCourses(data);
      if (!selectedCourseId && data.length) setSelectedCourseId(String(data[0].id));
    } catch (e) { setError(e.message); }
  }

  async function loadCourseDetail(id) {
    if (!id) return;
    try {
      const data = await api.getCourse(id);
      setCourseDetail(data);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    loadCourses();
    // Load saved path from backend settings
    api.getSettings().then((s) => {
      if (s.download_path && !downloadPath) setDownloadPath(s.download_path);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedCourseId) {
      loadCourseDetail(selectedCourseId);
      setRefreshKey(Date.now());
      setSelectedVideos(new Set());
    }
  }, [selectedCourseId]);

  useEffect(() => () => {
    if (downloadTimerRef.current) clearInterval(downloadTimerRef.current);
  }, []);

  /* ── Build video durations map ── */
  const videoDurations = useMemo(() => {
    const m = {};
    if (!courseDetail) return m;
    courseDetail.chapters?.forEach((ch) => {
      ch.videos?.forEach((v) => { if (v.duration_seconds) m[v.id] = v.duration_seconds; });
    });
    return m;
  }, [courseDetail]);

  /* ── Selected videos total duration ── */
  const selectedDuration = useMemo(() =>
    Array.from(selectedVideos).reduce((a, id) => a + (videoDurations[id] || 0), 0),
    [selectedVideos, videoDurations],
  );

  /* ── Size breakdown per quality ── */
  const sizeBreakdown = useMemo(() => {
    if (!selectedDuration) return [];
    return Object.entries(BITRATE_MAP).map(([key, { label, kbps }]) => ({
      key,
      label,
      size: estimateMB(selectedDuration, kbps),
      active: audioOnly ? key === "audio" : key === quality,
    }));
  }, [selectedDuration, quality, audioOnly]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    if (!courseDetail) return { total: 0, downloaded: 0, pending: 0 };
    const vids = courseDetail.chapters.flatMap((ch) => ch.videos);
    const total = vids.length;
    const downloaded = vids.filter((v) => v.download_status === "done").length;
    return { total, downloaded, pending: total - downloaded };
  }, [courseDetail]);

  /* ── Download handler ── */
  async function startDownload() {
    setError("");
    const ids = Array.from(selectedVideos);
    if (!ids.length) { setError("اختر فيديو واحد على الأقل"); return; }
    if (!downloadPath.trim()) { setShowFolderPicker(true); return; }

    try {
      downloadNotifiedRef.current = false;
      if (downloadTimerRef.current) clearInterval(downloadTimerRef.current);
      setDownloadState({ status: "running", progress: 0, message: "جاري البدء..." });

      const { job_id } = await api.startDownload({
        video_ids: ids,
        quality,
        save_path: downloadPath,
        audio_only: audioOnly,
        numbered_files: true,
      });
      setDownloadState((prev) => ({ ...(prev || {}), job_id }));

      downloadTimerRef.current = setInterval(async () => {
        const s = await api.getDownloadStatus(job_id);
        setDownloadState(s);
        if (["done", "error", "canceled"].includes(s.status)) {
          clearInterval(downloadTimerRef.current);
          downloadTimerRef.current = null;
          if (!downloadNotifiedRef.current) {
            if (s.status === "done") toast.success("✅ اكتمل التحميل!");
            else if (s.status === "error") toast.error(`فشل: ${s.message}`);
            downloadNotifiedRef.current = true;
          }
          loadCourseDetail(selectedCourseId);
        }
      }, 1500);
    } catch (e) {
      setError(e.message);
      toast.error(`فشل التحميل: ${e.message}`);
    }
  }

  async function cancelDownload() {
    if (!downloadState?.job_id) return;
    try {
      await api.cancelDownload(downloadState.job_id);
      setDownloadState((p) => ({ ...(p || {}), status: "canceled", message: "تم الإلغاء" }));
      if (downloadTimerRef.current) { clearInterval(downloadTimerRef.current); downloadTimerRef.current = null; }
      loadCourseDetail(selectedCourseId);
    } catch (e) { setError(e.message); }
  }

  const card = "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft dark:border-white/10 dark:bg-[#111827]";
  const inputCls = "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-white/10 dark:bg-[#0B0F1A] dark:text-gray-100 dark:focus:border-brandDark";
  const isRunning = ["running", "queued"].includes(downloadState?.status);

  return (
    <section className="space-y-5 animate-fade-in" dir="rtl">

      {/* ── Header Card ── */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-lg font-bold text-gray-900 dark:text-white">
            ⬇️ تحميل الفيديوهات
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
        </div>

        {/* Stats */}
        {courseDetail && (
          <div className="mt-3 flex flex-wrap gap-3">
            <span className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
              📹 إجمالي: {stats.total}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              ✅ تم تحميل: {stats.downloaded}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              🔵 متبقي: {stats.pending}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {/* ── Video Tree Selection ── */}
      {selectedCourseId && (
        <div className={card}>
          <h2 className="mb-3 text-sm font-bold text-gray-700 dark:text-gray-200">
            اختر الفيديوهات للتحميل
          </h2>
          <div className="max-h-[420px] overflow-auto rounded-xl border border-gray-100 bg-gray-50/50 p-2 dark:border-white/5 dark:bg-white/5">
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
              showTranscriptControls={false}
              showStatus={true}
              showExports={false}
              showDeleteButtons={false}
              statusKind="download"
            />
          </div>
        </div>
      )}

      {/* ── Size Breakdown Table — appears when videos selected ── */}
      {selectedVideos.size > 0 && sizeBreakdown.length > 0 && (
        <div className={card}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
            📦 الحجم التقريبي
            <span className="rounded-lg bg-brand/10 px-2 py-0.5 text-xs text-brand dark:text-brandDark">
              {selectedVideos.size} فيديو
            </span>
          </h2>

          <div className="grid gap-2 sm:grid-cols-5">
            {sizeBreakdown.map(({ key, label, size, active }) => (
              <button
                key={key}
                onClick={() => {
                  if (key === "audio") {
                    setAudioOnly(true);
                  } else {
                    setAudioOnly(false);
                    setQuality(key);
                  }
                }}
                className={`group relative overflow-hidden rounded-xl border p-3 text-center transition-all ${
                  active
                    ? key === "audio"
                      ? "border-success bg-success/10 ring-2 ring-success/30"
                      : "border-brand bg-brand/10 ring-2 ring-brand/30"
                    : "border-gray-200 bg-white hover:border-brand/40 dark:border-white/10 dark:bg-white/5"
                }`}
              >
                <div className="text-xs font-bold text-gray-500 dark:text-gray-400">{label}</div>
                <div className={`mt-1 text-base font-bold ${
                  active
                    ? key === "audio" ? "text-success" : "text-brand dark:text-brandDark"
                    : "text-gray-800 dark:text-gray-200"
                }`}>
                  {fmtSize(size)}
                </div>
                {active && (
                  <div className={`mt-1 text-[10px] font-semibold ${
                    key === "audio" ? "text-success" : "text-brand dark:text-brandDark"
                  }`}>
                    ✓ محدد
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Download Settings ── */}
      {selectedVideos.size > 0 && (
        <div className={`${card} space-y-4`}>
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200">⚙️ إعدادات التحميل</h2>

          {/* Download path */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              📁 مجلد الحفظ
            </label>
            <div className="flex gap-2">
              <input
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder="/home/user/Downloads"
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => setShowFolderPicker(true)}
                className="shrink-0 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
              >
                📂 تصفح
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {downloadState && (
            <div className="rounded-xl border border-gray-100 p-3 dark:border-white/10">
              <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    downloadState.status === "error" ? "bg-red-500" : "bg-brand"
                  }`}
                  style={{ width: `${downloadState.progress || 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                <span>
                  {downloadState.status === "done" && "✅ اكتمل التحميل"}
                  {downloadState.status === "running" && `⬇ ${downloadState.progress}% — ${downloadState.current_title || ""}`}
                  {downloadState.status === "canceled" && "⛔ تم الإلغاء"}
                  {downloadState.status === "error" && `❌ ${downloadState.message}`}
                  {downloadState.status === "queued" && "⏳ في الانتظار..."}
                </span>
                <span className="font-semibold">{downloadState.done || 0}/{downloadState.total || "?"}</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            {isRunning && (
              <button onClick={cancelDownload}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10">
                ⛔ إلغاء
              </button>
            )}
            <button
              onClick={startDownload}
              disabled={selectedVideos.size === 0 || isRunning}
              className="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
            >
              ⬇ تحميل {selectedVideos.size > 0
                ? `(${selectedVideos.size}) • ${fmtSize(
                    estimateMB(selectedDuration, audioOnly ? 128 : BITRATE_MAP[quality]?.kbps || 1500)
                  )}`
                : ""}
            </button>
          </div>
        </div>
      )}

      {/* Folder picker dialog */}
      {showFolderPicker && (
        <FolderPicker
          currentPath={downloadPath || "/home"}
          onSelect={(path) => {
            setDownloadPath(path);
            setShowFolderPicker(false);
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </section>
  );
}
