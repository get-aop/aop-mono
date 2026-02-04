/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Foundation
        "aop-black": "#0A0A0B",
        "aop-darkest": "#101012",
        "aop-dark": "#18181B",
        "aop-charcoal": "#27272A",

        // Content
        "aop-cream": "#FAFAF9",
        "aop-off-white": "#F4F4F5",
        "aop-warm-gray": "#E4E4E7",

        // Neutral
        "aop-slate": {
          DEFAULT: "#71717A",
          dark: "#52525B",
          light: "#A1A1AA",
        },

        // Accent
        "aop-amber": {
          DEFAULT: "#D97706",
          light: "#F59E0B",
          muted: "#B45309",
        },

        // Status
        "aop-success": "#059669",
        "aop-working": "#2563EB",
        "aop-blocked": "#DC2626",
      },
      fontFamily: {
        display: ["Jura", "system-ui", "sans-serif"],
        body: ["Instrument Sans", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      fontSize: {
        "display-xl": ["200px", { lineHeight: "1", letterSpacing: "0.1em" }],
        "display-lg": ["80px", { lineHeight: "1", letterSpacing: "0.05em" }],
        "display-md": ["56px", { lineHeight: "1.1", letterSpacing: "0.03em" }],
        "display-sm": ["40px", { lineHeight: "1.2", letterSpacing: "0.02em" }],
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
      borderRadius: {
        aop: "4px",
        "aop-lg": "8px",
      },
      animation: {
        pulse: "pulse 2s ease-in-out infinite",
        shimmer: "shimmer 2s ease-in-out infinite",
        "spin-slow": "spin 3s linear infinite",
      },
      keyframes: {
        pulse: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};
