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
      if (
        !activeVideoId &&
        data.chapters?.length &&
        data.chapters[0].videos?.length
      ) {
        setActiveVideoId(data.chapters[0].videos[0].id);
      }
      // Auto-open the first chapter for quick access
      setOpenChapters(
        new Set(data.chapters?.length ? [data.chapters[0].id] : []),
      );
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [courseId]);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
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

  async function toggleChapter(chapterId, completed) {
    await api.setChapterCompletion(chapterId, completed);
    await refresh();
  }

  async function exportTranscript(fmt) {
    if (!activeVideo) return;
    try {
      const res = await fetch(api.exportVideo(activeVideo.id, fmt));
      if (!res.ok) {
        throw new Error("فشل التصدير");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transcript.${fmt}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (fmt === "pdf") {
        toast.success("تم التصدير كـ PDF");
      }
    } catch (e) {
      toast.error(e.message || "فشل التصدير");
    }
  }

  async function handleLinkLocal(file) {
    if (!activeVideo) return;
    // Electron/Tauri expose file.path; fall back to name (will fail gracefully on browser-only environments)
    const filePath = file?.path || file?.name;
    if (!filePath) {
      setError("لا يمكن قراءة مسار الملف من المتصفح.");
      return;
    }
    try {
      await api.linkLocalVideo(activeVideo.id, filePath);
      await refresh();
      toast.success(`تم تحميل الفيديو: ${file?.name || filePath}`);
    } catch (e) {
      setError(e.message);
      toast.error(`فشل التحميل: ${e.message}`);
    }
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
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
        if (confirmInfo.id === activeVideoId) {
          setActiveVideoId(null);
        }
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
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  }

  if (!course) {
    return (
      <p className="text-gray-700 dark:text-gray-200">
        {error || "Loading..."}
      </p>
    );
  }

  return (
    <div className="text-gray-900 dark:text-gray-100">
      <button
        onClick={() => navigate("/")}
        className="mb-4 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
      >
        Back
      </button>
      <button
        onClick={() => setConfirmInfo({ type: "course" })}
        className="mb-4 ml-2 rounded-xl bg-red-100 px-3 py-2 text-sm text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
      >
        🗑 حذف الكورس
      </button>
      <div className="grid gap-4 lg:grid-cols-[18rem,1fr]">
        <aside className="h-screen max-h-[80vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-soft scrollbar-thin dark:border-gray-700 dark:bg-gray-900">
          <div className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
            <div className="mb-1">{course.title}</div>
            <div className="text-xs text-gray-700 dark:text-gray-200">
              {progressStats.done}/{progressStats.total} مكتمل
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full bg-brand dark:bg-brandDark"
                style={{ width: `${progressStats.percent}%` }}
              />
            </div>
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {course.chapters.map((ch) => {
              const videosDone = ch.videos.filter((v) => v.completed).length;
              const isOpen = openChapters.has(ch.id);
              return (
                <div key={ch.id}>
                  <button
                    className="flex w-full items-center justify-between gap-2 bg-gray-50 px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    onClick={() => toggleChapterOpen(ch.id)}
                  >
                    <span className="flex items-center gap-2">
                      📁 {ch.title}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-300">
                      {videosDone}/{ch.videos.length}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-300">
                      {isOpen ? "▼" : "▶"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pb-2">
                      {ch.videos.map((v) => {
                        const isCurrent = v.id === activeVideoId;
                        return (
                          <div
                            key={v.id}
                            className={`group flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
                              isCurrent
                                ? "border-r-2 border-brand bg-blue-50 dark:border-brandDark dark:bg-blue-900/30"
                                : ""
                            }`}
                            onClick={() => setActiveVideoId(v.id)}
                          >
                            <span>{v.completed ? "✅" : "▶"}</span>
                            <span className="flex-1 text-xs leading-snug text-gray-900 dark:text-gray-100">
                              {v.title}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleVideo(v.id, !v.completed);
                              }}
                              className="flex h-5 w-5 items-center justify-center rounded border border-gray-300 text-[10px] text-gray-800 dark:border-gray-700 dark:text-gray-100"
                              title="تحديد كمكتمل"
                            >
                              {v.completed ? "✓" : ""}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmInfo({ type: "video", id: v.id });
                              }}
                              className="opacity-0 text-red-600 transition group-hover:opacity-100 dark:text-red-400"
                              title="حذف الفيديو"
                            >
                              🗑
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

        <main className="rounded-xl border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900">
          {activeVideo ? (
            <>
              <div className="aspect-video overflow-hidden rounded-xl">
                {activeVideo.local_path ? (
                  <video
                    className="h-full w-full"
                    src={`${api.baseURL || "http://localhost:8000"}/api/videos/${activeVideo.id}/stream`}
                    controls
                  />
                ) : isOnline ? (
                  <iframe
                    className="h-full w-full"
                    src={`https://www.youtube.com/embed/${activeVideo.youtube_id}`}
                    title={activeVideo.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gray-100 p-4 text-center text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    <div className="space-y-3">
                      <p>الفيديو غير متاح بدون إنترنت.</p>
                      <button
                        onClick={triggerFilePicker}
                        className="rounded-lg bg-brand px-3 py-2 text-white text-sm dark:bg-brandDark"
                      >
                        ربط فيديو محلي
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="my-3 flex gap-2">
                <button
                  disabled={activeIndex <= 0}
                  onClick={() =>
                    setActiveVideoId(flatVideos[activeIndex - 1].id)
                  }
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 disabled:opacity-40 dark:border-gray-700 dark:text-gray-100"
                >
                  Previous video
                </button>
                <button
                  disabled={
                    activeIndex < 0 || activeIndex >= flatVideos.length - 1
                  }
                  onClick={() =>
                    setActiveVideoId(flatVideos[activeIndex + 1].id)
                  }
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 disabled:opacity-40 dark:border-gray-700 dark:text-gray-100"
                >
                  Next video
                </button>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
                {activeVideo.title}
              </h2>
              <div className="mb-3">
                {activeVideo.local_path ? (
                  <span className="text-sm text-green-600">
                    💾 مرتبط محلياً
                  </span>
                ) : (
                  <button
                    onClick={triggerFilePicker}
                    className="rounded-md border border-gray-200 px-3 py-1 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
                  >
                    ربط فيديو محلي
                  </button>
                )}
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(activeVideo.transcript || "")
                  }
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  Copy
                </button>
                <button
                  onClick={() => exportTranscript("md")}
                  className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                >
                  Download MD
                </button>
                <button
                  onClick={() => exportTranscript("pdf")}
                  className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400"
                >
                  Download PDF
                </button>
                <button
                  onClick={() => exportTranscript("json")}
                  className="rounded-xl bg-yellow-100 px-3 py-2 text-sm text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                >
                  Download JSON
                </button>
              </div>
              {transcriptText ? (
                <article className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-gray-200 p-4 text-sm leading-7 text-gray-900 dark:border-gray-700 dark:text-gray-100">
                  {activeVideo.transcript}
                </article>
              ) : (
                <div className="flex min-h-[8rem] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white/80 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📝</span>
                    <span>النص غير متاح لهذا الفيديو</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-gray-700 dark:text-gray-200">
              No video selected.
            </p>
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
          if (file) {
            handleLinkLocal(file);
          }
          e.target.value = "";
        }}
      />
      <ConfirmDialog
        open={!!confirmInfo}
        title={
          confirmInfo?.type === "course"
            ? "حذف الكورس؟"
            : confirmInfo?.type === "chapter"
              ? "حذف الشابتر؟"
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
