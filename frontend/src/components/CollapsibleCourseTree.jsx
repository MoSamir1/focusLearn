import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import ConfirmDialog from "./ConfirmDialog";
import { api } from "../lib/api";

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function CollapsibleCourseTree({
  course,
  refreshKey,
  selectedVideos,
  setSelectedVideos,
  onCourseRefresh,
  showTranscriptControls = true,
  showStatus = true,
  showExports = true,
  statusKind = "transcript", // transcript | download
  enableHierarchySelection = true,
  showDeleteButtons = true,
  showCopyButton = false,
}) {
  const [detail, setDetail] = useState(null);
  const [expandedCourses, setExpandedCourses] = useState(() => new Set());
  const [expandedChapters, setExpandedChapters] = useState(() => new Set());
  const [transcriptStatus, setTranscriptStatus] = useState({}); // { [videoId]: 'available' | 'missing' | 'disabled' | 'loading' }
  const [confirmInfo, setConfirmInfo] = useState(null);

  useEffect(() => {
    let mounted = true;
    api
      .getCourse(course.id)
      .then((data) => {
        if (!mounted) return;
        setDetail(data);
        const courseSet = new Set([course.id]);
        const chapterSet = new Set(
          data.chapters?.length ? [data.chapters[0].id] : [],
        );
        setExpandedCourses(courseSet);
        setExpandedChapters(chapterSet);
        if (showStatus || showTranscriptControls) {
          const initStatus = {};
          data.chapters.forEach((ch) => {
            ch.videos.forEach((v) => {
              if (statusKind === "download") {
                const st = (v.download_status || "idle").toLowerCase();
                if (st === "done") initStatus[v.id] = "available";
                else if (st === "downloading" || st === "queued")
                  initStatus[v.id] = "loading";
                else if (st === "error") initStatus[v.id] = "disabled";
                else initStatus[v.id] = "missing";
              } else {
                initStatus[v.id] = v.transcript?.trim()
                  ? "available"
                  : "missing";
              }
            });
          });
          setTranscriptStatus(initStatus);
        }
      })
      .catch(() => setDetail(null));
    return () => {
      mounted = false;
    };
  }, [course.id, refreshKey, showStatus, showTranscriptControls, statusKind]);

  const allVideoIds = useMemo(() => {
    if (!detail) return [];
    return detail.chapters.flatMap((ch) => ch.videos.map((v) => v.id));
  }, [detail]);

  function toggleCourseExpanded() {
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(course.id)) next.delete(course.id);
      else next.add(course.id);
      return next;
    });
  }

  function toggleChapterExpanded(chId) {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chId)) next.delete(chId);
      else next.add(chId);
      return next;
    });
  }

  function setSelected(fn) {
    setSelectedVideos((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
  }

  function toggleVideo(videoId) {
    setSelected((next) => {
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
    });
  }

  function selectAllCourse() {
    setSelected((next) => {
      allVideoIds.forEach((id) => next.add(id));
    });
  }

  function clearCourse() {
    setSelected((next) => {
      allVideoIds.forEach((id) => next.delete(id));
    });
  }

  function toggleChapterSelection(chapter) {
    const ids = chapter.videos.map((v) => v.id);
    const allSelected = ids.every((id) => selectedVideos.has(id));
    setSelected((next) => {
      ids.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
    });
  }

  function toggleCourseCheckbox() {
    const allSelected = allVideoIds.every((id) => selectedVideos.has(id));
    setSelected((next) => {
      allVideoIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
    });
  }

  async function fetchTranscript(video) {
    if (!showTranscriptControls) return;
    setTranscriptStatus((prev) => ({ ...prev, [video.id]: "loading" }));
    try {
      const res = await api.fetchVideoTranscript(video.id);
      if (res.success && res.transcript) {
        setTranscriptStatus((prev) => ({ ...prev, [video.id]: "available" }));
        setDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((ch) => ({
              ...ch,
              videos: ch.videos.map((v) =>
                v.id === video.id ? { ...v, transcript: res.transcript } : v,
              ),
            })),
          };
        });
        toast.success("تم جلب النص بنجاح");
      } else {
        setTranscriptStatus((prev) => ({
          ...prev,
          [video.id]:
            res.reason === "transcripts_disabled" ? "disabled" : "missing",
        }));
        toast.error(`فشل جلب النص: ${res.reason || "غير معروف"}`);
      }
      onCourseRefresh?.();
    } catch (e) {
      setTranscriptStatus((prev) => ({ ...prev, [video.id]: "disabled" }));
      toast.error(`فشل جلب النص: ${e.message}`);
    }
  }

  async function handleDeleteConfirmed() {
    if (!confirmInfo) return;
    try {
      if (confirmInfo.type === "course") {
        await api.deleteCourse(detail.id);
        setDetail(null);
        onCourseRefresh?.();
      } else if (confirmInfo.type === "chapter") {
        await api.deleteChapter(confirmInfo.id);
        onCourseRefresh?.();
      } else if (confirmInfo.type === "video") {
        await api.deleteVideo(confirmInfo.id);
        setSelected((next) => {
          next.delete(confirmInfo.id);
        });
        onCourseRefresh?.();
      }
    } catch (e) {
      // surface errors inline by refreshing state so parent can display
      console.error(e);
    } finally {
      setConfirmInfo(null);
    }
  }

  function requestDelete(payload) {
    setConfirmInfo(payload);
  }

  if (!detail) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  const courseExpanded = expandedCourses.has(course.id);

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 dark:border-white/5 dark:bg-white/3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-gray-100 dark:border-white/5">
        <button
          onClick={toggleCourseExpanded}
          className="text-sm rounded-lg border border-gray-200 px-2 py-1 text-gray-600 dark:border-white/10 dark:text-gray-300 hover:border-brand/50 transition"
        >
          {courseExpanded ? "▼" : "▶"}
        </button>
        <label className="flex items-center gap-2 flex-1 cursor-pointer">
          {enableHierarchySelection ? (
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 accent-brand"
              checked={
                allVideoIds.length > 0 &&
                allVideoIds.every((id) => selectedVideos.has(id))
              }
              onChange={toggleCourseCheckbox}
            />
          ) : null}
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            📚 {detail.title}
          </span>
        </label>
        <button
          onClick={selectAllCourse}
          className="text-xs rounded-lg border border-gray-200 px-2 py-1 text-gray-600 dark:border-white/10 dark:text-gray-300"
        >
          تحديد الكل
        </button>
        <button
          onClick={clearCourse}
          className="text-xs rounded-lg border border-gray-200 px-2 py-1 text-gray-500 dark:border-white/10 dark:text-gray-400"
        >
          إلغاء
        </button>
        {showDeleteButtons ? (
          <button
            onClick={() =>
              requestDelete({
                type: "course",
                title: detail.title,
              })
            }
            className="text-xs rounded-lg bg-red-100 px-2 py-1 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
          >
            🗑 حذف
          </button>
        ) : null}
      </div>

      <div
        className={classNames(
          "transition-all duration-200",
          courseExpanded
            ? "max-h-[2000px] opacity-100"
            : "max-h-0 overflow-hidden opacity-0",
        )}
      >
        <div className="px-3 py-2">
          {detail.chapters.map((ch) => {
            const chExpanded = expandedChapters.has(ch.id);
            const chapterIds = ch.videos.map((v) => v.id);
            const chapterAllSelected = chapterIds.every((id) =>
              selectedVideos.has(id),
            );
            return (
              <div
                key={ch.id}
                className="rounded-xl border border-gray-100 bg-white dark:border-white/5 dark:bg-[#0B0F1A] overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50/80 dark:bg-white/5">
                  <button
                    onClick={() => toggleChapterExpanded(ch.id)}
                    className="text-xs rounded-lg border border-gray-200 px-2 py-1 text-gray-500 dark:border-white/10 dark:text-gray-400"
                  >
                    {chExpanded ? "▼" : "▶"}
                  </button>
                  <label className="flex items-center gap-2 flex-1 cursor-pointer">
                    {enableHierarchySelection ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 accent-brand"
                        checked={chapterAllSelected}
                        onChange={() => toggleChapterSelection(ch)}
                      />
                    ) : null}
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      📁 {ch.title}
                    </span>
                  </label>
                  <button
                    onClick={() => toggleChapterSelection(ch)}
                    className="text-[11px] rounded-lg border border-gray-200 px-2 py-1 text-gray-500 dark:border-white/10 dark:text-gray-400"
                  >
                    {chapterAllSelected ? "إلغاء" : "تحديد الكل"}
                  </button>
                  {showDeleteButtons && (
                    <button
                      onClick={() =>
                        requestDelete({
                          type: "chapter",
                          id: ch.id,
                          title: ch.title,
                        })
                      }
                      className="text-[11px] rounded-lg bg-red-100 px-2 py-1 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                    >
                      🗑
                    </button>
                  )}
                </div>

                <div
                  className={classNames(
                    "transition-all duration-200",
                    chExpanded
                      ? "max-h-[1200px] opacity-100"
                      : "max-h-0 overflow-hidden opacity-0",
                  )}
                >
                  {ch.videos.map((v) => {
                    const status = transcriptStatus[v.id] || "missing";
                    const selected = selectedVideos.has(v.id);
                    return (
                      <div
                        key={v.id}
                        className="group flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 border-b border-gray-50 dark:border-white/5 last:border-0"
                      >
                        <span className="text-xs text-gray-400">🎬</span>
                        <span className="flex-1 text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                          {v.title}
                        </span>
                        {showStatus ? <StatusIcon status={status} /> : null}
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 accent-brand"
                          checked={selected}
                          onChange={() => toggleVideo(v.id)}
                        />
                        {showTranscriptControls ? (
                          <button
                            onClick={() => fetchTranscript(v)}
                            disabled={status === "loading"}
                            className="text-[11px] rounded-lg bg-brand px-2.5 py-1 text-white disabled:opacity-50 dark:bg-brandDark"
                            title="جلب النص"
                          >
                            {status === "loading" ? "..." : "جلب النص"}
                          </button>
                        ) : null}
                        {showCopyButton ? (
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(v.transcript || "")
                            }
                            disabled={!v.transcript}
                            className="text-[11px] rounded-lg border border-gray-200 px-2 py-1 text-gray-600 disabled:opacity-40 dark:border-white/10 dark:text-gray-300"
                          >
                            📋 نسخ
                          </button>
                        ) : null}
                        {showExports ? (
                          <>
                            <a
                              href={api.exportVideo(v.id, "pdf")}
                              className="text-[11px] rounded-lg bg-red-100 px-2 py-1 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                              target="_blank"
                              rel="noreferrer"
                            >
                              PDF
                            </a>
                            <a
                              href={api.exportVideo(v.id, "md")}
                              className="text-[11px] rounded-lg bg-gray-100 px-2 py-1 text-gray-600 dark:bg-white/10 dark:text-gray-300"
                              target="_blank"
                              rel="noreferrer"
                            >
                              MD
                            </a>
                          </>
                        ) : null}
                        {showDeleteButtons ? (
                          <button
                            onClick={() =>
                              requestDelete({
                                type: "video",
                                id: v.id,
                                title: v.title,
                              })
                            }
                            className="opacity-0 text-[11px] rounded-lg bg-red-100 px-2 py-1 text-red-600 transition group-hover:opacity-100 dark:bg-red-900/30 dark:text-red-400"
                            title="حذف الفيديو"
                          >
                            🗑
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmInfo(null)}
      />
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === "available") return <span className="text-green-600">✅</span>;
  if (status === "loading")
    return (
      <span className="text-blue-500" title="Loading">
        🔵
      </span>
    );
  if (status === "disabled")
    return (
      <span className="text-gray-400" title="النص غير متاح لهذا الفيديو">
        ⛔
      </span>
    );
  return (
    <span className="text-blue-500" title="Transcript missing">
      🔵
    </span>
  );
}
