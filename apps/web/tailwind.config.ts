import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))", muted: "hsl(var(--muted))", "muted-foreground": "hsl(var(--muted-foreground))",
        primary: "hsl(var(--primary))", "primary-foreground": "hsl(var(--primary-foreground))",
        border: "hsl(var(--border))", input: "hsl(var(--border))", ring: "hsl(var(--primary))",
        destructive: "hsl(var(--destructive))",
      },
      borderRadius: { lg: "0.875rem", md: "0.625rem", sm: "0.375rem" },
      boxShadow: { panel: "0 2px 12px rgba(15,23,42,0.035)" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
