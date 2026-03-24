import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useUiStore } from "../store/useUiStore";

function navClass({ isActive }) {
  return `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-brand text-white shadow-sm dark:bg-brandDark dark:text-gray-100"
      : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
  }`;
}

export default function Header() {
  const { darkMode, language, toggleDarkMode, toggleLanguage } = useUiStore();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-soft dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Focus Learn
        </Link>

        <button
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-xl text-gray-700 hover:bg-gray-100 md:hidden dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? "✕" : "☰"}
        </button>

        <nav
          className={`flex flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-center md:gap-2 ${
            menuOpen ? "mt-3" : "hidden md:flex"
          }`}
        >
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/courses" className={navClass}>
            Courses
          </NavLink>
          <NavLink to="/import" className={navClass}>
            Import
          </NavLink>
          <NavLink to="/workspace" className={navClass}>
            مساحة النصوص 📝
          </NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-lg shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            onClick={toggleDarkMode}
            aria-label="Toggle dark mode"
            title={darkMode ? "الوضع الفاتح" : "الوضع الداكن"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition shadow-sm ${
              language === "ar"
                ? "border-brand bg-brand/10 text-brand dark:border-brandDark dark:bg-brandDark/20 dark:text-brandDark"
                : "border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
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
