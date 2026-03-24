import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CourseCard from "../components/CourseCard";
import { api } from "../lib/api";

export default function HomePage() {
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const data = await api.listCourses();
      setCourses(data);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        Your Courses
      </h1>
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {courses.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <CourseCard key={course.id} course={course} onDeleted={refresh} />
          ))}
        </div>
      ) : (
        !error && (
          <div className="mt-6 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="text-4xl">📚</div>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
              لا توجد كورسات بعد
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              ابدأ رحلتك واستورد أول كورس للمتابعة.
            </p>
            <Link
              to="/import"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:shadow dark:bg-brandDark"
            >
              استورد أول كورس
            </Link>
          </div>
        )
      )}
    </section>
  );
}
