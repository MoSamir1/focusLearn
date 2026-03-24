import { Link } from "react-router-dom";

export default function CourseCard({ course }) {
  return (
    <article className="rounded-xl bg-lightCard p-5 shadow-soft dark:bg-darkCard">
      <h3 className="mb-2 text-lg font-semibold text-lightText dark:text-darkText">{course.title}</h3>
      <p className="mb-1 text-sm text-lightSecondary dark:text-slate-300">Videos: {course.total_videos}</p>
      <p className="mb-1 text-sm text-lightSecondary dark:text-slate-300">Duration: {course.total_duration_label}</p>
      <p className="mb-4 text-sm text-lightSecondary dark:text-slate-300">Progress: {course.progress_percent}%</p>
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/courses/${course.id}`}
          className="rounded-xl bg-brand px-4 py-2 text-sm text-white dark:bg-brandDark dark:text-darkBg"
        >
          Open
        </Link>
        <Link to={`/courses/${course.id}`} className="rounded-xl border px-4 py-2 text-sm dark:border-slate-600">
          Export
        </Link>
      </div>
    </article>
  );
}
