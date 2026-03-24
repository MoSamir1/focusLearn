import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import CollapsibleCourseTree from "../components/CollapsibleCourseTree";
import { api } from "../lib/api";

export default function ImportPage() {
  // Input State
  const [courseUrl, setCourseUrl] = useState(
    () => localStorage.getItem("import_url") || "",
  );
  const [cookie, setCookie] = useState(
    () => localStorage.getItem("import_cookie") || "",
  );
  const [quality, setQuality] = useState("720");
  const [downloadPath, setDownloadPath] = useState("");
  const [courses, setCourses] = useState([]);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  // Selection State
  const [selectedVideosTranscript, setSelectedVideosTranscript] = useState(
    () => new Set(),
  );
  const [selectedVideosDownload, setSelectedVideosDownload] = useState(
    () => new Set(),
  );

  // Job States
  const [downloadState, setDownloadState] = useState(null);
  const [transcriptState, setTranscriptState] = useState(null);
  const downloadTimerRef = useRef(null);
  const downloadNotifiedRef = useRef(false);

  // Error States
  const [error, setError] = useState("");
  const [transcriptError, setTranscriptError] = useState("");

  // Persistence
  useEffect(() => {
    localStorage.setItem("import_url", courseUrl);
  }, [courseUrl]);

  useEffect(() => {
    localStorage.setItem("import_cookie", cookie);
  }, [cookie]);

  async function refresh() {
    try {
      const [coursesData, settings] = await Promise.all([
        api.listCourses(),
        api.getSettings(),
      ]);
      setCourses(coursesData);
      setDownloadPath(settings.download_path || "");
      setTreeRefreshKey(Date.now());
    } catch (e) {
      console.error("Refresh failed", e);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    return () => {
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current);
      }
    };
  }, []);

  // Handlers
  async function importCourse() {
    setError("");
    try {
      await api.importCourse({ course_url: courseUrl, cookie: cookie || null });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function startDownload() {
    setError("");
    const ids = Array.from(selectedVideosDownload);
    if (!ids.length) {
      setError("Select at least one video.");
      return;
    }
    try {
      downloadNotifiedRef.current = false;
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current);
      }
      setDownloadState({
        status: "running",
        progress: 0,
        message: "Starting...",
      });
      const { job_id } = await api.startDownload({
        video_ids: ids,
        quality,
        save_path: downloadPath,
      });
      setDownloadState((prev) => ({ ...(prev || {}), job_id }));
      downloadTimerRef.current = setInterval(async () => {
        const status = await api.getDownloadStatus(job_id);
        setDownloadState(status);
        if (
          status.status === "done" ||
          status.status === "error" ||
          status.status === "canceled"
        ) {
          clearInterval(downloadTimerRef.current);
          downloadTimerRef.current = null;
          if (!downloadNotifiedRef.current) {
            if (status.status === "done") {
              const title = status.current_title || "الفيديوهات المختارة";
              toast.success(`تم تحميل الفيديو: ${title}`);
            } else if (status.status === "error") {
              toast.error(`فشل التحميل: ${status.message || "غير معروف"}`);
            }
            downloadNotifiedRef.current = true;
          }
          refresh();
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
      setDownloadState((prev) => ({
        ...(prev || {}),
        status: "canceled",
        message: "Cancel requested",
      }));
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current);
        downloadTimerRef.current = null;
      }
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function importTranscripts() {
    setTranscriptError("");
    setTranscriptState({ status: "running", progress: 0, done: 0, total: 0 });
    const ids = Array.from(selectedVideosTranscript);
    if (!ids.length) {
      setTranscriptError("Select at least one video.");
      setTranscriptState(null);
      return;
    }
    try {
      const { job_id } = await api.importTranscripts({
        target_type: "video",
        ids,
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
          await refresh();
        }
      }, 1500);
    } catch (e) {
      setTranscriptError(e.message);
      toast.error(`فشل جلب النص: ${e.message}`);
    }
  }

  async function copyToClipboard(courseId) {
    try {
      const res = await fetch(api.exportCourse(courseId, "json"));
      const data = await res.json();
      const text = data.videos
        .map((v) => `${v.title}\n${v.transcript || "No transcript"}`)
        .join("\n\n");
      await navigator.clipboard.writeText(text);
      alert("Copied structures & transcripts to clipboard!");
    } catch (e) {
      alert("Failed to copy: " + e.message);
    }
  }

  return (
    <section className="space-y-6 text-gray-900 dark:text-gray-100">
      {/* 1. Import Course Structure */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100">
          1. Import Course Structure
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={courseUrl}
            onChange={(e) => setCourseUrl(e.target.value)}
            placeholder="Course URL (Mahara / YouTube)"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="MoodleSession Cookie (for private content)"
            className="min-h-24 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={importCourse}
            className="rounded-xl bg-brand px-6 py-2 text-white font-medium hover:opacity-90 transition dark:bg-brandDark"
          >
            Import Structure ▶
          </button>
        </div>
      </div>

      {/* 2. Transcripts */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            2. Transcripts
          </h2>
          <button
            onClick={importTranscripts}
            disabled={transcriptState?.status === "running"}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-brandDark"
          >
            Fetch Selected ▶
          </button>
        </div>
        <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">
          Selected videos: {selectedVideosTranscript.size}
        </p>
        <div className="mb-4 max-h-80 overflow-auto space-y-3">
          {courses.map((course) => (
            <CollapsibleCourseTree
              key={`trans-${course.id}`}
              course={course}
              refreshKey={treeRefreshKey}
              selectedVideos={selectedVideosTranscript}
              setSelectedVideos={setSelectedVideosTranscript}
              onCourseRefresh={refresh}
              showTranscriptControls={true}
              showStatus={true}
              showExports={true}
            />
          ))}
          {!courses.length && (
            <p className="py-6 text-center text-gray-500 dark:text-gray-300">
              No courses imported yet. Start by importing a URL above.
            </p>
          )}
        </div>
        {transcriptState && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full bg-brand transition-all duration-300"
                style={{ width: `${transcriptState.progress}%` }}
              />
            </div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
              {transcriptState.status === "done"
                ? "✅ All transcripts fetched and saved!"
                : transcriptState.status === "error"
                  ? `❌ Error: ${transcriptState.message}`
                  : `⏳ Processing: ${transcriptState.done || 0} / ${transcriptState.total || "?"} videos`}
            </p>
          </div>
        )}
      </div>

      {/* 3. Download Videos */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100">
          3. Download Videos
        </h2>
        <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">
          Selected videos: {selectedVideosDownload.size}
        </p>
        <div className="mb-4 max-h-80 overflow-auto space-y-3">
          {courses.map((course) => (
            <CollapsibleCourseTree
              key={`dl-${course.id}`}
              course={course}
              refreshKey={treeRefreshKey}
              selectedVideos={selectedVideosDownload}
              setSelectedVideos={setSelectedVideosDownload}
              onCourseRefresh={refresh}
              showTranscriptControls={false}
              showStatus={true}
              showExports={false}
              statusKind="download"
            />
          ))}
          {!courses.length && (
            <p className="py-6 text-center text-gray-500 dark:text-gray-300">
              No courses imported yet. Start by importing a URL above.
            </p>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <div>
            <h3 className="mb-2 text-sm font-bold text-gray-800 dark:text-gray-100">
              Download Settings
            </h3>
            <div className="mb-3 flex flex-wrap gap-2">
              {["360", "480", "720", "1080"].map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 ${
                    quality === q
                      ? "bg-brand text-white dark:bg-brandDark"
                      : "bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  }`}
                >
                  {q}p
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <div className="flex-1 flex items-center gap-2">
                <input
                  value={downloadPath}
                  onChange={(e) => setDownloadPath(e.target.value)}
                  placeholder="/home/user/Downloads"
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:text-gray-100"
                  title="Folder picker not available in browser"
                >
                  📁
                </button>
              </div>
            </div>
          </div>

          {downloadState && (
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                <div
                  className="h-full bg-brand transition-all duration-300"
                  style={{ width: `${downloadState.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-200">
                {downloadState.status} ({downloadState.progress}%)
                {downloadState.message ? ` — ${downloadState.message}` : ""}
                {downloadState.current_title
                  ? ` — ${downloadState.current_title}`
                  : ""}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {downloadState?.status === "running" ||
            downloadState?.status === "queued" ? (
              <button
                onClick={cancelDownload}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                Cancel
              </button>
            ) : null}
            <button
              onClick={startDownload}
              className="rounded-xl bg-brand px-6 py-2 text-white font-semibold hover:opacity-90 transition dark:bg-brandDark"
            >
              DOWNLOAD SELECTED VIDEOS ▶
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {error}
          </p>
        )}
        {transcriptError && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
            {transcriptError}
          </p>
        )}
      </div>
    </section>
  );
}
