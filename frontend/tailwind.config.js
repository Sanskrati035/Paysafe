/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F172A",
        panel: "#0B1220",
        edge: "#1E293B",
        accent: "#22D3EE",
        danger: "#F43F5E",
        warn: "#F59E0B",
        ok: "#34D399",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.15), 0 8px 30px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
