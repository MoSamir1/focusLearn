import { useEffect, useRef } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster, toast } from "react-hot-toast";
import Header from "./components/Header";
import HomePage from "./pages/HomePage";
import ImportPage from "./pages/ImportPage";
import CoursePlayerPage from "./pages/CoursePlayerPage";
import TextWorkspace from "./pages/TextWorkspace";
import { useUiStore } from "./store/useUiStore";

export default function App() {
  const { darkMode, language } = useUiStore();

  const offlineToastRef = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [darkMode]);

  useEffect(() => {
    function showOfflineToast() {
      if (offlineToastRef.current) return;
      offlineToastRef.current = toast("لا يوجد اتصال بالإنترنت", {
        icon: "⚠️",
        duration: Infinity,
      });
    }
    function dismissOfflineToast() {
      if (offlineToastRef.current) {
        toast.dismiss(offlineToastRef.current);
        offlineToastRef.current = null;
      }
    }

    if (!navigator.onLine) {
      showOfflineToast();
    }

    const handleOnline = () => dismissOfflineToast();
    const handleOffline = () => showOfflineToast();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      dismissOfflineToast();
    };
  }, []);
  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      className={`${language === "ar" ? "font-cairo" : "font-inter"} min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}
    >
      <Toaster
        position="top-center"
        toastOptions={{
          className:
            "rounded-xl border border-gray-200 bg-white text-gray-900 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100",
        }}
      />
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
  );
}
