const API_BASE = "http://localhost:8000";

async function req(path, options = {}) {
  const { headers: customHeaders, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(customHeaders || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Request failed");
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.blob();
}

export const api = {
  baseURL: API_BASE,
  listCourses: () => req("/courses"),
  getCourse: (id) => req(`/courses/${id}`),
  importCourse: (payload) =>
    req("/import-course", { method: "POST", body: JSON.stringify(payload) }),
  setVideoCompletion: (id, completed) =>
    req(`/videos/${id}/completion`, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    }),
  setChapterCompletion: (id, completed) =>
    req(`/chapters/${id}/completion`, {
      method: "PATCH",
      body: JSON.stringify({ completed }),
    }),
  getSettings: () => req("/settings"),
  startDownload: (payload) =>
    req("/api/downloads/start", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getDownloadStatus: (jobId) => req(`/api/downloads/${jobId}`),
  cancelDownload: (jobId) =>
    req(`/api/downloads/${jobId}/cancel`, { method: "POST" }),
  importTranscripts: (payload) =>
    req("/transcripts/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getTranscriptStatus: (jobId) => req(`/transcripts/status/${jobId}`),
  fetchVideoTranscript: (videoId) =>
    req(`/videos/${videoId}/fetch-transcript`, { method: "POST" }),
  fetchChapterTranscripts: (chapterId) =>
    req(`/chapters/${chapterId}/fetch-transcripts`, { method: "POST" }),
  fetchCourseTranscripts: (courseId) =>
    req(`/courses/${courseId}/fetch-transcripts`, { method: "POST" }),
  exportVideo: (videoId, fmt) =>
    `${API_BASE}/videos/${videoId}/export?fmt=${fmt}`,
  exportCourse: (courseId, fmt) =>
    `${API_BASE}/courses/${courseId}/export?fmt=${fmt}`,
  exportChapter: (chapterId, fmt) =>
    `${API_BASE}/chapters/${chapterId}/export?fmt=${fmt}`,
  linkLocalVideo: (videoId, filePath) =>
    req(`/api/videos/${videoId}/link-local`, {
      method: "POST",
      body: JSON.stringify({ file_path: filePath }),
    }),
  deleteCourse: (courseId) =>
    req(`/api/courses/${courseId}`, { method: "DELETE" }),
  deleteChapter: (chapterId) =>
    req(`/api/chapters/${chapterId}`, { method: "DELETE" }),
  deleteVideo: (videoId) => req(`/api/videos/${videoId}`, { method: "DELETE" }),
};
