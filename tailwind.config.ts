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
          50: "#faf5ec",
          100: "#f0e3c7",
          200: "#e1c89a",
          300: "#cda972",
          400: "#b78c52",
          500: "#a17e4c",
          600: "#8a6a3f",
          700: "#6f5532",
          800: "#574128",
          900: "#3e2f1d",
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
