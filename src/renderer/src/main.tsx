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
import './styles/lab.css'
import './styles/sims.css'
import './styles/simKinds.css'
import './styles/visuals.css'
import './styles/knowledge.css'
import './styles/workshop.css'
import './styles/courses.css'
// The new design: every rule in these is scoped to data-design='tide' (see shared/design.ts)
import './styles/tide/fonts.css'
import './styles/tide/tokens.css'
import './styles/tide/base.css'
import './styles/tide/shell.css'
import './styles/tide/home.css'
import './styles/tide/lesson.css'
// [source-led] the reading block: classic styles, then the new design's
import './styles/reading.css'
import './styles/tide/reading.css'
import './styles/tide/notes.css'
import './styles/tide/library.css'
import './styles/tide/know.css'
import './styles/tide/settings.css'
import './styles/tide/rest.css'
// The note editor's live preview, after both designs' prose so it can match them
import './styles/livePreview.css'
import './styles/tide/projects.css'
// humanities: the EPUB reader, Discuss this, reading together, appraisals, free books
import './styles/humanities.css'
import { resolveDesign } from '@shared/design'
import { AppProvider } from './state'
import App from './App'
import { startLab } from './lib/lab'
import { startMermaid } from './lib/mermaid'
import { startLightbox } from './lib/lightbox'
import { startSims } from './lib/sims'
import { startVisuals, configureVisuals } from './lib/visuals'
import { renderMarkdown } from './lib/markdown'

window.tide.settings.get().then((settings) => {
  // Before the first paint, so the window never shows the other design for a frame
  document.documentElement.dataset.design = resolveDesign(settings.design)
  startMermaid()
  startLab()
  startSims()
  // Claude's visuals: a fallback diagram is ordinary Markdown (its mermaid is drawn like any other)
  configureVisuals({ markdown: (t) => renderMarkdown(t, { notePath: '', filesByName: new Map() }) })
  startVisuals()
startLightbox()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider initial={settings}>
        <App />
      </AppProvider>
    </StrictMode>
  )
})
