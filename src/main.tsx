import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Boot Pendo once per page load, before the first render. The visitor starts
// anonymous (an empty id lets the agent restore a returning visitor); the
// signed-in user is identified by AuthProvider in src/app/providers.tsx.
pendo.initialize({ visitor: { id: '' } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
