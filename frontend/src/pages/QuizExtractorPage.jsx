import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";

export default function QuizExtractorPage() {
  const [attemptUrl, setAttemptUrl] = useState("");
  const [sessionCookie, setSessionCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const canSubmit = useMemo(
    () => attemptUrl.trim() && sessionCookie.trim() && !loading,
    [attemptUrl, sessionCookie, loading],
  );

  async function handleExtract() {
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    try {
      const data = await api.extractQuiz({
        attempt_url: attemptUrl.trim(),
        session_cookie: sessionCookie.trim(),
      });
      setResult(data);
      toast.success("تم استخراج أسئلة الاختبار بنجاح");
    } catch (e) {
      setError(e.message);
      toast.error("فشل استخراج الاختبار");
    } finally {
      setLoading(false);
    }
  }

  async function copyMarkdown() {
    if (!result?.markdown) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      toast.success("تم نسخ Markdown");
    } catch {
      toast.error("فشل نسخ Markdown");
    }
  }

  return (
    <section className="space-y-6 text-gray-900 dark:text-gray-100">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700 dark:bg-gray-900">
        <h1 className="mb-4 text-2xl font-semibold">استخرج الاختبار</h1>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={attemptUrl}
            onChange={(e) => setAttemptUrl(e.target.value)}
            placeholder="رابط محاولة الاختبار (attempt.php...)"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <input
            value={sessionCookie}
            onChange={(e) => setSessionCookie(e.target.value)}
            placeholder="MoodleSession Cookie"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={handleExtract}
            disabled={!canSubmit}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-brandDark"
          >
            {loading ? "جاري الاستخراج..." : "استخراج"}
          </button>
          <button
            onClick={copyMarkdown}
            disabled={!result?.markdown}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100"
          >
            نسخ بصيغة MD
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
      </div>

      {result ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-soft dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-3 text-sm text-gray-700 dark:text-gray-200">
            عدد الصفحات: {result.total_pages} • عدد الأسئلة: {result.total_questions}
          </div>
          <div className="space-y-3">
            {result.questions.map((q, idx) => (
              <article
                key={`${q.question_id || idx}-${q.page || 0}`}
                className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {q.number || `سؤال ${idx + 1}`} (Page {q.page ?? 0})
                </h3>
                <p className="mb-2 text-sm text-gray-800 dark:text-gray-200">
                  {q.question}
                </p>
                {q.choices?.length ? (
                  <ul className="list-disc space-y-1 ps-5 text-sm text-gray-700 dark:text-gray-300">
                    {q.choices.map((choice, choiceIdx) => (
                      <li key={`${idx}-${choiceIdx}`}>{choice}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
