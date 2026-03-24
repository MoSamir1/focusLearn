import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";

export default function CoursePlayerPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const data = await api.getCourse(courseId);
      setCourse(data);
      if (!activeVideoId && data.chapters?.length && data.chapters[0].videos?.length) {
        setActiveVideoId(data.chapters[0].videos[0].id);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [courseId]);

  const flatVideos = useMemo(() => {
    if (!course) return [];
    return course.chapters.flatMap((ch) => ch.videos);
  }, [course]);

  const activeIndex = flatVideos.findIndex((v) => v.id === activeVideoId);
  const activeVideo = activeIndex >= 0 ? flatVideos[activeIndex] : null;

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
    const res = await api.exportVideo(activeVideo.id, fmt);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `transcript.${fmt}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (!course) {
    return <p className="text-lightSecondary dark:text-slate-300">{error || "Loading..."}</p>;
  }

  return (
    <div>
      <button onClick={() => navigate("/")} className="mb-4 rounded-xl border px-3 py-2 text-sm dark:border-slate-600">
        Back
      </button>
      <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
        <aside className="max-h-[80vh] overflow-auto rounded-xl bg-lightCard p-4 shadow-soft dark:bg-darkCard">
          {course.chapters.map((ch) => (
            <div key={ch.id} className="mb-4">
              <label className="mb-2 block font-semibold text-lightText dark:text-darkText">
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={ch.completed}
                  onChange={(e) => toggleChapter(ch.id, e.target.checked)}
                />
                {ch.title} ({ch.total_duration_label})
              </label>
              {ch.videos.map((v) => (
                <label
                  key={v.id}
                  className={`mb-1 block cursor-pointer rounded-xl px-2 py-1 text-sm ${
                    activeVideoId === v.id ? "bg-brand/10 dark:bg-brandDark/20" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={v.completed}
                    onChange={(e) => toggleVideo(v.id, e.target.checked)}
                    className="mr-2"
                  />
                  <button className="text-left" onClick={() => setActiveVideoId(v.id)}>
                    {v.title} ({v.duration_label})
                  </button>
                </label>
              ))}
            </div>
          ))}
        </aside>

        <main className="rounded-xl bg-lightCard p-4 shadow-soft dark:bg-darkCard">
          {activeVideo ? (
            <>
              <div className="aspect-video overflow-hidden rounded-xl">
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube.com/embed/${activeVideo.youtube_id}`}
                  title={activeVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
              <div className="my-3 flex gap-2">
                <button
                  disabled={activeIndex <= 0}
                  onClick={() => setActiveVideoId(flatVideos[activeIndex - 1].id)}
                  className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-600"
                >
                  Previous video
                </button>
                <button
                  disabled={activeIndex < 0 || activeIndex >= flatVideos.length - 1}
                  onClick={() => setActiveVideoId(flatVideos[activeIndex + 1].id)}
                  className="rounded-xl border px-3 py-2 text-sm disabled:opacity-40 dark:border-slate-600"
                >
                  Next video
                </button>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-lightText dark:text-darkText">{activeVideo.title}</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                <button onClick={() => navigator.clipboard.writeText(activeVideo.transcript || "")} className="rounded-xl border px-3 py-2 text-sm dark:border-slate-600">
                  Copy
                </button>
                <button onClick={() => exportTranscript("md")} className="rounded-xl border px-3 py-2 text-sm dark:border-slate-600">
                  Download MD
                </button>
                <button onClick={() => exportTranscript("pdf")} className="rounded-xl border px-3 py-2 text-sm dark:border-slate-600">
                  Download PDF
                </button>
                <button onClick={() => exportTranscript("json")} className="rounded-xl border px-3 py-2 text-sm dark:border-slate-600">
                  Download JSON
                </button>
              </div>
              <article className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border p-4 text-sm leading-7 dark:border-slate-600">
                {activeVideo.transcript || "Transcript not available."}
              </article>
            </>
          ) : (
            <p className="text-lightSecondary dark:text-slate-300">No video selected.</p>
          )}
        </main>
      </div>
    </div>
  );
}
