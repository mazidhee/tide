import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChatEvent, TideApi } from '@shared/types'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

const subscribe = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TideApi = {
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set')
  },
  vault: {
    choose: invoke('vault:choose'),
    tree: invoke('vault:tree'),
    read: invoke('vault:read'),
    write: invoke('vault:write'),
    writeImage: invoke('vault:writeImage'),
    createNote: invoke('vault:createNote'),
    createFolder: invoke('vault:createFolder'),
    rename: invoke('vault:rename'),
    trash: invoke('vault:trash'),
    reveal: invoke('vault:reveal'),
    resolveLink: invoke('vault:resolveLink'),
    notes: invoke('vault:notes'),
    onChange: (cb) => subscribe<string[]>('vault:changed', cb)
  },
  search: {
    query: invoke('search:query')
  },
  code: {
    list: invoke('code:list'),
    create: invoke('code:create')
  },
  terminal: {
    create: invoke('terminal:create'),
    write: invoke('terminal:write'),
    resize: invoke('terminal:resize'),
    close: invoke('terminal:close'),
    flashcards: invoke('terminal:flashcards'),
    onData: (cb) => subscribe<{ id: string; data: string }>('terminal:data', cb),
    onExit: (cb) => subscribe<{ id: string; code: number }>('terminal:exit', cb)
  },
  chats: {
    list: invoke('chats:list'),
    get: invoke('chats:get'),
    rename: invoke('chats:rename'),
    pin: invoke('chats:pin'),
    remove: invoke('chats:remove'),
    onChanged: (cb) => subscribe<string>('chats:changed', cb)
  },
  memory: {
    list: invoke('memory:list'),
    add: invoke('memory:add'),
    update: invoke('memory:update'),
    remove: invoke('memory:remove')
  },
  ai: {
    chat: invoke('ai:chat'),
    prewarm: invoke('ai:prewarm'),
    cancel: invoke('ai:cancel'),
    onEvent: (cb) => subscribe<ChatEvent>('ai:event', cb),
    models: invoke('ai:models'),
    test: invoke('ai:test'),
    generateFlashcards: invoke('ai:flashcards'),
    tieBreak: invoke('ai:tieBreak'),
    readAlong: invoke('ai:readAlong')
  },
  learn: {
    graph: invoke('learn:graph'),
    brain: invoke('learn:brain'),
    brainEvents: invoke('learn:brainEvents'),
    backlinks: invoke('learn:backlinks'),
    notebooks: invoke('learn:notebooks'),
    updateNotebook: invoke('learn:updateNotebook'),
    draftOutline: invoke('learn:draftOutline'),
    cancelDraft: invoke('learn:cancelDraft'),
    sizePlan: invoke('learn:sizePlan'),
    adjustPlan: invoke('learn:adjustPlan'),
    auditRoadmap: invoke('learn:auditRoadmap'),
    planToThings: invoke('learn:planToThings'),
    planReadings: invoke('learn:planReadings'),
    syncFromThings: invoke('learn:syncFromThings'),
    thingsStatus: invoke('things:status'),
    thingsToday: invoke('things:today'),
    thingsSetDone: invoke('things:setDone'),
    bookChapters: invoke('learn:bookChapters'),
    brief: invoke('learn:brief'),
    logFocus: invoke('learn:logFocus'),
    focusTime: invoke('learn:focusTime'),
    focusLog: invoke('learn:focusLog'),
    suggestReading: invoke('learn:suggestReading'),
    chooseCover: invoke('learn:chooseCover'),
    setCoverFile: invoke('learn:setCoverFile'),
    clearCover: invoke('learn:clearCover'),
    setStatus: invoke('learn:setStatus'),
    recordQuiz: invoke('learn:recordQuiz'),
    progress: invoke('learn:progress'),
    stats: invoke('learn:stats'),
    threads: invoke('learn:threads'),
    saveThreads: invoke('learn:saveThreads'),
    recordAttempt: invoke('learn:recordAttempt'),
    mastery: invoke('learn:mastery')
  },
  practice: {
    list: invoke('practice:list'),
    patterns: invoke('practice:patterns'),
    add: invoke('practice:add'),
    addChallenge: invoke('practice:addChallenge'),
    addStarter: invoke('practice:addStarter'),
    update: invoke('practice:update'),
    remove: invoke('practice:remove'),
    record: invoke('practice:record'),
    draftCompanyPrep: invoke('practice:draftCompanyPrep'),
    cancelCompanyPrep: invoke('practice:cancelCompanyPrep'),
    logInterview: invoke('practice:logInterview'),
    interviews: invoke('practice:interviews'),
    logDrill: invoke('practice:logDrill'),
    drills: invoke('practice:drills')
  },
  sources: {
    lesson: invoke('sources:lesson')
  },
  lessons: {
    save: invoke('lessons:save'),
    list: invoke('lessons:list'),
    get: invoke('lessons:get'),
    challenge: invoke('lessons:challenge')
  },
  readings: {
    for: invoke('readings:for')
  },
  curriculum: {
    status: invoke('curriculum:status'),
    sort: invoke('curriculum:sort'),
    view: invoke('curriculum:view'),
    setOverride: invoke('curriculum:setOverride'),
    placed: invoke('curriculum:placed'),
    propose: invoke('curriculum:propose'),
    addTopic: invoke('curriculum:addTopic')
  },
  coach: {
    get: invoke('coach:get'),
    save: invoke('coach:save'),
    week: invoke('coach:week'),
    planWeek: invoke('coach:planWeek'),
    profile: invoke('coach:profile'),
    infer: invoke('coach:infer'),
    toThings: invoke('coach:toThings'),
    setDone: invoke('coach:setDone'),
    syncDone: invoke('coach:syncDone'),
    rollOver: invoke('coach:rollOver'),
    dayStats: invoke('coach:dayStats'),
    journal: invoke('coach:journal'),
    writeJournal: invoke('coach:writeJournal'),
    weekReview: invoke('coach:weekReview'),
    saveReview: invoke('coach:saveReview')
  },
  studying: invoke('app:study'),
  onTrayCommand: (cb) => {
    const off = subscribe('tray:command', cb as (c: unknown) => void)
    return () => void off()
  },
  windows: {
    openFocus: invoke('window:openFocus'),
    focusView: invoke('window:focusView'),
    close: invoke('window:close')
  },
  cloud: {
    keys: invoke('cloud:keys'),
    setKey: invoke('cloud:setKey'),
    test: invoke('cloud:test'),
    models: invoke('cloud:models'),
    usage: invoke('cloud:usage')
  },
  voice: {
    status: invoke('voice:status'),
    setup: invoke('voice:setup'),
    speak: invoke('voice:speak'),
    transcribe: invoke('voice:transcribe'),
    hasDeepgram: invoke('voice:hasDeepgram'),
    saveDeepgram: invoke('voice:saveDeepgram'),
    warm: invoke('voice:warm'),
    onProgress: (cb: (step: string) => void) => subscribe<string>('voice:progress', cb)
  },
  daily: {
    grade: invoke('daily:grade')
  },
  mistakes: {
    list: invoke('mistakes:list'),
    due: invoke('mistakes:due'),
    add: invoke('mistakes:add'),
    retest: invoke('mistakes:retest')
  },
  recall: {
    queue: invoke('recall:queue'),
    review: invoke('recall:review')
  },
  goals: {
    list: invoke('goals:list'),
    save: invoke('goals:save')
  },
  exam: {
    generate: invoke('exam:generate'),
    mark: invoke('exam:mark')
  },
  runner: {
    run: invoke('runner:run'),
    runFile: invoke('runner:runFile'),
    librariesStatus: invoke('runner:librariesStatus'),
    speedStatus: invoke('runner:speedStatus'),
    applySpeedups: invoke('runner:applySpeedups'),
    setupLibraries: invoke('runner:setupLibraries'),
    mathStatus: invoke('runner:mathStatus'),
    setupMath: invoke('runner:setupMath'),
    searchStatus: invoke('websearch:status'),
    setupSearch: invoke('websearch:setup')
  },
  library: {
    saveUrl: invoke('library:saveUrl'),
    importFiles: invoke('library:importFiles'),
    importPaths: invoke('library:importPaths'),
    thumb: invoke('library:thumb'),
    topics: invoke('library:topics'),
    setTopics: invoke('library:setTopics'),
    status: invoke('library:status'),
    setStatus: invoke('library:setStatus')
  },
  highlights: {
    get: invoke('highlights:get'),
    save: invoke('highlights:save')
  },
  study: {
    cards: invoke('study:cards'),
    review: invoke('study:review'),
    saveCards: invoke('study:saveCards')
  },
  projects: {
    set: invoke('projects:set'),
    docs: invoke('projects:docs'),
    flowSteps: invoke('projects:flowSteps'),
    map: invoke('projects:map'),
    draftBrief: invoke('projects:draftBrief')
  },
  books: {
    suggest: invoke('books:suggest'),
    passage: invoke('books:passage'),
    map: invoke('books:map')
  },
  bank: {
    status: invoke('bank:status'),
    prepare: invoke('bank:prepare'),
    variant: invoke('bank:variant'),
    preview: invoke('bank:preview'),
    opening: invoke('bank:opening'),
    warmups: invoke('bank:warmups')
  },
  studyApi: {
    status: invoke('studyApi:status'),
    set: invoke('studyApi:set'),
    newToken: invoke('studyApi:newToken')
  },
  metabase: {
    status: invoke('metabase:status'),
    connect: invoke('metabase:connect'),
    disconnect: invoke('metabase:disconnect')
  },
  app: {
    openExternal: invoke('app:openExternal'),
    handy: invoke('voice:handy'),
    flow: invoke('voice:flow'),
    platform: process.platform,
    // A copy started from the source with a throwaway profile (npm run check): tooling may drive it
    testCopy: process.env.TIDE_TEST_COPY === '1'
  }
}

contextBridge.exposeInMainWorld('tide', api)
contextBridge.exposeInMainWorld('tideEvents', {
  onMenu: (cb: (action: string) => void) => subscribe<string>('menu', cb),
  /** tide:// links opened from other apps (a Things 4 task, a browser) */
  onLink: (cb: (url: string) => void) => subscribe<string>('deeplink', cb),
  /** Whether the model is working, so decoration can hold still and leave it the GPU */
  onModelBusy: (cb: (busy: boolean) => void) => subscribe<boolean>('model:busy', cb),
  /** The notes folder moved and Tide followed it; or it's gone and Tide couldn't find it */
  onVaultMoved: (cb: (path: string) => void) => subscribe<string>('vault:moved', cb),
  onVaultMissing: (cb: (old: string) => void) => subscribe<string>('vault:missing', cb),
  /** Something Tide just learned or did, for the brain graph */
  onBrainEvent: (cb: (e: import('../shared/brain').BrainEvent) => void) => subscribe<import('../shared/brain').BrainEvent>('brain:event', cb),
  pendingLink: () => ipcRenderer.invoke('app:pendingLink') as Promise<string | null>,
  pathForFile: (file: File) => webUtils.getPathForFile(file)
})
