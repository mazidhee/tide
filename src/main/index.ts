import { registerBackups, watchBackups } from './backup'
import { openBugSheet, registerBugReports } from './bugReport'
import { registerWeekProgress } from './weekProgress'
import { gradeAnswer } from './daily'
import { hasKeys, listCloudModels, loadDayUse, loadStats, setKey, testCloud, usageSummary } from './cloud'
import { connectMetabase, disconnectMetabase, metabaseStatus } from './metabase'
import { followVault } from './vaultHome'
import { bankStatus, openingFor, prepare as prepareBank, previewFor, startBank, variantFor, warmups } from './bank'
import { newStudyApiToken, setStudyApi, startStudyApi, stopStudyApi, studyApiStatus } from './studyApi'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, screen, session, shell, powerMonitor } from 'electron'
import { isPopout, popMenuItems, registerPopouts, setQuitting } from './popout'
import { APP_CSP } from '@shared/appCsp'
import { VISUAL_SCHEME_PRIVILEGES, blockVisualRequests, denyVisualPermissions, devFrameSrc, guardVisualFrames, handleVisualProtocol, killVisual, unwatchVisual, visualMetrics, watchVisual } from './visualFrames'
import { lessonVisuals, rememberVisual, repairVisual, visualFallback, visualPolicy } from './visuals'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { CompanyPrepRequest, OutlineDraftRequest, ChatRequest, ChatScope, LearningStatus, ReviewGrade, Settings, PdfHighlight, TutorThread } from '@shared/types'
import { getSettings, updateSettings } from './settings'
import { noteRender, recentSpeed } from './speed'
import {
  absPath,
  allNotes,
  createFolder,
  createNote,
  getTree,
  listCode,
  createCodeFile,
  readText,
  renamePath,
  resolveLink,
  trashPath,
  watchVault,
  writeText
} from './vault'
import { buildIndex, reindexPath, searchHits } from './search'
import { cancelChat, chat, setChatsChangedListener, generateFlashcards, listModels, readAlong, testConnection, tieBreak, lessonPassage } from './ai'
import {
  getBacklinks,
  getGraph,
  getNotebooks,
  getProgress,
  getReviewStats,
  getThreads,
  recordQuiz,
  saveThreads,
  setCoverImage,
  setNoteStatus,
  updateNotebook,
  recordAttempt,
  getMastery, getLibraryTopics, getLibraryStatus, onPathMoved, setLibraryTopics, setLibraryStatus, clearCoverImage, logFocus, focusLog, focusTime, invalidateGraph } from './learn'
import { importFile, libraryThumb, saveUrl } from './library'
import { getHighlights, saveHighlights } from './highlights'
import { registerReading } from './reading'
import { addToShelf, registerReadingRoom } from './readingRoom'
import { registerTts } from './tts'
import { labLoadTable, labQuery, labReset, labSchema } from './lab'
import { isSql, languagesStatus } from './languages'
import { registerLanguageServer, stopLanguageServer } from './pythonLanguageServer'
import { registerIde, stopIde } from './ide'
import { registerNotebook, stopNotebooks } from './notebook'
import { registerMocks } from './mocks'
import { registerSharpness } from './sharpness'
import { registerIdeas } from './ideaProjects'
import { registerPacks, stopPacks } from './packs'
import { labStatus, librariesStatus, mathStatus, runCode, runProject, setupLab, setupLibraries, setupMath } from './runner'
import { searchStatus, setupSearch, stopSearch, wakeSearch } from './websearch'
import { applySpeedups, speedStatus } from './modelServer'
import { labFlashcards } from './labCards'
import { prewarmLesson, warmChat, warmLessons } from './agent'
import { gemmaStatus, getGemmaReady, loadGemmaNow, minuteCheck, unloadGemmaNow, unloadIdleAtLaunch, wakeModel, watchModelIdle } from './modelIdle'
import { noteTyping, onModelBusy } from './modelQueue'
import { cancelDraft, draftOutline } from './outlineDraft'
import { cancelCompanyPrep, draftCompanyPrep } from './companyPrep'
import { adjustPlan, auditRoadmap, checkOutlineResources, planReadings, planToThings, sizePlan, syncFromThings, type PlanRequest } from './planner'
import type { StudyPlan } from '@shared/plan'
import { dayTasks, setTaskDone, thingsStatus } from './things'
import { mapBook, mapNewBooks, pagesToRead } from './books'
import { findReadings, readingsFor } from './readings'
import { getLesson, listLessons, saveLesson } from './lessons'
import { lessonPack } from './sources'
import { listConnections } from './connections'
import { noteUse } from './connectionUse'
import { challengeReply } from './lessonGuard'
import { proposeChanges, curriculumStatus, curriculumView, setOverride, sortError, sortRoadmaps } from './curriculum'
import { aimsKey, aimsOf } from '@shared/coach'
import { resultText } from '@shared/lab'
import type { SectionClass } from '@shared/curriculum'
import type { Known, PlacementSetup } from '@shared/placement'
import { getBrain } from './brain'
import { draftBrief, flowSteps, mapProject, projectDocs, projectMap, setProject } from './projects'
import { onBrainEvent, recentBrainEvents } from './brainEvents'
import { getCoach, getWeek, planWeek, saveCoach, updateProfile, inferDirection, autoPlanWeek, weekToThings, setItemDone, catchUp, rollOver, dayStats, journal, writeJournal, weekReview, saveReview, savePlacement, addTopicAfter } from './coach'
import { clearPhoto, getProfile, getSourcePhoto, setProfile, setSourcePhoto } from './profile'
import type { Profile } from '@shared/profile'
import { addMistakes, listMistakes, mistakesDue, retestMistake } from './mistakes'
import { initTray, refreshTray, reportStudy, type StudyStatus } from './tray'
import { localDate, todayItems } from '@shared/coach'
import { hasDeepgram, saveDeepgram, setupVoice, speak, stopVoice, transcribe, voiceStatus, warmVoice, type Heard } from './voice'
import type { NewMistake } from '@shared/mistakes'
import type { CoachSettings } from '@shared/coach'
import { deleteChat, getChat, listChats, pinChat, renameChat } from './chats'
import { addMemory, listMemories, removeMemory, updateMemory } from './memory'
import { closeAllTerminals, closeTerminal, createTerminal, resizeTerminal, setTerminalListeners, writeTerminal, type TerminalKind } from './terminal'
import { bookChapters } from './book'
import { getBrief, suggestReading } from './brief'
import { generateExam, markPart } from './exam'
import { PATTERNS, addChallenge, addProblem, addStarterSet, listProblems, recordInterview, removeProblem, updateProblem } from './practice'
import { getGoals, getRecallQueue, listDrills, listInterviews, logDrill, logInterview, reviewRecall, saveGoals } from './learn'
import type { DrillResult } from '@shared/drills'
import type { InterviewRecord } from '@shared/interviews'
import { getCards, reviewCard, saveCards } from './study'
import { registerEditorIpc, runNow } from './workshopWatch'

protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  // Claude's visuals, each in a sandboxed frame of its own (main/visualFrames)
  VISUAL_SCHEME_PRIVILEGES,
  // Rendered maths animations (main/manim), streamed to the lesson's video player
  { scheme: 'tide-anim', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

let win: BrowserWindow | null = null

/** Development only: a test copy runs in a window parked off-screen so it never covers the real one */
const testCopy = !app.isPackaged && !!process.env.TIDE_USER_DATA

function createWindow() {
  win = new BrowserWindow({
    width: testCopy ? 1300 : 1400,
    height: testCopy ? 820 : 900,
    // A test copy never takes focus, so keys meant for the real app can't land in it
    ...(testCopy ? { x: -1250, y: 40, focusable: false } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161616' : '#fbfaf8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !testCopy
    }
  })

  win.once('ready-to-show', () => (testCopy ? win?.showInactive() : win?.show()))
  guardVisualFrames(win.webContents)

  // Links in notes open in the user's real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL() && !url.startsWith('http://localhost')) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Every window hears every event (a lesson in its own window streams like one in the main window);
// events carry ids, so each listener takes only its own
const send = (channel: string, payload: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}

/** A pop-out window (main/popout): set up like the main one, at the place its kind was last left */
function buildPopout(at: { x: number; y: number; width: number; height: number }, title: string) {
  const w = new BrowserWindow({
    ...at,
    title,
    // A test copy's windows stay parked off-screen and never take focus, like its main window
    ...(testCopy ? { x: -1250, y: 60, focusable: false } : {}),
    minWidth: 560,
    minHeight: 420,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161616' : '#fbfaf8',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: !testCopy }
  })
  w.once('ready-to-show', () => (testCopy ? w.showInactive() : w.show()))
  guardVisualFrames(w.webContents)
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL() && !url.startsWith('http://localhost')) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  return w
}

function startVault() {
  watchVault(async (paths) => {
    for (const p of paths) await reindexPath(p).catch(() => {})
    invalidateGraph()
    send('vault:changed', paths)
  })
  buildIndex().catch((e) => console.error('[index] failed', e))
}

function registerIpc() {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))

  registerLanguageServer()
  registerIde()
  registerNotebook()
  registerMocks()
  registerSharpness()
  registerIdeas()
  registerPacks()
  registerBackups(handle)
  registerBugReports()
  registerWeekProgress(handle)
  handle('settings:get', () => getSettings())
  // You (main/profile): your name and picture, kept in app data
  handle('profile:get', () => getProfile())
  handle('profile:set', (patch: Partial<Profile>) => setProfile(patch))
  handle('profile:source', () => getSourcePhoto())
  handle('profile:setSource', (dataUrl: string) => setSourcePhoto(dataUrl))
  handle('profile:clearPhoto', (alsoSprite?: boolean) => clearPhoto(!!alsoSprite))
  handle('settings:set', (patch: Partial<Settings>) => {
    const prevVault = getSettings().vaultPath
    const next = updateSettings(patch)
    if (patch.theme) nativeTheme.themeSource = themeSource(next.theme)
    if (next.vaultPath !== prevVault) startVault()
    if ('menuBar' in patch || 'character' in patch) refreshTray()
    return next
  })

  handle('vault:choose', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose your notes folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    updateSettings({ vaultPath: res.filePaths[0] })
    startVault()
    return res.filePaths[0]
  })
  handle('vault:tree', () => getTree())
  handle('vault:read', (p: string) => readText(p))
  handle('vault:write', async (p: string, content: string) => {
    await writeText(p, content)
    await reindexPath(p)
  })
  handle('vault:prepareImage', async (dataUrl: string) => {
    const { dataUrlOf, prepareImage } = await import('./imagePrep')
    const p = await prepareImage(String(dataUrl)).catch(() => null)
    return p ? dataUrlOf(p) : null
  })
  handle('vault:writeImage', async (p: string, dataUrl: string) => {
    const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)
    if (!m) throw new Error('Not an image')
    const full = absPath(p)
    const { mkdir, writeFile } = await import('fs/promises')
    const { dirname } = await import('path')
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, Buffer.from(m[2], 'base64'))
  })
  handle('vault:createNote', (folder: string, name: string) => createNote(folder, name))
  handle('vault:createFolder', (parent: string, name: string) => createFolder(parent, name))
  handle('vault:rename', async (p: string, name: string) => {
    const to = await renamePath(p, name)
    if (to !== p) await onPathMoved(p, to).catch((e) => console.error('[rename] could not update records', e))
    return to
  })
  handle('vault:trash', (p: string) => trashPath(p))
  handle('vault:reveal', (p: string) => shell.showItemInFolder(absPath(p)))
  handle('vault:resolveLink', (target: string, from: string) => resolveLink(target, from))
  handle('vault:notes', () => allNotes())

  handle('search:query', (q: string, limit?: number) => searchHits(q, limit))

  handle('ai:chat', (req: ChatRequest) => {
    chat(req, (e) => send('ai:event', e))
  })
  handle('ai:cancel', (id: string) => cancelChat(id))
  // A lesson's side thread was folded: its Claude process goes (main/claudeEngine threadKey)
  handle('ai:threadDone', (lab: string) => import('./claudeEngine').then((c) => c.stopThreads(lab)))
  handle('ai:prewarm', (req: Omit<ChatRequest, 'id'>) => prewarmLesson(req))
  // Gemma on demand (main/modelIdle): what it's doing for Settings, a hand on it, and a note about to open that will need it
  handle('gemma:status', () => gemmaStatus())
  handle('gemma:load', () => loadGemmaNow())
  handle('gemma:unload', () => unloadGemmaNow())
  handle('ai:typing', () => noteTyping())
  setChatsChangedListener((id) => send('chats:changed', id))
  setTerminalListeners(
    (id, data) => send('terminal:data', { id, data }),
    (id, code) => send('terminal:exit', { id, code })
  )
  handle('terminal:create', (kind: TerminalKind, cols: number, rows: number, cwd?: string) => createTerminal(kind === 'lab' ? 'lab' : 'local', cols, rows, cwd))
  handle('terminal:write', (id: string, data: string) => writeTerminal(id, String(data)))
  handle('terminal:resize', (id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  handle('terminal:close', (id: string) => closeTerminal(id))
  handle('terminal:flashcards', (id: string, topic?: string) => labFlashcards(id, topic))
  handle('code:list', () => listCode())
  handle('code:create', (name: string, content?: string) => createCodeFile(name, content ?? ''))
  handle('chats:list', () => listChats())
  handle('chats:get', (id: string) => getChat(id))
  handle('chats:rename', async (id: string, title: string) => void (await renameChat(id, title)))
  handle('chats:pin', async (id: string, pinned: boolean) => void (await pinChat(id, pinned)))
  handle('chats:remove', (id: string) => deleteChat(id))
  handle('memory:list', () => listMemories())
  handle('memory:add', (text: string) => addMemory(text))
  handle('memory:update', (id: string, text: string) => updateMemory(id, text))
  handle('memory:remove', (id: string) => removeMemory(id))
  handle('learn:draftOutline', (req: OutlineDraftRequest) => {
    draftOutline(req, (e) => send('ai:event', e))
  })
  handle('learn:cancelDraft', (id: string) => cancelDraft(id))
  handle('learn:auditRoadmap', (id: string, path: string, hours: number) => {
    auditRoadmap(id, path, Number(hours) || 6, (e) => send('ai:event', e))
  })
  handle('coach:get', () => getCoach())
  handle('coach:save', async (s: CoachSettings) => {
    const before = aimsKey(aimsOf(await getCoach()))
    const saved = await saveCoach(s)
    // New or reworded aims: sort the roadmaps again, in the background
    if (aimsKey(aimsOf(saved)) !== before) sortRoadmaps().catch(() => {})
    return saved
  })
  handle('readings:for', async (topic: string, path?: string) => {
    const have = await readingsFor(topic)
    // Nothing yet: look it up in the background, for next time
    if (!have.length) findReadings({ topic, path }).catch(() => {})
    return have
  })
  handle('curriculum:placed', (setup: PlacementSetup, results: Record<string, Known>) => savePlacement(setup, results))
  handle('curriculum:propose', (notebook: string) => proposeChanges(notebook))
  handle('curriculum:addTopic', (notebook: string, afterId: string, title: string) => addTopicAfter(notebook, afterId, title))
  handle('lessons:challenge', (topic: string, where: string | undefined, reply: string) => challengeReply(topic, where, reply))
  handle('connections:list', (fresh?: boolean) => listConnections(fresh))
  // Claude, through the user's own Claude Code (main/claudeEngine)
  handle('claude:status', async (fresh?: boolean) => {
    const { claudeStatus, liveClaude, forgetLimit } = await import('./claudeEngine')
    if (fresh) forgetLimit()
    const st = await claudeStatus(fresh)
    return { installed: st.installed, version: st.version, loggedIn: st.loggedIn, plan: st.plan, error: st.error, limitedUntil: st.limitedUntil, limit: st.limit, live: liveClaude(), terminalPort: getSettings().ai.claude?.terminalPort }
  })
  handle('claude:terminal', async (on: boolean) => {
    const { setTerminal } = await import('./tideMcp')
    const { runClaude } = await import('./claudeEngine')
    return setTerminal(on, runClaude)
  })
  handle('usage:report', async (range?: number) => {
    const [{ usageReport }, { idleMinutes }] = await Promise.all([import('./usageLog'), import('./modelIdle')])
    return usageReport(Math.min(90, Math.max(1, range ?? 14)), Date.now(), idleMinutes() || 15)
  })
  handle('claude:usage', async (days?: number) => {
    const { readClaudeUsage } = await import('./claudeEngine')
    return readClaudeUsage(Date.now() - (days ?? 1) * 86_400_000)
  })
  // Only the services added from the Connections page: other keys have their own checked flows
  handle('connections:setKey', (id: string, key: string | null) => {
    if (!['you', 'firecrawl', 'brave', 'tavily'].includes(id)) throw new Error('That connection’s key is set in its own section.')
    setKey(id, key)
    // Removing a Brave or Tavily key also clears one typed into Settings by an older version
    const ws = getSettings().ai.webSearch
    if (!key && (id === 'brave' || id === 'tavily') && ws?.provider === id && ws.apiKey) updateSettings({ ai: { ...getSettings().ai, webSearch: { ...ws, apiKey: undefined } } })
    return listConnections(true)
  })
  // Only Flow is noted from the window: the rest are counted where Tide calls them
  handle('speed:recent', () => recentSpeed())
  handle('speed:memory', async () => (await import('./macMemory')).macMemory())
  handle('speed:render', (id: string, r: Parameters<typeof noteRender>[1]) => noteRender(id, r))
  handle('connections:used', (id: string) => id === 'flow' && noteUse(id))
  handle('sources:lesson', (topic: string, where?: string) => lessonPack(topic, where))
  handle('lessons:save', (r: Parameters<typeof saveLesson>[0]) => saveLesson(r))
  handle('lessons:list', () => listLessons())
  handle('lessons:get', (id: string) => getLesson(id))
  // Explore later (main/explore): kept from lessons, for short side lessons
  handle('explore:list', async () => (await import('./explore')).listExplore())
  handle('explore:add', async (input: import('@shared/explore').ExploreInput) => (await import('./explore')).addExplore(input))
  handle('explore:update', async (id: string, patch: Parameters<typeof import('./explore').updateExplore>[1]) => (await import('./explore')).updateExplore(id, patch))
  handle('explore:remove', async (id: string) => (await import('./explore')).removeExplore(id))
  // Claude's visuals: main/visuals (policy, repair, fallback, kept with the lesson), main/visualFrames (limits)
  handle('visuals:policy', () => visualPolicy())
  handle('visuals:repair', (req: { code: string; errors: string[]; scope: unknown }) => repairVisual(req))
  handle('visuals:fallback', (req: { code: string; title: string; scope: unknown }) => visualFallback(req))
  handle('visuals:cached', (id: string) => lessonVisuals(id))
  handle('visuals:remember', (id: string, key: string, record: unknown, source?: unknown) => rememberVisual(id, key, record, source))
  ipcMain.handle('visuals:watch', (e, host: string) => watchVisual(e.sender, String(host)))
  ipcMain.handle('visuals:unwatch', (e, host: string) => unwatchVisual(String(host), e.sender))
  ipcMain.handle('visuals:kill', (e, host: string, reason: string) => killVisual(e.sender, String(host), String(reason ?? 'it stopped answering').slice(0, 120)))
  ipcMain.handle('visuals:metrics', (e) => visualMetrics(e.sender))
  handle('knowledge:view', async () => (await import('./knowledge')).knowledgeView())
  // The learner model (main/learnerModel): What you know › Your model, a correction, a target, an act from the window
  const depthIn = (d: unknown) => Math.max(0, Math.min(6, Math.round(Number(d) || 0))) as import('@shared/learningEvents').Depth
  handle('model:view', async (fresh?: boolean) => (await import('./learnerModel')).modelView(!!fresh))
  handle('model:node', async (id: string) => (await import('./learnerModel')).nodeDetail(String(id ?? '')))
  handle('model:correct', async (id: string, depth: number, note?: string) => (await import('./learnerModel')).correctJudgement(String(id ?? ''), depthIn(depth), typeof note === 'string' ? note.slice(0, 300) : undefined))
  handle('model:setTarget', async (node: string, depth: number | null) => (await import('./learnerModel')).setTarget(String(node ?? ''), depth === null ? null : depthIn(depth), { by: 'you' }))
  handle('model:event', async (e: import('@shared/learningEvents').EventIn) => (await import('./learnerModel')).eventFromWindow(e))
  handle('teaching:view', async () => (await import('./teaching')).teachingView())
  handle('teaching:setAdjustment', async (id: import('@shared/teachingAdjust').AdjustmentId, on: boolean) => (await import('./teaching')).setAdjustment(id, !!on))
  handle('teaching:review', async (lesson: string) => (await import('./teaching')).reviewLesson(String(lesson)))
  // ---- Videos (main/videos.ts) ----
  const videos = () => import('./videos')
  handle('videos:transcript', async (id: string, opts?: { path?: string; fetch?: boolean; course?: string; title?: string }) =>
    (await videos()).getTranscript(String(id), { path: typeof opts?.path === 'string' ? opts.path : undefined, fetch: !!opts?.fetch, course: typeof opts?.course === 'string' ? opts.course : undefined, title: typeof opts?.title === 'string' ? opts.title : undefined })
  )
  handle('videos:fileTranscript', async (path: string) => (await videos()).fileTranscript(String(path)))
  handle('videos:clips', async (topic: string, opts?: { limit?: number; recap?: boolean }) => (await videos()).clipsFor(String(topic ?? ''), { limit: Math.min(5, Number(opts?.limit) || 2), recap: !!opts?.recap }))
  handle('videos:check', async (clip: import('@shared/video').Clip) => (await videos()).checkClipTimes({ video: String(clip?.video ?? ''), start: Number(clip?.start), end: Number(clip?.end), ...(typeof clip?.why === 'string' ? { why: clip.why } : {}) }))
  // ---- Courses from GitHub (main/courses.ts) ----
  const courses = () => import('./courses')
  handle('courses:list', async () => (await courses()).listCourses())
  handle('courses:get', async (id: string) => (await courses()).courseDetail(String(id)))
  handle('courses:import', async (id: string) => (await courses()).importCourse(String(id)))
  handle('courses:update', async (id: string) => (await courses()).updateCourse(String(id)))
  handle('courses:remove', async (id: string) => (await courses()).removeCourse(String(id)))
  handle('courses:lesson', async (id: string, lesson: string) => (await courses()).lessonContent(String(id), String(lesson)))
  handle('courses:file', async (id: string, path: string) => (await courses()).courseFile(String(id), String(path)))
  handle('courses:mark', async (id: string, lesson: string, done: boolean) => (await courses()).markLesson(String(id), String(lesson), !!done))
  handle('courses:search', async (q: string) => (await courses()).searchCourses(String(q ?? ''), 12))
  handle('courses:preview', async (id: string) => (await courses()).coursePreview(String(id)))
  handle('courses:saveToNotes', async (id: string) => (await courses()).saveToNotes(String(id)))
  // Kept fresh (main/courseFresh): suggestions, dismissing one, the weekly check and its log
  handle('courses:fresh', async () => (await import('./courseFresh')).freshStatus())
  handle('courses:checkNow', async () => (await import('./courseFresh')).runCheck(true))
  handle('courses:dismiss', async (id: string) => (await import('./courseFresh')).dismissSuggestion(String(id)))
  handle('coursePlan:thisWeek', async () => (await import('./coursePlan')).thisWeek())
  handle('coursePlan:alignAll', async () => (await import('./coursePlan')).alignAll())
  handle('coursePlan:startQuiz', async (input: { course: string; lessons?: string[]; kind?: 'check' | 'quiz'; size?: number }) =>
    (await import('./courseQuiz')).startCourseQuiz({ course: String(input?.course ?? ''), ...(Array.isArray(input?.lessons) ? { lessons: input.lessons.map(String).slice(0, 6) } : {}), ...(input?.kind === 'check' ? { kind: 'check' as const } : {}), ...(Number.isFinite(input?.size) ? { size: Math.max(1, Math.min(8, Number(input.size))) } : {}) })
  )
  handle('coursePlan:submitQuiz', async (id: string, answers: Record<string, string>, selfMarks?: Record<string, 'correct' | 'partial' | 'wrong'>) => (await import('./courseQuiz')).submitCourseQuiz(String(id), answers && typeof answers === 'object' ? answers : {}, selfMarks && typeof selfMarks === 'object' ? selfMarks : undefined))
  handle('coursePlan:checked', async (course: string, lesson: string) => (await import('./courseQuiz')).lessonChecked(String(course), String(lesson)))
  handle('courses:track', async (id: string, lesson: string, patch: { read?: number; video?: { id: string; watched: number }; ran?: boolean }) => (await courses()).trackLesson(String(id), String(lesson), patch ?? {}))
  // ---- Links that stay in Tide (shared/links): repository files, the reader view, the web view ----
  const files = () => import('./courseFiles')
  handle('links:courseFile', async (id: string, path: string) => (await files()).courseFileView(String(id), String(path ?? '')))
  handle('links:githubFile', async (repo: string, ref: string, path: string) => (/^[\w.-]+\/[\w.-]+$/.test(String(repo)) ? (await files()).githubFileView(String(repo), String(ref ?? 'HEAD'), String(path ?? '')) : null))
  handle('links:repoPdf', async (src: { course?: string; repo?: string; ref?: string }, path: string) => (await files()).repoPdf(src?.course ? { course: String(src.course) } : { repo: String(src?.repo ?? ''), ref: String(src?.ref ?? 'HEAD') }, String(path)))
  handle('links:read', async (url: string, fresh?: boolean) => (await import('./linkReader')).readPage(String(url), !!fresh))
  handle('links:pdf', async (url: string) => (await import('./linkReader')).pdfBytes(String(url)))
  handle('links:repos', async () => (await courses()).importedRepos())
  handle('links:related', async (topic: string, opts?: { exclude?: string; limit?: number }) => (await import('./related')).relatedMaterial(String(topic ?? ''), { exclude: typeof opts?.exclude === 'string' ? opts.exclude : undefined, limit: Math.min(4, Number(opts?.limit) || 3) }))
  ipcMain.handle('web:open', async (e, url: string, bounds: import('./webView').Bounds) => (await import('./webView')).openWeb(e.sender, String(url), bounds))
  ipcMain.handle('web:place', async (_e, bounds: import('./webView').Bounds, visible?: boolean) => (await import('./webView')).placeWeb(bounds, visible !== false))
  ipcMain.handle('web:go', async (_e, action: 'back' | 'forward' | 'reload' | 'stop') => (await import('./webView')).webGo(action))
  ipcMain.handle('web:close', async () => (await import('./webView')).closeWeb())
  handle('knowledge:review', async (concept: string) => (await import('./review')).reviewFor(concept))
  handle('knowledge:reviewAnswer', async (concept: string, item: import('@shared/review').ReviewItem, verdict: import('@shared/types').Verdict) => (await import('./review')).answerReview(concept, item, verdict))
  // The warm-up before a lesson: quick cards on what it builds on (main/warmup.ts)
  handle('warmup:for', async (topic: string, path?: string) => (await import('./warmup')).warmupFor(String(topic ?? ''), typeof path === 'string' && path ? path : undefined))
  handle('warmup:grade', async (card: import('@shared/warmup').WarmupCard, verdict: import('@shared/types').Verdict) => (await import('./warmup')).gradeWarmup(card, verdict))
  // ---- Guided projects and adaptive difficulty (main/workshop.ts, main/difficulty.ts) ----
  const workshop = () => import('./workshop')
  handle('workshop:list', async () => (await workshop()).listWorkshop())
  handle('workshop:start', async (id: string, from?: { notebook?: string; topic?: string }) => (await workshop()).startProject(String(id), from))
  handle('workshop:state', async (id: string) => (await workshop()).workshopState(String(id)))
  // In turn with a run a save started (main/workshopWatch.ts), so two never write the record at once
  handle('workshop:run', async (id: string) => runNow(String(id)))
  registerEditorIpc()
  handle('workshop:hint', async (id: string) => (await workshop()).nextHint(String(id)))
  handle('workshop:review', async (id: string, stage?: number) => {
    const w = await workshop()
    return w.reviewStage(String(id), undefined, typeof stage === 'number' ? stage : undefined)
  })
  handle('workshop:ask', async (id: string, question: string) => (await workshop()).askAboutStage(String(id), String(question ?? '')))
  handle('workshop:forFolder', async (folder: string) => (await workshop()).projectForFolder(String(folder ?? '')))
  handle('workshop:forTopic', async (topic: string) => (await workshop()).projectForTopic(String(topic ?? '')))
  handle('workshop:propose', async (o: { topic: string; notebook?: string; section?: string }) => (await workshop()).proposeProject({ topic: String(o?.topic ?? ''), notebook: o?.notebook, section: o?.section }))
  handle('difficulty:known', async (topic: string) => (await import('./difficulty')).knownFor(String(topic ?? '')))
  // ---- end of guided projects and adaptive difficulty ----
  handle('curriculum:status', async () => ({ notebooks: await curriculumStatus(), error: sortError() }))
  handle('curriculum:sort', () => sortRoadmaps())
  handle('curriculum:view', (notebook: string) => curriculumView(notebook))
  handle('curriculum:setOverride', (id: string, cls: SectionClass | null) => setOverride(id, cls))
  handle('coach:week', (date?: string) => getWeek(date))
  handle('coach:planWeek', () => planWeek())
  handle('coach:profile', () => updateProfile())
  handle('coach:infer', (force?: boolean) => inferDirection(!!force))
  handle('coach:toThings', () => weekToThings())
  handle('coach:setDone', (date: string, index: number, done: boolean, title?: string) => setItemDone(date, index, done, typeof title === 'string' ? title : undefined))
  // Home asks for today's plan: ticks from Things come in, and past days' leftovers move to today
  handle('coach:syncDone', () => catchUp())
  handle('coach:rollOver', (date?: string) => rollOver(date))
  handle('coach:dayStats', (date?: string) => dayStats(date))
  handle('coach:journal', () => journal())
  handle('coach:writeJournal', (date: string, text: string) => writeJournal(date, text))
  handle('coach:weekReview', (end?: string) => weekReview(end))
  handle('coach:saveReview', (end: string, r: { wentWell: string; inTheWay: string; change: string }) => saveReview(end, r))
  // The proactive coach (main/proactiveCoach): today's note, the week's and month's, and a run on request
  handle('coach:proactive', async () => (await import('./proactiveCoach')).coachView())
  handle('coach:runCoach', async (kind: 'daily' | 'weekly' | 'monthly') => (await import('./proactiveCoach')).runNow(kind === 'weekly' || kind === 'monthly' ? kind : 'daily'))
  // Goals and the week mixed across them (main/goals)
  handle('portfolio:view', async () => (await import('./goals')).goalsView())
  handle('portfolio:add', async (g: { title: string; date?: string; weight?: import('@shared/goals').GoalWeight }) => (await import('./goals')).addGoal(g))
  handle('portfolio:update', async (g: import('@shared/goals').PlanGoal) => (await import('./goals')).updateGoal(g))
  handle('portfolio:remove', async (id: string) => (await import('./goals')).removeGoal(id))
  handle('portfolio:decompose', async (id: string) => (await import('./goals')).decomposeGoal(id))
  handle('portfolio:resolve', async (goal: string, option: import('@shared/goals').TradeOption) => (await import('./goals')).resolveTradeOff(goal, option))
  handle('portfolio:replan', async () => (await import('./goals')).replanNow())
  // Roadmap continuity (main/track): phases, gates, the phase check, capstones, firm-up and the mixed review
  handle('track:view', async (notebook: string) => (await import('./track')).trackView(String(notebook ?? '')))
  handle('track:override', async (notebook: string, phase: string, note?: string) => (await import('./track')).overridePhase(String(notebook), String(phase), typeof note === 'string' ? note : undefined))
  handle('track:undoOverride', async (notebook: string, phase: string) => (await import('./track')).undoPhaseOverride(String(notebook), String(phase)))
  handle('track:startCheck', async (notebook: string, phase: string, fresh?: boolean) => (await import('./track')).startCheck(String(notebook), String(phase), !!fresh))
  handle('track:submitCheck', async (notebook: string, phase: string, answers: Record<string, string>, selfMarks?: Record<string, 'correct' | 'partial' | 'wrong'>) => (await import('./track')).submitCheck(String(notebook), String(phase), answers && typeof answers === 'object' ? answers : {}, selfMarks && typeof selfMarks === 'object' ? selfMarks : undefined))
  handle('track:setupCapstone', async (notebook: string, phase?: string) => (await import('./track')).setupCapstone(String(notebook), phase ? String(phase) : undefined))
  handle('track:firmUp', async (notebook: string) => (await import('./track')).firmUp(String(notebook)))
  handle('track:mixedReview', async () => (await import('./track')).mixedReviewSetup())
  handle('track:spacedReview', async (recall: import('@shared/spacedReview').SpacedRecall | null, o?: { cards?: boolean }) => (await import('./track')).spacedReviewSetup(recall && typeof recall === 'object' && Array.isArray(recall.concepts) ? recall : null, { cards: o?.cards !== false }))
  handle('track:fading', async () => (await import('./track')).fadingNow())
  // Modules and tracks (main/modules): a track's page, "I'm there", and the switch to modules and back
  handle('modules:status', async () => (await import('./modules')).modulesStatus())
  handle('modules:track', async (notebook: string) => (await import('./modules')).trackView(String(notebook ?? '')))
  handle('modules:there', async (id: string, on: boolean, note?: string) => (await import('./modules')).setThere(String(id), !!on, typeof note === 'string' ? note : undefined))
  handle('modules:preview', async () => (await import('./modules')).switchPreview())
  handle('modules:switch', async () => (await import('./modules')).verifiedSwitch())
  handle('modules:removeFolders', async (paths: string[]) => (await import('./modules')).removeEmptyFolders(Array.isArray(paths) ? paths.map(String) : []))
  handle('modules:switchBack', async () => (await import('./modules')).switchBack())
  handle('modules:projects', async () => (await import('./modules')).projectsView())
  handle('modules:startProject', async (id: string) => (await import('./modules')).startProject(String(id)))
  handle('modules:page', async () => (await import('./modules')).projectsPage())
  handle('modules:queue', async (action: import('@shared/projectQueue').QueueAction) => (await import('./modules')).queueAction(action))
  handle('modules:suggest', async (lately?: string) => (await import('./modules')).suggestProjects(typeof lately === 'string' ? lately.slice(0, 1000) : ''))
  handle('modules:addProject', async (p: import('@shared/projectQueue').SuggestedProject) => (await import('./modules')).addProject(p))
  // North Star: one woven path (main/northStar)
  handle('northStar:view', async () => (await import('./northStar')).view())
  handle('northStar:glance', async () => (await import('./northStar')).glance())
  handle('northStar:suggested', async () => (await import('./northStar')).suggestedGoal())
  handle('northStar:synthesise', async (input: { goal: string; hoursPerWeek?: number }) => (await import('./northStar')).synthesise({ goal: String(input?.goal ?? ''), hoursPerWeek: Number(input?.hoursPerWeek) || undefined }))
  handle('northStar:status', async () => (await import('./northStar')).synthStatus())
  handle('northStar:draft', async () => (await import('./northStar')).currentDraft())
  handle('northStar:discard', async () => (await import('./northStar')).discardDraft())
  handle('northStar:build', async () => (await import('./northStar')).build())
  handle('northStar:decide', async (id: string, ok: boolean) => (await import('./northStar')).decide(String(id ?? ''), !!ok))
  handle('northStar:review', async () => (await import('./northStar')).review(true))
  handle('northStar:moveOn', async () => (await import('./northStar')).moveOn())
  handle('northStar:confirmDepth', async (topic: string, depth: number) => (await import('./northStar')).confirmDepth(String(topic ?? ''), Number(depth) || 0))
  handle('northStar:startCapstone', async () => (await import('./northStar')).startCapstone())
  handle('northStar:install', async () => (await import('./northStar')).installCurrent())
  handle('portfolio:bringForward', async (date: string, index: number) => (await import('./goals')).bringForward(date, index))
  // A tutor that remembers you (main/learnerProfile) and lesson prep while you're away (main/lessonPrep)
  handle('learner:view', async () => (await import('./learnerProfile')).learnerView())
  handle('learner:refresh', async () => {
    const l = await import('./learnerProfile')
    await l.ensureProfile()
    await l.refreshMeasures()
    return l.learnerView()
  })
  handle('learner:correct', async (section: import('@shared/learnerProfile').SectionId, text: string, next: { text?: string; remove?: boolean; resolved?: boolean }) => (await import('./learnerProfile')).correctItem(section, String(text ?? ''), next ?? {}))
  handle('learner:add', async (section: import('@shared/learnerProfile').SectionId, text: string) => (await import('./learnerProfile')).addOwnItem(section, String(text ?? '')))
  handle('learner:rhythm', async (r: import('@shared/learnerProfile').RhythmFacts) => (await import('./learnerProfile')).setRhythm(r))
  handle('prep:status', async () => (await import('./lessonPrep')).prepStatus())
  handle('prep:opening', async (id: string) => (await import('./lessonPrep')).takeOpening(String(id ?? '')))
  handle('prep:get', async (id: string) => (await import('./lessonPrep')).getPrep(String(id ?? '')))
  handle('prep:discard', async (id: string) => (await import('./lessonPrep')).discardPrep(String(id ?? '')))
  handle('prep:now', async () => (await import('./lessonPrep')).tick({ force: true }))
  handle('prep:weeklyReview', async () => {
    const p = await import('./lessonPrep')
    const { claudeTeaches } = await import('./claudeEngine')
    return p.writeWeeklyReview(undefined, { claude: await claudeTeaches().catch(() => false) })
  })
  registerPopouts({
    main: (create) => {
      if ((!win || win.isDestroyed()) && create) createWindow()
      return win && !win.isDestroyed() ? win : null
    },
    build: buildPopout,
    load: (w, hash) => {
      if (process.env.ELECTRON_RENDERER_URL) w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
      else w.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    },
    boundsFile: join(app.getPath('userData'), 'windows.json'),
    screens: () => {
      const primary = screen.getPrimaryDisplay()
      return [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea)
    },
    testCopy
  })
  ipcMain.handle('app:study', (e, status: StudyStatus | null) => {
    const id = e.sender.id
    reportStudy(id, status)
    // A window that closes stops studying
    if (status) e.sender.once('destroyed', () => reportStudy(id, null))
  })
  handle('daily:grade', (req: Parameters<typeof gradeAnswer>[0]) => gradeAnswer(req))
  handle('cloud:keys', () => hasKeys())
  handle('cloud:setKey', (provider: string, key: string | null) => setKey(provider, key))
  handle('cloud:test', (provider: string, model: string) => testCloud(provider, model))
  handle('cloud:models', (provider: string) => listCloudModels(provider))
  handle('cloud:usage', (monthOffset?: number) => usageSummary(monthOffset ?? 0))
  handle('voice:status', () => voiceStatus())
  handle('voice:setup', () => setupVoice((step) => send('voice:progress', step)))
  handle('voice:speak', (text: string, voice?: string, speed?: number) => speak(text, voice, speed))
  handle('voice:transcribe', (wav: Uint8Array, where?: Heard) => transcribe(wav, where))
  handle('voice:hasDeepgram', () => hasDeepgram())
  handle('voice:saveDeepgram', (key: string | null) => saveDeepgram(key))
  handle('voice:warm', (stt: boolean) => warmVoice(stt))
  handle('mistakes:list', () => listMistakes())
  handle('mistakes:due', (n?: number) => mistakesDue(n))
  handle('mistakes:add', (items: NewMistake[]) => addMistakes(items))
  handle('mistakes:retest', (id: string, correct: boolean) => retestMistake(id, correct))
  handle('learn:checkResources', (md: string) => checkOutlineResources(md))
  handle('finance:marketStatus', () => import('./finance/marketFetch').then((m) => m.marketDataStatus(absPath)))
  handle('finance:fetchMarketData', async () => {
    const m = await import('./finance/marketFetch')
    const y = new Date().getFullYear()
    await m.fetchMarketData({ fromYear: y - 1, toYear: y, write: (path, text) => writeText(path, text) })
    return m.marketDataStatus(absPath)
  })
  handle('learn:readyRoadmap', (id: string) => import('./finance/roadmaps').then((m) => m.readyRoadmapText(String(id ?? ''))))
  handle('learn:planReadings', (topic: string, plan: StudyPlan, research: string) => planReadings(topic, plan, research ?? ''))
  handle('learn:planToThings', (path: string, name: string, notebook?: string) => planToThings(path, name, notebook))
  handle('learn:syncFromThings', (path: string) => syncFromThings(path))
  handle('things:status', () => thingsStatus())
  handle('things:today', () => dayTasks())
  handle('books:suggest', (topic: string, limit?: number, context?: string) => pagesToRead(topic, limit, context))
  handle('books:passage', (topic: string, context?: string) => lessonPassage(topic, context))
  handle('books:map', (path: string) => mapBook(path))
  handle('things:setDone', (id: string, done: boolean) => setTaskDone(id, done))
  handle('metabase:status', () => metabaseStatus())
  handle('studyApi:status', () => studyApiStatus())
  handle('bank:status', () => bankStatus())
  handle('bank:prepare', () => prepareBank())
  handle('bank:variant', (mistakeId: string) => variantFor(mistakeId))
  handle('bank:preview', (topic: string) => previewFor(topic))
  handle('bank:opening', (instructions: string, opening: string) => openingFor(instructions, opening))
  handle('bank:warmups', (n?: number) => warmups(n))
  handle('studyApi:set', (patch: { enabled?: boolean; lan?: boolean }) => setStudyApi(patch))
  handle('studyApi:newToken', () => newStudyApiToken())
  handle('metabase:connect', (url: string, key: string) => connectMetabase(url, key))
  handle('metabase:disconnect', () => disconnectMetabase())
  handle('metabase:map', async () => {
    const r = await (await import('./metabaseMap')).refreshMap()
    return { note: r.note, roadmap: r.roadmap, collections: r.map.collections.length, dashboards: r.map.dashboards.length }
  })
  handle('metabase:mapInfo', async () => {
    const { readMap } = await import('./metabaseMap')
    const { YOUR_DATA_NOTE, METABASE_ROADMAP_FILE, METABASE_NOTEBOOK } = await import('@shared/metabaseData')
    const m = await readMap()
    return m ? { at: m.at, host: m.host, collections: m.collections.map((c) => ({ name: c.name, count: c.count, kind: c.kind })), dashboards: m.dashboards.map((d) => ({ id: d.id, name: d.name, cards: d.cards.length, views: d.views })), note: YOUR_DATA_NOTE, roadmap: `Roadmaps/${METABASE_ROADMAP_FILE}`, notebook: METABASE_NOTEBOOK } : null
  })
  handle('metabase:screen', async () => {
    const page = await (await import('./webView')).webText()
    if (!page) return null
    const { metabaseUrl } = await import('./metabase')
    const { metabasePage, pageLabel } = await import('@shared/metabaseData')
    const p = metabaseUrl() ? metabasePage(page.url, metabaseUrl()) : null
    if (!p) return null
    const text = await (await import('./metabaseLearn')).describeMetabasePage(page.url, page.text)
    return { text, label: pageLabel(p), url: page.url }
  })
  handle('learn:adjustPlan', (req: Parameters<typeof adjustPlan>[0]) => adjustPlan(req))
  handle('learn:sizePlan', (id: string, req: PlanRequest) => sizePlan(req, (step) => send('ai:event', { id, type: 'step', step })))
  handle('practice:draftCompanyPrep', (req: CompanyPrepRequest) => {
    draftCompanyPrep(req, (e) => send('ai:event', e))
  })
  handle('practice:cancelCompanyPrep', (id: string) => cancelCompanyPrep(id))
  handle('practice:logInterview', (r: Omit<InterviewRecord, 'id' | 'at'>) => logInterview(r))
  handle('practice:interviews', () => listInterviews())
  handle('practice:logDrill', (r: Omit<DrillResult, 'id' | 'at'>) => logDrill(r))
  handle('practice:drills', () => listDrills())
  // The maths answer box (main/calculator, main/mathsAnswers): the calculator, step checks, read-back and paper
  handle('mathsAnswer:evaluate', (latex: string, angle?: 'rad' | 'deg') => import('./calculator').then((m) => m.evaluate(String(latex ?? ''), angle === 'deg' ? 'deg' : 'rad')))
  handle('mathsAnswer:checkSteps', (lines: string[], angle?: 'rad' | 'deg') => import('./calculator').then((m) => m.checkSteps((lines ?? []).map(String), angle === 'deg' ? 'deg' : 'rad')))
  handle('mathsAnswer:status', (path?: string) => import('./mathsAnswers').then((m) => m.mathsClaude(path)))
  handle('mathsAnswer:readBack', (words: string, question?: string, path?: string) => import('./mathsAnswers').then((m) => m.readBack(String(words ?? ''), question, path)))
  handle('mathsAnswer:readPaper', (paths: string[], question?: string, path?: string) => import('./mathsAnswers').then((m) => m.readPaper((paths ?? []).map(String), question, path)))
  handle('mathsAnswer:mark', (req: { question: string; lines: string[]; path?: string; angle?: 'rad' | 'deg' }) => import('./mathsAnswers').then((m) => m.markWorking(req)))
  handle('maths:state', () => import('./mentalMaths').then((m) => m.mathsState()))
  handle('maths:log', (s: Pick<import('@shared/mentalMaths').MathsSession, 'focus' | 'answers'>) => import('./mentalMaths').then((m) => m.logMathsSession(s)))
  handle('maths:setReminder', (r: import('@shared/mentalMaths').Reminder) => import('./mentalMaths').then((m) => m.setMathsReminder(r)))
  handle('maths:explain', (a: import('@shared/mentalMaths').MathsAnswer) => import('./mentalMaths').then((m) => m.explainMiss(a)))
  handle('workout:state', () => import('./workout').then((m) => m.workoutState()))
  handle('workout:logRound', (r: Parameters<typeof import('./workout').logWorkoutRound>[0]) => import('./workout').then((m) => m.logWorkoutRound(r)))
  handle('workout:drills', () => import('./morningDrills').then((m) => m.drillsTally()))
  handle('workout:setReminder', (r: import('@shared/mentalMaths').Reminder) => import('./workout').then((m) => m.setWorkoutReminder(r)))
  handle('learn:bookChapters', (p: string) => bookChapters(p))
  handle('learn:brief', () => getBrief())
  handle('learn:logFocus', (start: number, end: number, context?: { label?: string; path?: string; kind?: string }) => logFocus(start, end, context))
  handle('learn:focusTime', (p: string) => focusTime(p))
  handle('learn:focusLog', (since: number) => focusLog(since))
  handle('learn:suggestReading', (topics: string[]) => suggestReading(topics))
  handle('ai:models', () => listModels().catch(() => []))
  handle('ai:test', () => testConnection())
  handle('ai:flashcards', (path: string, count: number, focus?: string, pages?: { from: number; to: number }) => generateFlashcards(path, count, focus, pages))
  handle('ai:readAlong', (path: string, passage: string, mode: string, force?: boolean, style?: 'coach') => readAlong(path, passage, mode, force, style))

  handle('learn:graph', () => getGraph())
  handle('learn:brain', () => getBrain())
  handle('ai:tieBreak', (topic: string, options: Parameters<typeof tieBreak>[1], context?: string) => tieBreak(topic, options, context))
  handle('projects:set', (notebook: string, info: Parameters<typeof setProject>[1]) => setProject(notebook, info))
  handle('projects:docs', (notebook: string) => projectDocs(notebook))
  handle('projects:flowSteps', (notebook: string, flow: string) => flowSteps(notebook, flow))
  handle('projects:map', (notebook: string, rebuild?: boolean) => (rebuild === undefined ? projectMap(notebook) : mapProject(notebook, rebuild)))
  handle('projects:draftBrief', (req: Parameters<typeof draftBrief>[0]) => {
    draftBrief(req, (e) => send('ai:event', e))
  })
  handle('learn:brainEvents', () => recentBrainEvents())
  handle('learn:backlinks', (p: string) => getBacklinks(p))
  handle('learn:notebooks', () => getNotebooks())
  handle('learn:updateNotebook', (p: string, patch: Parameters<typeof updateNotebook>[1]) => updateNotebook(p, patch))
  handle('learn:chooseCover', async (p: string) => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose a cover image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    return res.canceled || !res.filePaths[0] ? null : setCoverImage(p, res.filePaths[0])
  })
  handle('learn:setCoverFile', (p: string, file: string) => setCoverImage(p, file))
  handle('learn:clearCover', (p: string) => clearCoverImage(p))
  handle('learn:setStatus', async (p: string, status: LearningStatus) => {
    await setNoteStatus(p, status)
    await reindexPath(p)
  })
  handle('learn:recordQuiz', (paths: string[], score: number, total: number) => recordQuiz(paths, score, total))
  handle('learn:progress', () => getProgress())
  handle('learn:stats', () => getReviewStats())
  handle('learn:threads', (p: string) => getThreads(p))
  handle('learn:saveThreads', (p: string, threads: TutorThread[]) => saveThreads(p, threads))
  handle('learn:recordAttempt', (a: Parameters<typeof recordAttempt>[0]) => recordAttempt(a))
  handle('learn:mastery', () => getMastery())

  handle('library:saveUrl', async (url: string) => {
    const res = await saveUrl(url)
    await reindexPath(res.path)
    return res
  })
  const importPaths = async (paths: string[]) => {
    const results = []
    for (const p of paths) {
      const r = await importFile(p)
      await reindexPath(r.path).catch(() => {})
      results.push(r)
    }
    return results
  }
  handle('library:importFiles', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Add files to your library',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'epub', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp'] }]
    })
    return res.canceled ? [] : importPaths(res.filePaths)
  })
  handle('library:importPaths', (paths: string[]) => importPaths(paths))
  handle('library:topics', () => getLibraryTopics())
  handle('library:setTopics', (p: string, topics: string[]) => setLibraryTopics(p, topics))
  handle('library:status', () => getLibraryStatus())
  handle('library:setStatus', (p: string, status: 'read' | 'reading' | 'unread' | null) => setLibraryStatus(p, status))
  handle('library:thumb', (p: string, image?: string, source?: string) => libraryThumb(p, image, source))

  handle('practice:list', () => listProblems())
  handle('practice:patterns', () => PATTERNS)
  handle('practice:add', (input: Parameters<typeof addProblem>[0]) => addProblem(input))
  handle('practice:addChallenge', (input: Parameters<typeof addChallenge>[0]) => addChallenge(input))
  handle('practice:addStarter', () => addStarterSet())
  handle('practice:update', (id: string, patch: Parameters<typeof updateProblem>[1]) => updateProblem(id, patch))
  handle('practice:remove', (id: string) => removeProblem(id))
  handle('practice:record', (id: string, score: number, summary: string) => recordInterview(id, score, summary))
  handle('goals:list', () => getGoals())
  handle('recall:queue', () => getRecallQueue())
  handle('recall:review', (p: string, grade: 'again' | 'hard' | 'good' | 'easy') => reviewRecall(p, grade))
  handle('goals:save', (goals: Parameters<typeof saveGoals>[0]) => saveGoals(goals))
  handle('exam:generate', (scope: ChatScope, topic: string, opts: Parameters<typeof generateExam>[2]) => generateExam(scope, topic, opts))
  handle('exam:mark', (q: Parameters<typeof markPart>[0], i: number, answer: string, images: string[]) => markPart(q, i, answer, images))
  handle('lab:query', (id: string, sql: string) => labQuery(String(id ?? ''), String(sql ?? '')))
  handle('lab:schema', (id: string) => labSchema(String(id ?? '')))
  handle('lab:reset', (id: string) => labReset(String(id ?? '')))
  handle('lab:load', (id: string, path: string) => labLoadTable(String(id ?? ''), String(path ?? '')))
  handle('runner:run', (language: string, code: string, stdin?: string, opts?: { tests?: string; labId?: string }) => {
    // A pipeline or SQL on their own Metabase runs there, read-only (main/metabaseLearn)
    // (a pipeline in a ```js block is one too: db.<collection>.aggregate([...]) means nothing to Node)
    const pipelineInJs = /^(js|javascript|mongo)$/i.test(String(language ?? '')) && /^\s*(\/\/[^\n]*\n\s*)*db\.[\w$-]+\.aggregate\s*\(/.test(String(code ?? ''))
    if (language === 'mongodb' || language === 'metabase-sql' || pipelineInJs) return import('./metabaseLearn').then((m) => m.runAnswer(pipelineInJs ? 'mongodb' : String(language), String(code ?? '')))
    // SQL in a code question runs in the lesson's data lab, like its ```sql blocks
    if (isSql(String(language ?? '')) && opts?.labId) {
      const r = labQuery(String(opts.labId), String(code ?? ''))
      return { stdout: r.error ? '' : resultText(r), stderr: r.error ? `Error: ${r.error}` : '', exitCode: r.error ? 1 : 0, timedOut: false, durationMs: Math.round(r.elapsedMs) }
    }
    // Postgres in a code question runs in the lesson's Postgres database (the Postgres pack)
    if (/^(postgres(ql)?|pgsql|psql)$/i.test(String(language ?? ''))) {
      return import('./packs/postgres').then(async (m) => {
        const r = await m.pgQuery(String(opts?.labId ?? 'scratch'), String(code ?? ''), { session: m.sessionOf(String(code ?? '')) })
        return { stdout: r.error ? '' : resultText(r), stderr: r.error ? `Error: ${r.error}` : '', exitCode: r.error ? 1 : 0, timedOut: false, durationMs: Math.round(r.elapsedMs) }
      })
    }
    return runCode(language, code, stdin, undefined, { tests: typeof opts?.tests === 'string' ? opts.tests : undefined })
  })
  // A link that arrived before the window was ready is picked up once, when the app has loaded
  handle('app:pendingLink', () => {
    const l = pendingLink
    pendingLink = null
    return l
  })
  handle('runner:runFile', (path: string, stdin?: string) => runProject(absPath(path), stdin))
  handle('runner:mathStatus', () => mathStatus())
  handle('runner:speedStatus', () => speedStatus())
  handle('runner:applySpeedups', () => applySpeedups())
  handle('runner:librariesStatus', () => librariesStatus())
  handle('runner:setupLibraries', () => setupLibraries())
  handle('runner:labStatus', () => labStatus())
  handle('runner:setupLab', () => setupLab((step) => send('runner:labProgress', step)))
  // Maths animations (main/manim): installing, rendering and the cache
  void import('./manim').then((m) => m.onAnimStatus((s) => send('manim:status', s)))
  handle('manim:status', () => import('./manim').then(async (m) => ({ manim: await m.manimStatus(true), tex: await m.texStatus(), settings: await m.animSettings() })))
  handle('manim:install', () => import('./manim').then((m) => m.setupManim((step) => send('manim:installProgress', step))))
  handle('manim:installTex', () => import('./manim').then((m) => m.setupTex((step) => send('manim:texProgress', step))))
  handle('manim:settings', (patch: unknown) => import('./manim').then((m) => m.setAnimSettings(patch && typeof patch === 'object' ? (patch as never) : {})))
  handle('manim:request', (req: unknown) => import('./manim').then((m) => (req && typeof req === 'object' ? m.requestAnimation(req as never) : null)))
  handle('manim:get', (key: string) => import('./manim').then((m) => m.animationStatus(String(key ?? ''))))
  handle('manim:used', (key: string) => import('./manim').then((m) => m.animationUsed(String(key ?? ''))))
  handle('runner:languagesStatus', () => languagesStatus())
  handle('runner:setupMath', () => setupMath())
  handle('websearch:status', () => searchStatus())
  handle('websearch:setup', () => setupSearch())

  handle('highlights:get', (p: string) => getHighlights(p))
  handle('highlights:save', (p: string, list: PdfHighlight[]) => saveHighlights(p, list))
  // humanities: books, free books, Discuss this, reading together, the notes page (src/main/reading)
  registerReading(handle)
  // The reading room (Library › Reading), covers for any note, and reading aloud (main/readingRoom, main/tts)
  registerReadingRoom(handle, async (filters) => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters })
    return res.canceled ? null : res.filePaths[0]
  })
  registerTts(handle)
  handle('room:import', async () => {
    const res = await dialog.showOpenDialog(win!, { title: 'Add a book to your shelf', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Books', extensions: ['epub', 'pdf'] }] })
    if (res.canceled) return []
    const added = []
    for (const r of await importPaths(res.filePaths)) added.push(await addToShelf(r.path))
    return added
  })

  handle('study:cards', (scope: ChatScope) => getCards(scope))
  handle('study:review', (id: string, grade: ReviewGrade, path: string) => reviewCard(id, grade, path))
  handle('study:saveCards', async (p: string, md: string) => {
    const path = await saveCards(p, md)
    await reindexPath(path)
    return path
  })

  handle('app:openExternal', (url: string) => shell.openExternal(url))
  // Dictation goes through Handy, which types into the focused field; we only read its shortcut
  handle('voice:handy', async () => {
    const { readFile } = await import('fs/promises')
    const file = join(app.getPath('home'), 'Library', 'Application Support', 'com.pais.handy', 'settings_store.json')
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      const s = data.settings ?? data
      const raw: string = s.bindings?.transcribe?.current_binding ?? ''
      const pretty = raw
        .split('+')
        .map((k: string) => ({ ctrl_left: 'Ctrl', ctrl_right: 'Ctrl', control: 'Ctrl', option: 'Option', alt: 'Option', shift: 'Shift', command: '⌘', cmd: '⌘', fn: 'Fn', space: 'Space' })[k.toLowerCase()] ?? k.toUpperCase())
        .join(' + ')
      return { installed: true, shortcut: pretty || 'your Handy shortcut', model: String(s.selected_model ?? '').split('/').pop() ?? '' }
    } catch {
      return { installed: false, shortcut: '', model: '' }
    }
  })
  // Wispr Flow: installed, and its push-to-talk key (read from its settings, shortcuts only)
  handle('voice:flow', async () => {
    const { readFile, access } = await import('fs/promises')
    const installed = await access('/Applications/Wispr Flow.app').then(() => true, () => false)
    try {
      const data = JSON.parse(await readFile(join(app.getPath('home'), 'Library', 'Application Support', 'Wispr Flow', 'config.json'), 'utf8'))
      const shortcuts: Record<string, string> = data?.prefs?.user?.shortcuts ?? {}
      const keys = Object.entries(shortcuts).find(([, v]) => v === 'ptt')?.[0]
      return { installed, pushToTalk: keys ? flowKeys(keys) : '' }
    } catch {
      return { installed, pushToTalk: '' }
    }
  })
}

/** Flow keeps shortcuts as macOS key codes ("59+63"): as you'd read them */
const MAC_KEYS: Record<string, string> = { '63': 'Fn', '58': 'Left ⌥', '61': 'Right ⌥', '59': 'Left ⌃', '62': 'Right ⌃', '55': 'Left ⌘', '54': 'Right ⌘', '56': 'Left ⇧', '60': 'Right ⇧', '49': 'Space', '53': 'Esc', '57': 'Caps Lock' }
const flowKeys = (codes: string) => codes.split('+').map((c) => MAC_KEYS[c] ?? `key ${c}`).join(' + ')

const themeSource = (theme: Settings['theme']) =>
  theme === 'system' ? 'system' : theme === 'light' || theme === 'sepia' ? 'light' : 'dark'

/** A menu command goes to the window in front (a pop-out's ⌘N is its own), or the main one */
const toFront = (action: string) => {
  const w = BrowserWindow.getFocusedWindow() ?? (win && !win.isDestroyed() ? win : null)
  if (w && !w.webContents.isDestroyed()) w.webContents.send('menu', action)
}

function setMenu() {
  // A pop-out offers the way back; the main window, the way out
  const front = BrowserWindow.getFocusedWindow()
  const inPopout = isPopout(front?.webContents)
  const send = (_channel: 'menu', action: string) => toFront(action)
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-note') },
        // From the key, the page may own ⌘⇧N (a course's notes): renderer lib/shiftN decides
        { label: 'New Topic…', accelerator: 'CmdOrCtrl+Shift+N', click: (_item, _win, e) => send('menu', e.triggeredByAccelerator ? 'new-topic-key' : 'new-topic') },
        { label: 'Save Link…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'save-link') },
        { label: 'Add Files…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu', 'import') },
        { type: 'separator' },
        { label: 'Change Notes Folder…', click: () => send('menu', 'choose-vault') },
        { type: 'separator' },
        // Tabs (renderer lib/tabs). The page hears these first: the IDE keeps ⌘W and ⌘T for its own
        // file tabs and symbols, and ⇧⌘T for reopening a file, by handling them before the menu does
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', enabled: !inPopout, click: () => send('menu', 'new-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('menu', 'close-tab') },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: !inPopout, click: () => send('menu', 'reopen-tab') },
        { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: () => send('menu', 'toggle-sidebar') },
        { label: 'Toggle AI Panel', accelerator: 'CmdOrCtrl+J', click: () => send('menu', 'toggle-chat') },
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: () => send('menu', 'search') },
        { label: 'Toggle Edit Mode', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'toggle-edit') },
        { type: 'separator' },
        ...popMenuItems(inPopout, (action) => send('menu', action)),
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }, { role: 'reload' }] as const))
      ]
    },
    {
      label: 'Study',
      submenu: [
        { label: 'Review Flashcards', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('menu', 'review') },
        { label: 'Quiz Me on This', accelerator: 'CmdOrCtrl+Shift+Q', click: () => send('menu', 'quiz') }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Tide Guide', accelerator: 'CmdOrCtrl+?', click: () => send('menu', 'help') },
        { type: 'separator' },
        // ⌃⌘B: free in Tide (⌘B and ⌥⌘B are the code editor's), and not one of macOS's own
        { label: 'Report a Bug…', accelerator: 'Ctrl+Cmd+B', click: () => void openBugSheet() }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Lets CDP tooling attach during development, never in packaged builds
// Development only: a separate profile, so a test copy can run beside the one in use
if (!app.isPackaged && process.env.TIDE_USER_DATA) {
  // Lets the window's tooling hooks on (see preload); never set in the packaged app
  process.env.TIDE_TEST_COPY = '1'
  app.setPath('userData', process.env.TIDE_USER_DATA)
  // Keys a test copy saves (a mock Metabase's, say) are encrypted with a stand-in keychain, never the Mac's
  app.commandLine.appendSwitch('use-mock-keychain')
  // A test copy runs behind other windows; keep it rendering so measurements are real
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

if (!app.isPackaged && process.env.TIDE_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.TIDE_REMOTE_DEBUGGING_PORT)
}

// tide:// links: Things 4 tasks open Tide at the exam, note or drill they're about
let pendingLink: string | null = null
const openLink = (url: string) => {
  if (!url.startsWith('tide://')) return
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    // The main window opens links; a pop-out keeps to its one thing
    win.webContents.send('deeplink', url)
    if (win.isMinimized()) win.restore()
    win.focus()
  } else pendingLink = url
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  openLink(url)
})
// Only the installed app claims tide:// links, so a development copy never takes them over
if (app.isPackaged) app.setAsDefaultProtocolClient('tide')

app.whenReady().then(() => {
  nativeTheme.themeSource = themeSource(getSettings().theme)
  // YouTube's embedded player refuses to play without a referrer saying which app embeds it
  // (error 153), and a window loaded from a file sends none. YouTube asks apps to send their app id
  // as an https URL; only the player's own requests are touched.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*'] }, (d, done) => {
    const h = d.requestHeaders
    if (!h.Referer && !h.referer) h.Referer = 'https://app.tide.study/'
    done({ requestHeaders: h })
  })
  wakeSearch().catch(() => {})
  // Gemma loads on demand while Claude teaches (main/modelIdle). When Claude can't (not set up,
  // logged out, at its limit, offline, or Gemma chosen), as before: start the model server if it
  // isn't running, turn on prefix caching and the draft model, then load the chat and lesson
  // prompts into it, so the first reply is quick
  const warm = () => warmChat().then(() => warmLessons())
  const ready = () => getGemmaReady(warm)
  // Claude teaching and Gemma loaded with nobody using it: its 10 GB go back to the Mac now
  ready()
    .then(() => unloadIdleAtLaunch())
    .catch(() => {})
  // Claude Code in the terminal reaches Tide's tools on a fixed port, while Tide is open (when set up)
  if (getSettings().ai.claude?.terminalPort) void import('./tideMcp').then((m) => m.ensureMcp()).catch(() => {})
  // The model's memory goes back to the Mac when you aren't studying, and loads as you return (when Gemma is wanted)
  watchModelIdle()
  watchBackups()
  app.on('browser-window-focus', () => wakeModel(() => warmChat()))
  // A restarted (or closed) server forgets all that, and Claude may have hit its limit: check each minute
  setInterval(() => void minuteCheck(warm).catch(() => {}), 60_000)
  // After sleep, the server may have dropped what it had ready: get Gemma ready again before you ask (when it's wanted)
  powerMonitor.on('resume', () => setTimeout(() => ready().catch(() => {}), 4000))
  powerMonitor.on('unlock-screen', () => setTimeout(() => ready().catch(() => {}), 2000))

  // Claude's visuals: their frames' documents, no permissions, no web requests, and (in development, which has no page CSP) frame-src
  handleVisualProtocol()
  // The maths libraries a visual may load (main/visualLibs), built into the app
  void import('./visualLibs').then((l) => import('./visualFrames').then((f) => f.serveVisualLibraries(l.libraryFor)))
  denyVisualPermissions(session.defaultSession)
  blockVisualRequests(session.defaultSession)
  if (process.env.ELECTRON_RENDERER_URL) devFrameSrc(session.defaultSession, process.env.ELECTRON_RENDERER_URL, APP_CSP)

  // Serves vault files (images, PDFs) to the renderer: vault://file/<relative path>
  protocol.handle('vault', (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
    try {
      return net.fetch(pathToFileURL(absPath(rel)).toString(), { headers: req.headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  // Maths animations: tide-anim://v/<key>.mp4, only from the animation cache (main/manim)
  protocol.handle('tide-anim', async (req) => {
    const key = /^\/(m[a-z0-9]+)\.mp4$/.exec(new URL(req.url).pathname)?.[1] ?? ''
    const f = key ? (await import('./manim')).videoPath(key) : null
    if (!f) return new Response('Not found', { status: 404 })
    return (await import('./manim')).videoResponse(f, req.headers.get('range'))
  })

  registerIpc()
  // Today's cloud use so far, so the daily free allowance is tracked across restarts
  loadDayUse()
  loadStats()
  // The problem bank tops itself up for what's coming, with the cloud models
  startBank()
  // Lesson prep while you're away, and the weekly review (main/lessonPrep)
  void import('./lessonPrep').then((p) => p.startPrep())
  // The proactive coach: the daily look on the first open of the day, the weekly and monthly reviews when due
  void import('./proactiveCoach').then((c) => c.startCoach())
  // The notes folder moved while Tide was closed or open: follow it, or ask where it went
  followVault(
    (path) => {
      startVault()
      send('vault:moved', path)
    },
    (old) => send('vault:missing', old)
  )
  // The study data API, when it's turned on in Settings › Tools
  startStudyApi().catch(() => {})
  setMenu()
  // Its items follow the window in front (a pop-out has "Return to Main Window")
  app.on('browser-window-focus', () => setMenu())
  createWindow()
  onBrainEvent((e) => BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send('brain:event', e)))
  onModelBusy((busy) => BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send('model:busy', busy)))
  // Where you're heading, worked out quietly once the app has settled (every few days at most)
  setTimeout(() => inferDirection().catch(() => {}), 90_000)
  // A new week plans itself (the first check a few minutes after launch, then every few hours)
  setTimeout(() => autoPlanWeek().catch(() => {}), 240_000)
  // Yesterday's leftovers move on even if Home isn't open: soon after starting, then each hour
  setTimeout(() => catchUp().catch(() => {}), 20_000)
  setInterval(() => catchUp().catch(() => {}), 3_600_000)
  // North Star's weekly check: Opus proposes small changes from your progress (main/northStar)
  setTimeout(() => void import('./northStar').then((m) => m.weeklyCheck()).catch(() => {}), 300_000)
  setInterval(() => void import('./northStar').then((m) => m.weeklyCheck()).catch(() => {}), 3_600_000)
  setInterval(() => autoPlanWeek().catch(() => {}), 4 * 3_600_000)
  // Books you own get a map (chapters, pages, what each covers) in the background, a few at a time
  setTimeout(() => mapNewBooks().catch(() => {}), 180_000)
  // Roadmaps sorted against your aims, for anything new since last time
  setTimeout(() => sortRoadmaps().catch(() => {}), 150_000)
  setInterval(() => sortRoadmaps().catch(() => {}), 6 * 3_600_000)
  setInterval(() => mapNewBooks().catch(() => {}), 6 * 3_600_000)
  // The catalogue kept fresh: new and updated courses in your subjects, looked for once a week (never while a lesson runs)
  void import('./courseFresh').then((f) => f.startCourseWatch()).catch(() => {})
  // The tutor in the menu bar; its menu opens today's items and views in the main window
  initTray({
    agenda: async () => todayItems(await getWeek(localDate()), localDate()),
    command: (c) => {
      if (win && !win.isDestroyed()) {
        win.show()
        win.focus()
        win.webContents.send('tray:command', c)
      }
    }
  })
  // The morning workout: a notification at the time you chose, when today's morning isn't done
  void import('./workout').then((m) =>
    m.startWorkoutReminder(() => {
      if (win && !win.isDestroyed()) {
        win.show()
        win.focus()
        win.webContents.send('tray:command', { type: 'view', view: { kind: 'workout', nonce: Date.now() } })
      }
    }, {
      // Notifications off for Tide: said in the window instead
      inApp: (r) => win && !win.isDestroyed() && win.webContents.send('tray:command', { type: 'remind', title: r.title, body: r.body, view: { kind: 'workout', nonce: Date.now() } }),
      ...(!app.isPackaged && process.env.TIDE_TEST_COPY && process.env.TIDE_REMINDER_NOW ? { anyHour: true, firstAfterMs: 8000 } : {})
    })
  )
  startVault()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// No lab container outlives the app
app.on('before-quit', () => {
  setQuitting()
  void import('./claudeEngine').then((c) => c.stopClaude()).catch(() => {})
  void import('./calculator').then((c) => c.stopCalculator()).catch(() => {})
  void import('./tideMcp').then((m) => m.mcpHandle()?.close()).catch(() => {})
  stopStudyApi().catch(() => {})
  closeAllTerminals()
  stopVoice()
  stopSearch()
  void stopLanguageServer()
  void stopIde()
  void stopNotebooks()
  void stopPacks()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
