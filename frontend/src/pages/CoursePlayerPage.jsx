import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog";
import { api } from "../lib/api";

export default function CoursePlayerPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [openChapters, setOpenChapters] = useState(() => new Set());
  const [error, setError] = useState("");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const fileInputRef = useRef(null);
  const [confirmInfo, setConfirmInfo] = useState(null);

  async function refresh() {
    try {
      const data = await api.getCourse(courseId);
      setCourse(data);
      if (!activeVideoId && data.chapters?.length && data.chapters[0].videos?.length) {
        setActiveVideoId(data.chapters[0].videos[0].id);
      }
      setOpenChapters(new Set(data.chapters?.length ? [data.chapters[0].id] : []));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, [courseId]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const flatVideos = useMemo(() => {
    if (!course) return [];
    return course.chapters.flatMap((ch) => ch.videos);
  }, [course]);

  const activeIndex = flatVideos.findIndex((v) => v.id === activeVideoId);
  const activeVideo = activeIndex >= 0 ? flatVideos[activeIndex] : null;
  const transcriptText = (activeVideo?.transcript || "").trim();

  const progressStats = useMemo(() => {
    if (!course) return { total: 0, done: 0, percent: 0 };
    const videos = course.chapters.flatMap((c) => c.videos);
    const total = videos.length;
    const done = videos.filter((v) => v.completed).length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return { total, done, percent };
  }, [course]);

  async function toggleVideo(videoId, completed) {
    await api.setVideoCompletion(videoId, completed);
    await refresh();
  }

  async function exportTranscript(fmt) {
    if (!activeVideo) return;
    try {
      const res = await fetch(api.exportVideo(activeVideo.id, fmt));
      if (!res.ok) throw new Error("فشل التصدير");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transcript.${fmt}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`تم التصدير كـ ${fmt.toUpperCase()}`);
    } catch (e) {
      toast.error(e.message || "فشل التصدير");
    }
  }

  async function handleLinkLocal(file) {
    if (!activeVideo) return;
    const filePath = file?.path || file?.name;
    if (!filePath) { setError("لا يمكن قراءة مسار الملف من المتصفح."); return; }
    try {
      await api.linkLocalVideo(activeVideo.id, filePath);
      await refresh();
      toast.success(`✅ تم ربط الفيديو المحلي`);
    } catch (e) {
      setError(e.message);
      toast.error(`فشل الربط: ${e.message}`);
    }
  }

  async function handleDeleteConfirm() {
    if (!confirmInfo) return;
    try {
      if (confirmInfo.type === "course") {
        await api.deleteCourse(course.id);
        navigate("/");
      } else if (confirmInfo.type === "chapter") {
        await api.deleteChapter(confirmInfo.id);
        await refresh();
      } else if (confirmInfo.type === "video") {
        await api.deleteVideo(confirmInfo.id);
        if (confirmInfo.id === activeVideoId) setActiveVideoId(null);
        await refresh();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setConfirmInfo(null);
    }
  }

  function toggleChapterOpen(chapterId) {
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  if (!course) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        {error ? (
          <p className="text-red-500">{error}</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p>جاري التحميل...</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in text-gray-900 dark:text-gray-100">
      {/* Top bar */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
        >
          ← عودة
        </button>
        <h1 className="flex-1 text-base font-bold text-gray-900 dark:text-white truncate">
          {course.title}
        </h1>
        <button
          onClick={() => setConfirmInfo({ type: "course" })}
          className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
        >
          🗑 حذف الكورس
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px,1fr]">
        {/* ── Sidebar ── */}
        <aside className="flex flex-col max-h-[82vh] rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-white/10 dark:bg-[#111827] overflow-hidden">
          {/* Course progress header */}
          <div className="border-b border-gray-100 p-4 dark:border-white/10">
            <div className="mb-2 flex justify-between text-xs font-semibold">
              <span className="text-gray-500 dark:text-gray-400">التقدم الكلي</span>
              <span className="text-brand dark:text-brandDark">
                {progressStats.done}/{progressStats.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500"
                style={{ width: `${progressStats.percent}%` }}
              />
            </div>
            <p className="mt-1.5 text-center text-xs font-bold text-brand dark:text-brandDark">
              {progressStats.percent}% مكتمل
            </p>
          </div>

          {/* Chapters list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-white/10">
            {course.chapters.map((ch) => {
              const videosDone = ch.videos.filter((v) => v.completed).length;
              const isOpen = openChapters.has(ch.id);
              return (
                <div key={ch.id}>
                  <button
                    className="flex w-full items-center gap-2 bg-gray-50/80 px-3 py-3 text-right text-sm font-bold text-gray-800 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                    onClick={() => toggleChapterOpen(ch.id)}
                  >
                    <span className="text-gray-400 text-xs">{isOpen ? "▼" : "▶"}</span>
                    <span className="flex-1 text-start">📁 {ch.title}</span>
                    <span className="shrink-0 text-xs font-normal text-gray-400 dark:text-gray-500">
                      {videosDone}/{ch.videos.length}
                    </span>
                  </button>
                  {isOpen && (
                    <div>
                      {ch.videos.map((v) => {
                        const isCurrent = v.id === activeVideoId;
                        return (
                          <div
                            key={v.id}
                            className={`group flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5 ${
                              isCurrent
                                ? "border-r-2 border-brand bg-brand/5 dark:border-brandDark dark:bg-brandDark/10"
                                : ""
                            }`}
                            onClick={() => setActiveVideoId(v.id)}
                          >
                            <span className="text-xs">{v.completed ? "✅" : "▷"}</span>
                            <span className="flex-1 text-xs leading-relaxed text-gray-800 dark:text-gray-200 line-clamp-2">
                              {v.title}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleVideo(v.id, !v.completed); }}
                              className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition ${
                                v.completed
                                  ? "border-brand bg-brand text-white dark:border-brandDark dark:bg-brandDark"
                                  : "border-gray-300 text-gray-400 dark:border-gray-600"
                              }`}
                              title="تحديد كمكتمل"
                            >
                              {v.completed ? "✓" : ""}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex flex-col gap-4">
          {activeVideo ? (
            <>
              {/* Video player */}
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-black shadow-card dark:border-white/10">
                <div className="aspect-video">
                  {activeVideo.local_path ? (
                    <video
                      className="h-full w-full"
                      src={`${api.baseURL}/api/videos/${activeVideo.id}/stream`}
                      controls
                    />
                  ) : isOnline ? (
                    <iframe
                      className="h-full w-full"
                      src={`https://www.youtube.com/embed/${activeVideo.youtube_id}?autoplay=0`}
                      title={activeVideo.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gray-900 p-6 text-center">
                      <div className="space-y-3">
                        <div className="text-4xl">📵</div>
                        <p className="text-sm text-gray-300">الفيديو غير متاح بدون إنترنت</p>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
                        >
                          ربط فيديو محلي
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Navigation + actions */}
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-[#111827]">
                {/* Title */}
                <h2 className="mb-3 text-base font-bold text-gray-900 dark:text-white">
                  {activeVideo.title}
                </h2>

                {/* Nav buttons */}
                <div className="mb-3 flex gap-2">
                  <button
                    disabled={activeIndex <= 0}
                    onClick={() => setActiveVideoId(flatVideos[activeIndex - 1].id)}
                    className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    ← السابق
                  </button>
                  <button
                    disabled={activeIndex < 0 || activeIndex >= flatVideos.length - 1}
                    onClick={() => setActiveVideoId(flatVideos[activeIndex + 1].id)}
                    className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                  >
                    التالي →
                  </button>
                </div>

                {/* Export + local link buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(activeVideo.transcript || "")}
                    className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                    title="نسخ النص"
                  >
                    📋 نسخ
                  </button>
                  <button
                    onClick={() => exportTranscript("md")}
                    className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300"
                  >
                    MD ↓
                  </button>
                  <button
                    onClick={() => exportTranscript("pdf")}
                    className="rounded-xl bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                  >
                    PDF ↓
                  </button>
                  <button
                    onClick={() => exportTranscript("json")}
                    className="rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
                  >
                    JSON ↓
                  </button>
                  {activeVideo.local_path ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                      💾 مرتبط محلياً
                    </span>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-xl border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-brand hover:text-brand dark:border-white/20 dark:text-gray-400"
                    >
                      ربط ملف محلي
                    </button>
                  )}
                </div>
              </div>

              {/* Transcript section */}
              <div className="rounded-2xl border border-gray-200/80 bg-white shadow-soft dark:border-white/10 dark:bg-[#111827]">
                <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
                  <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                    📝 النص التلقائي
                  </p>
                </div>
                {transcriptText ? (
                  <article className="max-h-72 overflow-auto whitespace-pre-wrap p-4 text-sm leading-8 text-gray-700 dark:text-gray-300">
                    {activeVideo.transcript}
                  </article>
                ) : (
                  <div className="flex min-h-24 items-center justify-center p-6 text-sm text-gray-400 dark:text-gray-500">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-2xl">📭</span>
                      <span>لا يوجد نص لهذا الفيديو بعد</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-white/10">
              اختر فيديو من القائمة
            </div>
          )}
        </main>
      </div>

      <input
        type="file"
        accept="video/*"
        ref={fileInputRef}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleLinkLocal(file);
          e.target.value = "";
        }}
      />
      <ConfirmDialog
        open={!!confirmInfo}
        title={
          confirmInfo?.type === "course" ? "حذف الكورس؟"
            : confirmInfo?.type === "chapter" ? "حذف الفصل؟"
              : "حذف الفيديو؟"
        }
        message="سيتم حذف البيانات من قاعدة البيانات فقط. الملفات المحمّلة على جهازك لن تُحذف."
        confirmText="حذف"
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmInfo(null)}
      />
    </div>
  );
}
