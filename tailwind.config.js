/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Variables rather than fixed hexes, so a person's side of the app can
        // be drawn in their own colour: a wrapper sets the three channels (see
        // themeVars in lib/personColor) and everything inside follows. The
        // defaults in index.css are the FlowDesk green.
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-light': 'rgb(var(--primary-light) / <alpha-value>)',
        'primary-dark': 'rgb(var(--primary-dark) / <alpha-value>)',
        surface: '#FFFFFF',
        bg: '#F5F4EF',
        'surface-2': '#ECEAE3',
        border: 'rgba(0,0,0,0.08)',
        'border-md': 'rgba(0,0,0,0.15)',
        'text-main': '#18170F',
        'text-muted': '#6B6960',
        'text-subtle': '#A8A69F',
        amber: '#7A4A0A',
        'amber-bg': '#F7EDDE',
        'blue-accent': '#1B4F8A',
        'blue-bg': '#E4EDF7',
        danger: '#7A2020',
        'danger-bg': '#F5E5E5',
        success: '#1A5C3A',
        'success-bg': '#E3F0E9',
        warning: '#7A4A0A',
        'warning-bg': '#F7EDDE',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
