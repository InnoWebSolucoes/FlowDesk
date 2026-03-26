/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1A5C3A',
        'primary-light': '#E3F0E9',
        'primary-dark': '#134430',
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
