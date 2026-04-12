import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CourseCard from "../components/CourseCard";
import { api } from "../lib/api";

export default function HomePage() {
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const data = await api.listCourses();
      setCourses(data);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="animate-fade-in">
      {/* Title bar */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          كورساتي
        </h1>
        <span className="rounded-lg bg-brand/10 px-3 py-1 text-sm font-semibold text-brand dark:text-brandDark">
          {courses.length} كورس
        </span>
      </div>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#111827]"
            />
          ))}
        </div>
      ) : courses.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} onDeleted={refresh} />
          ))}
        </div>
      ) : (
        !error && (
          <div className="mt-8 flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-gray-300 bg-white/60 p-10 text-center dark:border-white/15 dark:bg-white/5">
            <div className="text-5xl">📚</div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                لا توجد كورسات بعد
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                ابدأ رحلتك الآن واستورد أول كورس
              </p>
            </div>
            <Link
              to="/import"
              className="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-white shadow-glow hover:opacity-90 transition"
            >
              استورد أول كورس ←
            </Link>
          </div>
        )
      )}
    </section>
  );
}
