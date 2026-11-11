import { gradeAnswer } from './daily'
import { hasKeys, listCloudModels, loadDayUse, loadStats, setKey, testCloud, usageSummary } from './cloud'
import { connectMetabase, disconnectMetabase, metabaseStatus } from './metabase'
import { followVault } from './vaultHome'
import { bankStatus, openingFor, prepare as prepareBank, previewFor, startBank, variantFor, warmups } from './bank'
import { newStudyApiToken, setStudyApi, startStudyApi, stopStudyApi, studyApiStatus } from './studyApi'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, powerMonitor } from 'electron'
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
import { labLoadTable, labQuery, labReset, labSchema } from './lab'
import { isSql, languagesStatus } from './languages'
import { labStatus, librariesStatus, mathStatus, runCode, runProject, setupLab, setupLibraries, setupMath } from './runner'
import { searchStatus, setupSearch, stopSearch, wakeSearch } from './websearch'
import { applySpeedups, ensureModelServer, serverReady, speedStatus, tuneModelServer } from './modelServer'
import { labFlashcards } from './labCards'
import { prewarmLesson, warmChat, warmLessons } from './agent'
import { inUse, wakeModel, watchModelIdle } from './modelIdle'
import { inBackground, onModelBusy } from './modelQueue'
import { cancelDraft, draftOutline } from './outlineDraft'
import { cancelCompanyPrep, draftCompanyPrep } from './companyPrep'
import { adjustPlan, auditRoadmap, planReadings, planToThings, sizePlan, syncFromThings, type PlanRequest } from './planner'
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
import { draftBrief, flowSteps, mapProject, privatePath, projectDocs, projectMap, setProject } from './projects'
import { onBrainEvent, recentBrainEvents } from './brainEvents'
import { getCoach, getWeek, planWeek, saveCoach, updateProfile, inferDirection, autoPlanWeek, weekToThings, setItemDone, catchUp, rollOver, dayStats, journal, writeJournal, weekReview, saveReview, savePlacement, addTopicAfter } from './coach'
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

protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
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

/**
 * A lesson, exam or drill in its own window, with nothing else on screen. The view (and a lesson's
 * conversation so far) is handed over through main, so the new window carries on where it was.
 */
const focusViews = new Map<string, unknown>()
function openFocusWindow(view: unknown) {
  const id = Math.random().toString(36).slice(2, 10)
  focusViews.set(id, view)
  const w = new BrowserWindow({
    width: 1080,
    height: 820,
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
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#focus=${id}`)
  else w.loadFile(join(__dirname, '../renderer/index.html'), { hash: `focus=${id}` })
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

  handle('settings:get', () => getSettings())
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
  handle('ai:prewarm', (req: Omit<ChatRequest, 'id'>) => prewarmLesson(req))
  setChatsChangedListener((id) => send('chats:changed', id))
  setTerminalListeners(
    (id, data) => send('terminal:data', { id, data }),
    (id, code) => send('terminal:exit', { id, code })
  )
  handle('terminal:create', (kind: TerminalKind, cols: number, rows: number) => createTerminal(kind === 'lab' ? 'lab' : 'local', cols, rows))
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
    // Nothing yet: look it up in the background, for next time (never for a private project)
    if (!have.length) findReadings({ topic, path }).catch(() => {})
    return have
  })
  handle('curriculum:placed', (setup: PlacementSetup, results: Record<string, Known>) => savePlacement(setup, results))
  handle('curriculum:propose', (notebook: string) => proposeChanges(notebook))
  handle('curriculum:addTopic', (notebook: string, afterId: string, title: string) => addTopicAfter(notebook, afterId, title))
  handle('lessons:challenge', (topic: string, where: string | undefined, reply: string) => challengeReply(topic, where, reply))
  handle('connections:list', (fresh?: boolean) => listConnections(fresh))
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
  handle('knowledge:view', async () => (await import('./knowledge')).knowledgeView())
  // ---- Guided projects and adaptive difficulty (main/workshop.ts, main/difficulty.ts) ----
  const workshop = () => import('./workshop')
  handle('workshop:list', async () => (await workshop()).listWorkshop())
  handle('workshop:start', async (id: string, from?: { notebook?: string; topic?: string }) => (await workshop()).startProject(String(id), from))
  handle('workshop:state', async (id: string) => (await workshop()).workshopState(String(id)))
  handle('workshop:run', async (id: string) => (await workshop()).runStage(String(id)))
  handle('workshop:hint', async (id: string) => (await workshop()).nextHint(String(id)))
  handle('workshop:review', async (id: string) => (await workshop()).reviewStage(String(id)))
  handle('workshop:ask', async (id: string, question: string) => (await workshop()).askAboutStage(String(id), String(question ?? '')))
  handle('workshop:forTopic', async (topic: string) => (await workshop()).projectForTopic(String(topic ?? '')))
  handle('workshop:propose', async (o: { topic: string; notebook?: string; section?: string }) => (await workshop()).proposeProject({ topic: String(o?.topic ?? ''), notebook: o?.notebook, section: o?.section }))
  handle('difficulty:known', async (topic: string, path?: string) => (await import('./difficulty')).knownFor(String(topic ?? ''), path))
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
  handle('coach:setDone', (date: string, index: number, done: boolean) => setItemDone(date, index, done))
  // Home asks for today's plan: ticks from Things come in, and past days' leftovers move to today
  handle('coach:syncDone', () => catchUp())
  handle('coach:rollOver', (date?: string) => rollOver(date))
  handle('coach:dayStats', (date?: string) => dayStats(date))
  handle('coach:journal', () => journal())
  handle('coach:writeJournal', (date: string, text: string) => writeJournal(date, text))
  handle('coach:weekReview', (end?: string) => weekReview(end))
  handle('coach:saveReview', (end: string, r: { wentWell: string; inTheWay: string; change: string }) => saveReview(end, r))
  handle('window:openFocus', (view: unknown) => openFocusWindow(view))
  handle('window:focusView', (id: string) => {
    const v = focusViews.get(id) ?? null
    focusViews.delete(id)
    return v
  })
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
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
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp'] }]
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
  handle('lab:load', (id: string, path: string) => labLoadTable(String(id ?? ''), String(path ?? ''), privatePath))
  handle('runner:run', (language: string, code: string, stdin?: string, opts?: { tests?: string; labId?: string }) => {
    // SQL in a code question runs in the lesson's data lab, like its ```sql blocks
    if (isSql(String(language ?? '')) && opts?.labId) {
      const r = labQuery(String(opts.labId), String(code ?? ''))
      return { stdout: r.error ? '' : resultText(r), stderr: r.error ? `Error: ${r.error}` : '', exitCode: r.error ? 1 : 0, timedOut: false, durationMs: Math.round(r.elapsedMs) }
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
  handle('runner:languagesStatus', () => languagesStatus())
  handle('runner:setupMath', () => setupMath())
  handle('websearch:status', () => searchStatus())
  handle('websearch:setup', () => setupSearch())

  handle('highlights:get', (p: string) => getHighlights(p))
  handle('highlights:save', (p: string, list: PdfHighlight[]) => saveHighlights(p, list))

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

function setMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-note') },
        { label: 'New Topic…', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('menu', 'new-topic') },
        { label: 'Save Link…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'save-link') },
        { label: 'Add Files…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu', 'import') },
        { type: 'separator' },
        { label: 'Change Notes Folder…', click: () => send('menu', 'choose-vault') },
        { type: 'separator' },
        { role: 'close' }
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
      submenu: [{ label: 'Tide Guide', accelerator: 'CmdOrCtrl+?', click: () => send('menu', 'help') }]
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
  if (win && !win.webContents.isDestroyed()) {
    send('deeplink', url)
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
  wakeSearch().catch(() => {})
  // Start the model server if it isn't running, turn on prefix caching and the draft model, then
  // load the chat and lesson prompts into it, so the first reply is quick
  const ready = async () => {
    if ((await ensureModelServer()) === 'started') await serverReady()
    const r = await tuneModelServer()
    // Not when you haven't used the model for a while (the Mac just woke with Tide in the background): it stays unloaded until you come back
    if (r !== 'unsupported' && inUse()) await warmChat().then(() => warmLessons())
  }
  ready().catch(() => {})
  // The model's memory goes back to the Mac when you aren't studying, and loads as you return
  watchModelIdle()
  app.on('browser-window-focus', () => wakeModel(() => warmChat()))
  // A restarted (or closed) server forgets all that: check each minute, when the model is free
  setInterval(() => {
    inBackground(
      async () => {
        if ((await ensureModelServer()) === 'started') await serverReady()
        return tuneModelServer()
      },
      undefined,
      false
    )
      .then((r) => (r === 'enabled' && inUse() ? warmChat().then(() => warmLessons()) : undefined))
      .catch(() => {})
  }, 60_000)
  // After sleep, the server may have dropped what it had ready: get Gemma ready again before you ask
  powerMonitor.on('resume', () => setTimeout(() => ready().catch(() => {}), 4000))
  powerMonitor.on('unlock-screen', () => setTimeout(() => ready().catch(() => {}), 2000))

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

  registerIpc()
  // Today's cloud use so far, so the daily free allowance is tracked across restarts
  loadDayUse()
  loadStats()
  // The problem bank tops itself up for what's coming, with the cloud models
  startBank()
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
  setInterval(() => autoPlanWeek().catch(() => {}), 4 * 3_600_000)
  // Books you own get a map (chapters, pages, what each covers) in the background, a few at a time
  setTimeout(() => mapNewBooks().catch(() => {}), 180_000)
  // Roadmaps sorted against your aims, for anything new since last time
  setTimeout(() => sortRoadmaps().catch(() => {}), 150_000)
  setInterval(() => sortRoadmaps().catch(() => {}), 6 * 3_600_000)
  setInterval(() => mapNewBooks().catch(() => {}), 6 * 3_600_000)
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
  startVault()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// No lab container outlives the app
app.on('before-quit', () => {
  stopStudyApi().catch(() => {})
  closeAllTerminals()
  stopVoice()
  stopSearch()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
