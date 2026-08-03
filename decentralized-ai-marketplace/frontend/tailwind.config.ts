import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111217",
        paper: "#f8f7f2",
        coral: "#f36b53",
        violet: "#7259e8",
        mint: "#cfe9d6"
      },
      boxShadow: { card: "0 14px 44px rgba(17, 18, 23, 0.08)" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] }
    }
  },
  plugins: []
};

export default config;
