/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Coffee-shop palette. Full 50–900 scales on purpose: a partial scale meant class
        // names like `border-mocha-650` or `bg-caramel-100` compiled to nothing, so the
        // border or fill was silently absent rather than wrong.
        mocha: {
          50: '#F9F6F0',
          100: '#F3EDE3',
          200: '#E8DDD0',
          300: '#D4C3B0',
          400: '#C89F7A',
          500: '#A67C52',
          600: '#8B6843',
          700: '#6B4E31',
          800: '#4A3B32',
          900: '#2D2419',
        },
        caramel: {
          DEFAULT: '#C89F7A',
          50: '#FDF9F5',
          100: '#F7EDE2',
          200: '#EEDCC8',
          300: '#E0C4A4',
          400: '#D4B08C',
          500: '#C89F7A',
          600: '#B08558',
          700: '#8F6A43',
          800: '#6B4F32',
          900: '#463322',
          light: '#D4C3B0',
          dark: '#A67C52',
        },
        cream: {
          DEFAULT: '#FBF9F6',
          dark: '#F9F6F0',
        },
        coffee: {
          light: '#8B6843',
          DEFAULT: '#6B4E31',
          dark: '#4A3B32',
        },
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      height: {
        'screen-safe': 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
      },
      screens: {
        'xs': '475px',
        'mobile': { 'max': '767px' },
        'tablet': { 'min': '768px', 'max': '1023px' },
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [],
};
