import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useUiStore = create(
  persist(
    (set) => ({
      darkMode: true,
      language: "ar",
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      toggleLanguage: () =>
        set((s) => ({ language: s.language === "en" ? "ar" : "en" })),
    }),
    {
      name: "focuslearn-ui",
    },
  ),
);
