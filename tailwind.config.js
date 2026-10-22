/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        steam: {
          header: '#171d25',
          sidebar: '#1e2329',
          sidebarDark: '#171a21',
          bg: '#1b2838',
          bgDark: '#171a21',
          panel: '#212b36',
          panelHover: '#2a3846',
          border: '#2c3540',
          blue: '#1a9fff',
          blueHover: '#47b4ff',
          green: '#5ba32b',
          greenHover: '#6cc034',
          text: '#dcdedf',
          muted: '#8f98a0'
        }
      },
      fontFamily: {
        sans: [
          '"Motiva Sans"',
          'Arial',
          'Helvetica',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif'
        ],
        mono: [
          '"JetBrains Mono"',
          'Consolas',
          'monospace'
        ]
      }
    }
  },
  plugins: []
}
