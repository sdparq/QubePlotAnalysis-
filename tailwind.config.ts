import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          DEFAULT: "#0e0e0e",
          900: "#0e0e0e",
          800: "#1a1a1a",
          700: "#2a2a2a",
          500: "#6b6b6b",
          400: "#8a8a8a",
          300: "#b8b5ad",
          200: "#dcd8d0",
          100: "#ece8e1",
        },
        bone: {
          DEFAULT: "#f6f4ee",
          50: "#fbfaf6",
          100: "#f6f4ee",
          200: "#ede9df",
        },
        qube: {
          50: "#f1f4ee",
          100: "#dde5d4",
          200: "#bccab0",
          300: "#9aae8c",
          400: "#7d9670",
          500: "#647d57",
          600: "#506646",
          700: "#405238",
          800: "#33422e",
          900: "#243121",
        },
      },
      letterSpacing: {
        wordmark: "0.32em",
      },
    },
  },
  plugins: [],
};

export default config;
