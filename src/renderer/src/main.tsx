import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/source-serif-4/wght-italic.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import 'katex/dist/katex.min.css'
import './styles/theme.css'
import './styles/app.css'
import './styles/prose.css'
import './styles/sims.css'
import { AppProvider } from './state'
import App from './App'
import { startMermaid } from './lib/mermaid'
import { startLightbox } from './lib/lightbox'
import { startSims } from './lib/sims'

window.tide.settings.get().then((settings) => {
  startMermaid()
  startSims()
startLightbox()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider initial={settings}>
        <App />
      </AppProvider>
    </StrictMode>
  )
})
