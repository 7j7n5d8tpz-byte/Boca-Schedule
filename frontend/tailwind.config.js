/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          dark: '#1A1D22',
          gray: {
            DEFAULT: '#E0E0E0',
            100: '#F2F2F2',
            200: '#D8D8D8',
          },
          green: {
            50:  '#eaf5ee',
            100: '#c4e4cf',
            200: '#9dd3b0',
            300: '#6dbc8d',
            400: '#3da06a',
            DEFAULT: '#205B3B',
            700: '#184830',
            800: '#102f1f',
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
