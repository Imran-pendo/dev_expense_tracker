import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Boot Pendo exactly once with an anonymous visitor. The signed-in user is
// identified (and cleared on sign-out) in AuthProvider, src/app/providers.tsx.
pendo.initialize({
  visitor: {
    id: '',
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
