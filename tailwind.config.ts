/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // ============================================================
      // Pulse 调色板（通过 CSS 变量实现暗色/浅色双主题切换）
      // 变量值定义在 src/index.css 中
      // ============================================================
      colors: {
        pulse: {
          // 背景层级：最深 → 表面 → 隆起 → 悬停 → 边框
          deepest: "var(--pulse-deepest)",
          surface: "var(--pulse-surface)",
          elevated: "var(--pulse-elevated)",
          hover: "var(--pulse-hover)",
          border: "var(--pulse-border)",
          // 强调色（琥珀金）
          accent: "var(--pulse-accent)",
          "accent-soft": "var(--pulse-accent-soft)",
          "accent-dim": "var(--pulse-accent-dim)",
          // 语义色（双主题保持不变）
          indigo: "#6366F1",
          blue: "#60A5FA",
          teal: "#2DD4BF",
          rose: "#FB7185",
          emerald: "#34D399",
          amber: "#FBBF24",
          sky: "#38BDF8",
          purple: "#A78BFA",
          // 文字层级：主要 → 次要 → 弱化
          text: {
            primary: "var(--pulse-text-primary)",
            secondary: "var(--pulse-text-secondary)",
            muted: "var(--pulse-text-muted)",
          },
        },
        // HTTP 方法颜色
        method: {
          get: "#2DD4BF",
          post: "#60A5FA",
          put: "#F0B429",
          patch: "#A78BFA",
          "delete": "#FB7185",
          head: "#34D399",
          options: "#94A3B8",
        },
      },
      // 字体：Inter（无衬线）+ JetBrains Mono（等宽）
      fontFamily: {
        mono: ['"JetBrains Mono"', "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      // 代码专用字号
      fontSize: {
        "code-sm": ["0.75rem", { lineHeight: "1rem" }],
        code: ["0.8125rem", { lineHeight: "1.25rem" }],
        "code-lg": ["0.9375rem", { lineHeight: "1.5rem" }],
      },
      // 自定义动画
      animation: {
        "pulse-soft": "pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
