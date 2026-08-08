import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/index.css'
import PlanetView from './ui/PlanetView.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlanetView />
  </StrictMode>,
)
