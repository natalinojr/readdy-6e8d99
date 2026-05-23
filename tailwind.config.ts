/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        fontFamily: {
          sans: ['Plus Jakarta Sans', 'sans-serif'],
        },
        gridTemplateColumns: {
          '16': 'repeat(16, minmax(0, 1fr))',
        },
        keyframes: {
          slideIn: {
            '0%': { opacity: '0', transform: 'translateY(-8px) scale(0.97)' },
            '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          },
          slideInRight: {
            '0%': { opacity: '0', transform: 'translateX(24px)' },
            '100%': { opacity: '1', transform: 'translateX(0)' },
          },
          slideInUp: {
            '0%': { opacity: '0', transform: 'translateY(100%)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
        },
        animation: {
          slideIn: 'slideIn 0.3s ease-out',
          slideInRight: 'slideInRight 0.3s ease-out',
          slideInUp: 'slideInUp 0.25s ease-out',
        },
      },
    },
    plugins: [],
  }