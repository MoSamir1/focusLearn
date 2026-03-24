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

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="flex-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {course.title}
        </h3>
        <button
          onClick={() => setConfirmOpen(true)}
          className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
          title="حذف الكورس"
        >
          🗑
        </button>
      </div>
      <p className="mb-1 text-sm text-gray-700 dark:text-gray-200">
        Videos: {course.total_videos}
      </p>
      <p className="mb-1 text-sm text-gray-700 dark:text-gray-200">
        Duration: {course.total_duration_label}
      </p>
      <p className="mb-4 text-sm text-gray-700 dark:text-gray-200">
        Progress: {course.progress_percent}%
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/courses/${course.id}`}
          className="rounded-xl bg-brand px-4 py-2 text-sm text-white dark:bg-brandDark"
        >
          Open
        </Link>
        <Link
          to={`/courses/${course.id}`}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-800 dark:border-gray-700 dark:text-gray-100"
        >
          Export
        </Link>
      </div>
      {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
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
