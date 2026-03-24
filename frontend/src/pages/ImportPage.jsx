import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function ImportPage() {
  // Input State
  const [courseUrl, setCourseUrl] = useState(() => localStorage.getItem("import_url") || "");
  const [cookie, setCookie] = useState(() => localStorage.getItem("import_cookie") || "");
  const [quality, setQuality] = useState("720");
  const [downloadPath, setDownloadPath] = useState("");
  const [courses, setCourses] = useState([]);
  
  // Selection State
  const [selectedType, setSelectedType] = useState("course");
  const [selectedIds, setSelectedIds] = useState([]);
  
  // Job States
  const [downloadState, setDownloadState] = useState(null);
  const [transcriptState, setTranscriptState] = useState(null);
  
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
      const [coursesData, settings] = await Promise.all([api.listCourses(), api.getSettings()]);
      setCourses(coursesData);
      setDownloadPath(settings.download_path || "");
    } catch (e) {
      console.error("Refresh failed", e);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
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

  function toggleSelection(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function startDownload() {
    setError("");
    try {
      const { job_id } = await api.startDownload({
        target_type: selectedType,
        ids: selectedIds,
        quality,
        download_path: downloadPath,
      });
      const timer = setInterval(async () => {
        const status = await api.getDownloadStatus(job_id);
        setDownloadState(status);
        if (status.status === "done" || status.status === "error") {
          clearInterval(timer);
        }
      }, 1500);
    } catch (e) {
      setError(e.message);
    }
  }

  async function importTranscripts() {
    setTranscriptError("");
    try {
      const { job_id } = await api.importTranscripts({
        target_type: selectedType,
        ids: selectedIds,
      });
      const timer = setInterval(async () => {
        const status = await api.getTranscriptStatus(job_id);
        setTranscriptState(status);
        if (status.status === "done" || status.status === "error") {
          clearInterval(timer);
          await refresh();
        }
      }, 1500);
    } catch (e) {
      setTranscriptError(e.message);
    }
  }

  async function copyToClipboard(courseId) {
    try {
      const res = await fetch(api.exportCourse(courseId, "json"));
      const data = await res.json();
      const text = data.videos.map(v => `${v.title}\n${v.transcript || "No transcript"}`).join("\n\n");
      await navigator.clipboard.writeText(text);
      alert("Copied structures & transcripts to clipboard!");
    } catch (e) {
      alert("Failed to copy: " + e.message);
    }
  }

  return (
    <section className="space-y-6">
      {/* Import Section */}
      <div className="rounded-xl bg-lightCard p-5 shadow-soft dark:bg-darkCard">
        <h2 className="mb-3 text-xl font-semibold text-lightText dark:text-darkText">1. Import Course Structure</h2>
        <div className="grid gap-3">
          <input
            value={courseUrl}
            onChange={(e) => setCourseUrl(e.target.value)}
            placeholder="Course URL (e.g. Mahara-Tech course or HVP link)"
            className="rounded-xl border bg-transparent px-3 py-2 dark:border-slate-600 w-full"
          />
          <textarea
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="MoodleSession Cookie (required for private content)"
            className="min-h-24 rounded-xl border bg-transparent px-3 py-2 dark:border-slate-600 w-full"
          />
          <button onClick={importCourse} className="w-fit rounded-xl bg-brand px-6 py-2 text-white font-medium dark:bg-brandDark dark:text-darkBg hover:opacity-90 transition">
            Import Structure
          </button>
        </div>
      </div>

      {/* Management & Export Section */}
      <div className="rounded-xl bg-lightCard p-5 shadow-soft dark:bg-darkCard">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h2 className="text-xl font-semibold text-lightText dark:text-darkText">2. Manage & Export Transcripts</h2>
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1">
            {["course", "chapter", "video"].map((type) => (
              <button
                key={type}
                onClick={() => {
                  setSelectedType(type);
                  setSelectedIds([]);
                }}
                className={`rounded-lg px-4 py-1.5 text-xs font-medium capitalize transition ${selectedType === type ? "bg-brand text-white shadow-md" : "text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6 max-h-80 overflow-auto rounded-xl border p-4 dark:border-slate-700 space-y-4">
          {courses.map((course) => (
            <div key={course.id} className="rounded-xl border p-4 dark:border-slate-800 bg-white/50 dark:bg-black/10">
               <SelectableTree courseId={course.id} selectedType={selectedType} selectedIds={selectedIds} onToggle={toggleSelection} />
               <div className="mt-3 pt-3 border-t dark:border-slate-700 flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-auto">Course ID: {course.id}</span>
                  <div className="flex gap-1">
                    <a href={api.exportCourse(course.id, "pdf")} target="_blank" rel="noreferrer" className="text-[10px] font-bold bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition">PDF</a>
                    <a href={api.exportCourse(course.id, "md")} target="_blank" rel="noreferrer" className="text-[10px] font-bold bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition">MD</a>
                    <a href={api.exportCourse(course.id, "json")} target="_blank" rel="noreferrer" className="text-[10px] font-bold bg-slate-500 text-white px-3 py-1 rounded hover:bg-slate-600 transition">JSON</a>
                    <button onClick={() => copyToClipboard(course.id)} className="text-[10px] font-bold bg-emerald-500 text-white px-3 py-1 rounded hover:bg-emerald-600 transition">COPY</button>
                  </div>
               </div>
            </div>
          ))}
          {!courses.length && <p className="text-center py-8 text-slate-400">No courses imported yet. Start by importing a URL above.</p>}
        </div>

        {/* Action Controls */}
        <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Transcript Actions</h3>
              <button 
                onClick={importTranscripts} 
                disabled={transcriptState?.status === "running"}
                className="w-full rounded-xl bg-brand py-3 text-white font-bold shadow-lg shadow-brand/20 dark:bg-brandDark dark:text-darkBg hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-50"
              >
                {transcriptState?.status === "running" ? `FETCHING... ${transcriptState.progress}%` : "IMPORT SELECTED TRANSCRIPTS"}
              </button>
              
              {transcriptState && (
                <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border dark:border-slate-700">
                   <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden mb-2">
                      <div className="bg-brand h-full transition-all duration-300" style={{ width: `${transcriptState.progress}%` }} />
                   </div>
                   <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      {transcriptState.status === "done" ? "✅ All transcripts fetched and saved!" : 
                       transcriptState.status === "error" ? `❌ Error: ${transcriptState.message}` : 
                       `⏳ Processing: ${transcriptState.done} / ${transcriptState.total} videos`}
                   </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Video Downloads</h3>
              <div className="flex gap-2">
                <select value={quality} onChange={(e) => setQuality(e.target.value)} className="rounded-xl border bg-white dark:bg-slate-800 px-3 py-2 dark:border-slate-600 text-sm">
                  <option value="360">360p</option>
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
                </select>
                <input
                  value={downloadPath}
                  onChange={(e) => setDownloadPath(e.target.value)}
                  placeholder="Download Path"
                  className="flex-1 rounded-xl border bg-white dark:bg-slate-800 px-3 py-2 dark:border-slate-600 text-sm"
                />
              </div>
              <button onClick={startDownload} className="w-full rounded-xl border-2 border-slate-300 dark:border-slate-600 py-3 text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                DOWNLOAD SELECTED VIDEOS
              </button>
              
              {downloadState && (
                <p className="text-xs font-medium text-slate-500 text-center">
                  DL Status: <span className="text-brand">{downloadState.status} ({downloadState.progress}%)</span>
                </p>
              )}
            </div>
        </div>

        {error && <p className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-xs border border-red-100">{error}</p>}
        {transcriptError && <p className="mt-4 p-3 rounded-lg bg-red-50 text-red-600 text-xs border border-red-100">{transcriptError}</p>}
      </div>
    </section>
  );
}

function SelectableTree({ courseId, selectedType, selectedIds, onToggle }) {
  const [course, setCourse] = useState(null);

  useEffect(() => {
    api.getCourse(courseId).then(setCourse).catch(() => setCourse(null));
  }, [courseId]);

  if (!course) return <div className="animate-pulse flex space-x-4"><div className="flex-1 space-y-4 py-1"><div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div></div></div>;

  return (
    <div className="space-y-2">
      <label className="flex items-center group cursor-pointer">
        <input
          type="checkbox"
          disabled={selectedType !== "course"}
          checked={selectedIds.includes(course.id)}
          onChange={() => onToggle(course.id)}
          className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand mr-3"
        />
        <span className="font-bold text-slate-700 dark:text-slate-200 group-hover:text-brand transition">{course.title}</span>
      </label>
      
      <div className="ml-7 space-y-3 border-l-2 border-slate-100 dark:border-slate-800 pl-4 py-1">
        {course.chapters.map((ch) => (
          <div key={ch.id} className="space-y-1">
            <label className="flex items-center group cursor-pointer">
              <input
                type="checkbox"
                disabled={selectedType !== "chapter"}
                checked={selectedIds.includes(ch.id)}
                onChange={() => onToggle(ch.id)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-brand focus:ring-brand mr-2.5"
              />
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 group-hover:text-brand transition">{ch.title}</span>
            </label>
            
            <div className="ml-6 flex flex-col gap-1">
              {ch.videos.map((v) => (
                <label key={v.id} title={v.transcript ? "Transcript available" : "No transcript yet"} className="flex items-center group cursor-pointer py-0.5">
                  <input
                    type="checkbox"
                    disabled={selectedType !== "video"}
                    checked={selectedIds.includes(v.id)}
                    onChange={() => onToggle(v.id)}
                    className="w-3 h-3 rounded border-slate-300 text-brand focus:ring-brand mr-2"
                  />
                  <span className={`text-xs ${v.transcript ? "text-slate-500 font-medium" : "text-slate-400 italic"} group-hover:text-brand transition`}>
                    {v.title} {v.transcript ? "✅" : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
