/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#131420',
          green: {
            50:  '#e8f5ed',
            100: '#c3e6ce',
            200: '#9dd8af',
            300: '#6dc490',
            400: '#3daf70',
            DEFAULT: '#1a6b3a',
            700: '#155730',
            800: '#0f3f22',
          },
          red: {
            50:  '#fce8eb',
            DEFAULT: '#c41230',
            700: '#a50e27',
          },
        },
      },
    },
  },
  plugins: [],
};
