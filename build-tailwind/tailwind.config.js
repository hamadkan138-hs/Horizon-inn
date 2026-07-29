module.exports = {
  darkMode: 'class',
  content: [
    'public/room-management.html',
    'public/room-management.js'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Inter', 'sans-serif']
      },
      colors: {
        gold: { DEFAULT: '#d4af37', soft: '#e8c874' },
        ink: '#0a0b0e'
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.37)',
        'glass-dark': '0 8px 32px rgba(0,0,0,0.37)'
      }
    }
  },
  plugins: []
};
