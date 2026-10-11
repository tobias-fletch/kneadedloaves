import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        crust: "rgb(var(--color-crust-rgb) / <alpha-value>)",
        crumb: "rgb(var(--color-crumb-rgb) / <alpha-value>)",
        butter: "rgb(var(--color-butter-rgb) / <alpha-value>)",
        jam: "rgb(var(--color-jam-rgb) / <alpha-value>)",
        sage: "rgb(var(--color-sage-rgb) / <alpha-value>)",
        ink: "rgb(var(--color-ink-rgb) / <alpha-value>)",
        page: "rgb(var(--color-page-rgb) / <alpha-value>)"
      },
      boxShadow: {
        soft: "0 18px 60px rgba(45, 33, 27, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
