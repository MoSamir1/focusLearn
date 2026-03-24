import { Link, NavLink } from "react-router-dom";
import { useUiStore } from "../store/useUiStore";

function navClass({ isActive }) {
  return `px-3 py-2 rounded-xl text-sm ${
    isActive
      ? "bg-brand text-white dark:bg-brandDark dark:text-darkBg"
      : "text-lightSecondary dark:text-slate-300"
  }`;
}

export default function Header() {
  const { darkMode, language, toggleDarkMode, toggleLanguage } = useUiStore();

  return (
    <header className="mb-6 rounded-xl bg-lightCard p-4 shadow-soft dark:bg-darkCard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/"
          className="text-lg font-semibold text-lightText dark:text-darkText"
        >
          Focus Learn
        </Link>
        <nav className="flex items-center gap-2">
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
            className="rounded-xl border px-3 py-2 text-sm dark:border-slate-600"
            onClick={toggleDarkMode}
          >
            {darkMode ? "Light" : "Dark"}
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm dark:border-slate-600"
            onClick={toggleLanguage}
          >
            {language === "en" ? "AR" : "EN"}
          </button>
        </div>
      </div>
    </header>
  );
}
