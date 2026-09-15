/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
        cairo: ['Cairo', 'sans-serif'],
        ibm: ['IBM Plex Sans Arabic', 'Cairo', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        // Coffee Shop Premium Theme
        mocha: {
          50: '#FAF7F2',
          100: '#F3EDE3',
          200: '#E8DDD0',
          300: '#D4C3B0',
          400: '#C89F7A',
          500: '#A67C52',
          600: '#8B6843',
          650: '#7E5B37',
          700: '#6B4E31',
          800: '#4A3B32',
          850: '#382B24',
          900: '#2D2419',
          950: '#1A130D',
        },
        cream: {
          DEFAULT: '#FBF9F6',
          dark: '#F9F6F0',
          light: '#FFFDF9',
        },
        coffee: {
          light: '#8B6843',
          DEFAULT: '#6B4E31',
          dark: '#4A3B32',
          deep: '#231815',
        },
        caramel: {
          light: '#EADBC8',
          DEFAULT: '#C8956C',
          dark: '#A67347',
          gold: '#D4AF37',
        }
      },
      boxShadow: {
        'gold-sm': '0 2px 8px -1px rgba(200, 149, 108, 0.25)',
        'gold-md': '0 4px 16px -2px rgba(200, 149, 108, 0.35)',
        'gold-lg': '0 10px 25px -4px rgba(200, 149, 108, 0.45)',
        'mocha-sm': '0 2px 8px -1px rgba(45, 36, 25, 0.15)',
        'mocha-md': '0 6px 18px -2px rgba(45, 36, 25, 0.25)',
        'mocha-lg': '0 12px 28px -4px rgba(45, 36, 25, 0.35)',
        'inner-gold': 'inset 0 1px 2px rgba(212, 175, 55, 0.2)',
      },
      animation: {
        'steam-slow': 'steam 3s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'float-gentle': 'floatGentle 4s ease-in-out infinite',
        'receipt-feed': 'receiptFeed 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        steam: {
          '0%': { transform: 'translateY(0) scaleX(1)', opacity: '0' },
          '20%': { opacity: '0.8' },
          '50%': { transform: 'translateY(-12px) scaleX(1.15)', opacity: '0.5' },
          '100%': { transform: 'translateY(-26px) scaleX(1.3)', opacity: '0' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.85', transform: 'scale(1.08)' },
        },
        floatGentle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        receiptFeed: {
          '0%': { transform: 'translateY(-30px) scaleY(0.7)', opacity: '0' },
          '100%': { transform: 'translateY(0) scaleY(1)', opacity: '1' },
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
        'mobile': {'max': '767px'},
        'tablet': {'min': '768px', 'max': '1023px'},
      },
    },
  },
  plugins: [],
};
