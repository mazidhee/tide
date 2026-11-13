import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/source-serif-4/wght-italic.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
// The reading room's serif (SIL Open Font License 1.1; see THIRD_PARTY_NOTICES.md)
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import 'katex/dist/katex.min.css'
import './styles/theme.css'
import './styles/app.css'
import './styles/prose.css'
import './styles/lab.css'
import './styles/sims.css'
import './styles/simKinds.css'
import './styles/visuals.css'
import './styles/animations.css'
import './styles/knowledge.css'
import './styles/workshop.css'
import './styles/courses.css'
import './styles/courseplan.css'
import './styles/maths.css'
import './styles/mathsLessons.css'
import './styles/ladder.css'
import './styles/workout.css'
import './styles/profile.css'
// The new design: every rule in these is scoped to data-design='tide' (see shared/design.ts)
import './styles/tide/fonts.css'
import './styles/tide/tokens.css'
import './styles/tide/base.css'
import './styles/tide/shell.css'
import './styles/tide/home.css'
import './styles/tide/lesson.css'
import './styles/lessonmap.css'
import './styles/tide/lessonmap.css'
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
// Tabs at the top of the main area, for both designs
import './styles/tabs.css'
import './styles/memory.css'
// humanities: the EPUB reader, Discuss this, reading together, appraisals, free books
import './styles/humanities.css'
import './styles/video.css'
import './styles/links.css'
import './styles/threads.css'
import './styles/explore.css'
import './styles/breaks.css'
import './styles/mocks.css'
import './styles/sharp.css'
// The reading room, its reader and cover banners on notes
import './styles/readingRoom.css'
import './styles/coach.css'
import { resolveDesign } from '@shared/design'
import { AppProvider } from './state'
import App from './App'
import { startLab } from './lib/lab'
import { startMermaid } from './lib/mermaid'
import { startLightbox } from './lib/lightbox'
import { startSims } from './lib/sims'
import { startChallenges } from './lib/maths/challenge'
import { startGraphs } from './lib/graphs'
import { startAnimations } from './lib/animations'
import { startVideoEmbeds } from './lib/videoEmbeds'
import { startLessonEmbeds } from './lib/lessonEmbeds'
import { goto, listenForLinks } from './lib/linkNav'
import { seekPlayer } from './lib/videoHub'
import { startVisuals, configureVisuals } from './lib/visuals'
import { renderMarkdown } from './lib/markdown'
import { inFocusWindow } from './lib/popout'
import { flushOngoing } from './lib/sessions'

window.tide.settings.get().then((settings) => {
  // Before the first paint, so the window never shows the other design for a frame
  document.documentElement.dataset.design = resolveDesign(settings.design)
  startMermaid()
  startLab()
  startSims()
  startChallenges()
  startGraphs()
  startAnimations()
  startVideoEmbeds()
  // Every link opens in Tide (lib/linkNav), and the tutor can move the view (show_in_view)
  startLessonEmbeds()
  listenForLinks()
  window.tide.links.onGoto((g) => {
    if (g.t != null) seekPlayer(g.t, g.video)
    if (g.section) goto({ section: g.section })
  })
  // Claude's visuals: a fallback diagram is ordinary Markdown (its mermaid is drawn like any other)
  configureVisuals({ markdown: (t) => renderMarkdown(t, { notePath: '', filesByName: new Map() }) })
  startVisuals()
startLightbox()
  const root = createRoot(document.getElementById('root')!)
  root.render(
    <StrictMode>
      <AppProvider initial={settings}>
        <App />
      </AppProvider>
    </StrictMode>
  )
  // A pop-out closing: its page leaves as if you had gone elsewhere (a lesson is kept under Carry
  // on, as when you leave one), what's waiting to be written is written, and then it closes
  if (inFocusWindow)
    window.tide.windows.onClosing(async () => {
      try {
        root.unmount()
        await flushOngoing()
      } finally {
        await window.tide.windows.closeNow()
      }
    })
})
