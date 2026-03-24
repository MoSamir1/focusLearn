/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        xl: "1rem",
      },
      boxShadow: {
        soft: "0 4px 20px rgba(15, 23, 42, 0.08)",
      },
      colors: {
        lightBg: "#F8FAFC",
        lightCard: "#FFFFFF",
        lightText: "#1E293B",
        lightSecondary: "#64748B",
        darkBg: "#0F172A",
        darkCard: "#1E293B",
        darkText: "#E2E8F0",
        brand: "#3B82F6",
        brandDark: "#60A5FA",
      },
      fontFamily: {
        inter: ["Inter", "sans-serif"],
        cairo: ["Cairo", "sans-serif"],
      },
    },
  },
  plugins: [],
};
