import { Navigate, Route, Routes } from "react-router-dom";
import Header from "./components/Header";
import HomePage from "./pages/HomePage";
import ImportPage from "./pages/ImportPage";
import CoursePlayerPage from "./pages/CoursePlayerPage";
import TextWorkspace from "./pages/TextWorkspace";
import { useUiStore } from "./store/useUiStore";

export default function App() {
  const { darkMode, language } = useUiStore();
  return (
    <div className={`${darkMode ? "dark" : ""}`}>
      <div
        dir={language === "ar" ? "rtl" : "ltr"}
        className={`${language === "ar" ? "font-cairo" : "font-inter"} min-h-screen bg-lightBg text-lightText dark:bg-darkBg dark:text-darkText`}
      >
        <div className="mx-auto max-w-7xl p-4">
          <Header />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/courses" element={<HomePage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/courses/:courseId" element={<CoursePlayerPage />} />
            <Route path="/workspace" element={<TextWorkspace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
