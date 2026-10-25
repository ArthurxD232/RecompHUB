import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/main.css'

async function bootstrap(): Promise<void> {
  // Pré-visualização no navegador (npm run dev:web): sem Electron não existe window.api
  if (import.meta.env.DEV && !window.api) {
    const { installMockApi } = await import('./dev/mock-api')
    installMockApi()
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
