import { create } from "zustand";

export const useUiStore = create((set) => ({
  darkMode: false,
  language: "en",
  toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
  toggleLanguage: () => set((s) => ({ language: s.language === "en" ? "ar" : "en" })),
}));
