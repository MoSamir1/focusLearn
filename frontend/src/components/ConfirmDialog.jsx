export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "تأكيد",
  cancelText = "إلغاء",
  confirmVariant = "primary",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const confirmClass =
    confirmVariant === "destructive"
      ? "bg-red-500 text-white hover:bg-red-600"
      : "bg-brand text-white hover:opacity-90 dark:bg-brandDark";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm animate-slide-up rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card dark:border-white/10 dark:bg-[#1a1f35]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-2xl">
          {confirmVariant === "destructive" ? "🗑" : "❓"}
        </div>
        <h3 className="mb-2 text-base font-bold text-gray-900 dark:text-white">
          {title}
        </h3>
        <p className="mb-5 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${confirmClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
