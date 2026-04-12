import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useUiStore } from "../store/useUiStore";

function navClass({ isActive }) {
  return `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
    isActive
      ? "bg-brand text-white shadow-glow"
      : "text-gray-600 hover:bg-gray-200/70 dark:text-gray-300 dark:hover:bg-white/10"
  }`;
}

export default function Header() {
  const { darkMode, language, toggleDarkMode, toggleLanguage } = useUiStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="mb-5 rounded-2xl border border-gray-200/80 bg-white/90 backdrop-blur px-4 py-3 shadow-soft dark:border-white/10 dark:bg-[#111827]/90">
      <div className="flex items-center justify-between gap-3">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white text-sm shadow-glow">
            F
          </span>
          <span>Focus Learn</span>
        </Link>

        {/* Mobile menu button */}
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 md:hidden dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/10"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? "✕" : "☰"}
        </button>

        {/* Nav links */}
        <nav
          className={`flex flex-1 flex-col gap-1 md:flex-row md:items-center md:justify-center md:gap-1 ${
            menuOpen ? "mt-3" : "hidden md:flex"
          }`}
        >
          <NavLink to="/" end className={navClass}>
            🏠 <span>الرئيسية</span>
          </NavLink>
          <NavLink to="/import" className={navClass}>
            📥 <span>استيراد</span>
          </NavLink>
          <NavLink to="/downloads" className={navClass}>
            ⬇️ <span>التحميل</span>
          </NavLink>
          <NavLink to="/workspace" className={navClass}>
            📝 <span>النصوص</span>
          </NavLink>
          <NavLink to="/quiz-extractor" className={navClass}>
            🧪 <span>الاختبارات</span>
          </NavLink>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-base hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/10"
            onClick={toggleDarkMode}
            aria-label="Toggle dark mode"
            title={darkMode ? "الوضع الفاتح" : "الوضع الداكن"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <button
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
              language === "ar"
                ? "border-brand bg-brand/10 text-brand dark:border-brandDark dark:text-brandDark"
                : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"
            }`}
            onClick={toggleLanguage}
            aria-label="Toggle language"
          >
            {language === "en" ? "AR" : "EN"}
          </button>
        </div>
      </div>
    </header>
  );
}
