import { useEffect, useState } from "react";
import CourseCard from "../components/CourseCard";
import { api } from "../lib/api";

export default function HomePage() {
  const [courses, setCourses] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listCourses().then(setCourses).catch((e) => setError(e.message));
  }, []);

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold text-lightText dark:text-darkText">Your Courses</h1>
      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.map((course) => (
          <CourseCard key={course.id} course={course} />
        ))}
      </div>
      {!courses.length && !error && <p className="text-lightSecondary dark:text-slate-300">No courses yet. Import one.</p>}
    </section>
  );
}
