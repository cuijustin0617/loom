/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Shift brand to elegant purple shades
        'loom-blue': '#7C3AED',
        'loom-blue-dark': '#5B21B6',
        'loom-gray': '#F3F4F6',
        'loom-gray-dark': '#374151',
      },
      fontFamily: {
        'tech': ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
