import { useState } from "react";
import { Link } from "react-router-dom";
import ConfirmDialog from "./ConfirmDialog";
import { api } from "../lib/api";

export default function CourseCard({ course, onDeleted }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    try {
      await api.deleteCourse(course.id);
      setConfirmOpen(false);
      onDeleted?.();
    } catch (e) {
      setError(e.message);
    }
  }

  const pct = course.progress_percent || 0;

  return (
    <article className="group relative flex flex-col rounded-2xl border border-gray-200/80 bg-white p-5 shadow-soft transition-all hover:shadow-card dark:border-white/10 dark:bg-[#111827]">
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="flex-1 text-base font-bold leading-snug text-gray-900 dark:text-white">
          {course.title}
        </h3>
        <button
          onClick={() => setConfirmOpen(true)}
          className="opacity-0 transition-opacity group-hover:opacity-100 rounded-lg bg-red-100 px-2 py-1 text-xs text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
          title="حذف الكورس"
        >
          🗑
        </button>
      </div>

      {/* Meta info */}
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          🎬 <span>{course.total_videos} فيديو</span>
        </span>
        <span className="flex items-center gap-1">
          ⏱ <span>{course.total_duration_label}</span>
        </span>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">التقدم</span>
          <span className="font-bold text-brand dark:text-brandDark">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-auto flex gap-2">
        <Link
          to={`/courses/${course.id}`}
          className="flex-1 rounded-xl bg-brand py-2 text-center text-sm font-semibold text-white shadow-sm hover:opacity-90 transition"
        >
          فتح الكورس ▶
        </Link>
      </div>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title="حذف الكورس؟"
        message="سيتم حذف جميع بيانات الكورس والـ transcripts. الملفات المحمّلة على جهازك لن تُحذف."
        confirmText="حذف"
        confirmVariant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </article>
  );
}
