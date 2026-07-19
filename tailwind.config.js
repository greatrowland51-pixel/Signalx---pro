/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        serifTheme: ["'Cormorant Garamond'", "serif"],
        mono: ["'JetBrains Mono'", "monospace"],
        sansTheme: ["'Sora'", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px -10px var(--glow-color)",
      },
    },
  },
  plugins: [],
};
