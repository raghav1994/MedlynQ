import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: { 100: "#1f1f1f", 200: "#555555", 300: "#888888", 400: "#aaaaaa" },
        bone: { 0: "#ffffff", 100: "#fafafa", 200: "#f6f6f4", 300: "#ececea" },
        accent: { DEFAULT: "#c96442", soft: "#fbeee8" },
        good: { DEFAULT: "#1f8a4c", soft: "#e8f5ee" },
        warn: { DEFAULT: "#c98a1f", soft: "#fbf2dc" },
        bad: { DEFAULT: "#c43d3d", soft: "#fbeaea" },
      },
      fontFamily: { sans: ["ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
