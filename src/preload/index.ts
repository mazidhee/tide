import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChatEvent, TideApi } from '@shared/types'
import { ideApi } from './ide'
import { ideasApi } from './ideas'
import { notebookApi } from './notebook'
import { packsApi } from './packs'

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
  profile: {
    get: invoke('profile:get'),
    set: invoke('profile:set'),
    source: invoke('profile:source'),
    setSource: invoke('profile:setSource'),
    clearPhoto: invoke('profile:clearPhoto')
  },
  vault: {
    choose: invoke('vault:choose'),
    tree: invoke('vault:tree'),
    read: invoke('vault:read'),
    write: invoke('vault:write'),
    writeImage: invoke('vault:writeImage'),
    prepareImage: invoke('vault:prepareImage'),
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
  ide: ideApi,
  ideas: ideasApi,
  packs: packsApi,
  notebook: notebookApi,
  lsp: {
    send: (msg) => ipcRenderer.send('lsp:send', msg),
    onMessage: (cb) => subscribe<unknown>('lsp:message', cb),
    info: invoke('lsp:info'),
    status: invoke('lsp:status'),
    readFile: invoke('lsp:readFile')
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
    typing: invoke('ai:typing'),
    cancel: invoke('ai:cancel'),
    threadDone: invoke('ai:threadDone'),
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
    checkResources: invoke('learn:checkResources'),
    readyRoadmap: invoke('learn:readyRoadmap'),
    marketStatus: invoke('finance:marketStatus'),
    fetchMarketData: invoke('finance:fetchMarketData'),
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
  mathsAnswer: {
    evaluate: invoke('mathsAnswer:evaluate'),
    checkSteps: invoke('mathsAnswer:checkSteps'),
    status: invoke('mathsAnswer:status'),
    readBack: invoke('mathsAnswer:readBack'),
    readPaper: invoke('mathsAnswer:readPaper'),
    mark: invoke('mathsAnswer:mark')
  },
  maths: {
    state: invoke('maths:state'),
    log: invoke('maths:log'),
    setReminder: invoke('maths:setReminder'),
    explain: invoke('maths:explain')
  },
  workout: {
    state: invoke('workout:state'),
    logRound: invoke('workout:logRound'),
    setReminder: invoke('workout:setReminder'),
    drills: invoke('workout:drills')
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
  mocks: {
    status: invoke('mocks:status'),
    bank: invoke('mocks:bank'),
    start: invoke('mocks:start'),
    say: invoke('mocks:say'),
    hint: invoke('mocks:hint'),
    test: invoke('mocks:test'),
    answer: invoke('mocks:answer'),
    end: invoke('mocks:end'),
    cancel: invoke('mocks:cancel'),
    stop: invoke('mocks:stop'),
    history: invoke('mocks:history'),
    record: invoke('mocks:record'),
    examTopics: invoke('mocks:examTopics'),
    keep: invoke('mocks:keep'),
    resume: invoke('mocks:resume'),
    onEvent: (cb) => subscribe<{ id: string; delta: string }>('mock:event', cb)
  },
  sharp: {
    status: invoke('sharp:status'),
    start: invoke('sharp:start'),
    test: invoke('sharp:test'),
    submit: invoke('sharp:submit'),
    hint: invoke('sharp:hint'),
    retry: invoke('sharp:retry'),
    reveal: invoke('sharp:reveal'),
    drillAsk: invoke('sharp:drillAsk'),
    drillHypothesis: invoke('sharp:drillHypothesis'),
    drillAct: invoke('sharp:drillAct'),
    drillResolve: invoke('sharp:drillResolve'),
    pmTurn: invoke('sharp:pmTurn'),
    pmFinish: invoke('sharp:pmFinish'),
    end: invoke('sharp:end'),
    cancel: invoke('sharp:cancel'),
    weakModes: invoke('sharp:weakModes')
  },
  speed: {
    recent: invoke('speed:recent'),
    render: invoke('speed:render'),
    memory: invoke('speed:memory')
  },
  bugs: {
    info: invoke('bugs:info'),
    open: invoke('bugs:open'),
    file: invoke('bugs:file'),
    discard: invoke('bugs:discard')
  },
  backups: {
    status: invoke('backups:status'),
    now: invoke('backups:now'),
    reveal: invoke('backups:reveal'),
    chooseFolder: invoke('backups:chooseFolder'),
    defaultFolder: invoke('backups:defaultFolder'),
    restore: invoke('backups:restore')
  },
  gemma: {
    status: invoke('gemma:status'),
    load: invoke('gemma:load'),
    unload: invoke('gemma:unload')
  },
  usage: {
    report: invoke('usage:report')
  },
  claude: {
    status: invoke('claude:status'),
    usage: invoke('claude:usage'),
    terminal: invoke('claude:terminal')
  },
  connections: {
    list: invoke('connections:list'),
    setKey: invoke('connections:setKey'),
    used: invoke('connections:used')
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
  explore: {
    list: invoke('explore:list'),
    add: invoke('explore:add'),
    update: invoke('explore:update'),
    remove: invoke('explore:remove'),
    onChange: (cb) => subscribe<void>('explore:changed', () => cb())
  },
  videos: {
    transcript: invoke('videos:transcript'),
    fileTranscript: invoke('videos:fileTranscript'),
    clips: invoke('videos:clips'),
    check: invoke('videos:check')
  },
  manim: {
    status: invoke('manim:status'),
    install: invoke('manim:install'),
    installTex: invoke('manim:installTex'),
    settings: invoke('manim:settings'),
    request: invoke('manim:request'),
    get: invoke('manim:get'),
    used: invoke('manim:used'),
    onStatus: (cb: (s: import('@shared/manim').AnimStatus) => void) => subscribe<import('@shared/manim').AnimStatus>('manim:status', cb),
    onInstallProgress: (cb: (step: string) => void) => subscribe<string>('manim:installProgress', cb),
    onTexProgress: (cb: (step: string) => void) => subscribe<string>('manim:texProgress', cb)
  },
  visuals: {
    policy: invoke('visuals:policy'),
    repair: invoke('visuals:repair'),
    fallback: invoke('visuals:fallback'),
    cached: invoke('visuals:cached'),
    remember: invoke('visuals:remember'),
    watch: invoke('visuals:watch'),
    unwatch: invoke('visuals:unwatch'),
    kill: invoke('visuals:kill'),
    metrics: invoke('visuals:metrics'),
    onKilled: (cb: (e: { host: string; reason: string }) => void) => subscribe<{ host: string; reason: string }>('visuals:killed', cb)
  },
  courses: {
    list: invoke('courses:list'),
    get: invoke('courses:get'),
    import: invoke('courses:import'),
    update: invoke('courses:update'),
    remove: invoke('courses:remove'),
    lesson: invoke('courses:lesson'),
    file: invoke('courses:file'),
    mark: invoke('courses:mark'),
    search: invoke('courses:search'),
    saveToNotes: invoke('courses:saveToNotes'),
    preview: invoke('courses:preview'),
    track: invoke('courses:track'),
    fresh: invoke('courses:fresh'),
    checkNow: invoke('courses:checkNow'),
    dismiss: invoke('courses:dismiss'),
    onFresh: (cb) => subscribe<{ running: boolean; steps: import('../main/courseFresh').FreshStatus['steps'] }>('courses:fresh', cb),
    onProgress: (cb) => subscribe<import('../main/courses').ImportPhase>('courses:progress', cb)
  },
  coursePlan: {
    thisWeek: invoke('coursePlan:thisWeek'),
    alignAll: invoke('coursePlan:alignAll'),
    startQuiz: invoke('coursePlan:startQuiz'),
    submitQuiz: invoke('coursePlan:submitQuiz'),
    checked: invoke('coursePlan:checked')
  },
  links: {
    courseFile: invoke('links:courseFile'),
    githubFile: invoke('links:githubFile'),
    repoPdf: invoke('links:repoPdf'),
    read: invoke('links:read'),
    pdf: invoke('links:pdf'),
    repos: invoke('links:repos'),
    related: invoke('links:related'),
    onGoto: (cb) => subscribe<{ t?: number; section?: string; video?: string }>('view:goto', cb)
  },
  web: {
    open: invoke('web:open'),
    place: invoke('web:place'),
    go: invoke('web:go'),
    close: invoke('web:close'),
    onState: (cb) => subscribe<import('../main/webView').WebState>('web:state', cb)
  },
  workshop: {
    list: invoke('workshop:list'),
    start: invoke('workshop:start'),
    state: invoke('workshop:state'),
    run: invoke('workshop:run'),
    hint: invoke('workshop:hint'),
    review: invoke('workshop:review'),
    ask: invoke('workshop:ask'),
    forTopic: invoke('workshop:forTopic'),
    forFolder: invoke('workshop:forFolder'),
    propose: invoke('workshop:propose'),
    editor: invoke('workshop:editor'),
    openEditor: invoke('workshop:openEditor'),
    watch: invoke('workshop:watch'),
    unwatch: invoke('workshop:unwatch'),
    onWatch: (cb) => subscribe<import('../shared/editor').WatchEvent>('workshop:watch', cb)
  },
  editors: {
    list: invoke('editors:list')
  },
  difficulty: {
    known: invoke('difficulty:known')
  },
  model: {
    view: invoke('model:view'),
    node: invoke('model:node'),
    correct: invoke('model:correct'),
    setTarget: invoke('model:setTarget'),
    event: invoke('model:event')
  },
  knowledge: {
    view: invoke('knowledge:view'),
    review: invoke('knowledge:review'),
    reviewAnswer: invoke('knowledge:reviewAnswer')
  },
  teaching: {
    view: invoke('teaching:view'),
    setAdjustment: invoke('teaching:setAdjustment'),
    review: invoke('teaching:review')
  },
  warmup: {
    for: invoke('warmup:for'),
    grade: invoke('warmup:grade')
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
    progress: invoke('coach:progress'),
    progressSummary: invoke('coach:progressSummary'),
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
    saveReview: invoke('coach:saveReview'),
    proactive: invoke('coach:proactive'),
    runCoach: invoke('coach:runCoach')
  },
  portfolio: {
    view: invoke('portfolio:view'),
    add: invoke('portfolio:add'),
    update: invoke('portfolio:update'),
    remove: invoke('portfolio:remove'),
    decompose: invoke('portfolio:decompose'),
    resolve: invoke('portfolio:resolve'),
    replan: invoke('portfolio:replan'),
    bringForward: invoke('portfolio:bringForward')
  },
  track: {
    view: invoke('track:view'),
    override: invoke('track:override'),
    undoOverride: invoke('track:undoOverride'),
    startCheck: invoke('track:startCheck'),
    submitCheck: invoke('track:submitCheck'),
    setupCapstone: invoke('track:setupCapstone'),
    firmUp: invoke('track:firmUp'),
    mixedReview: invoke('track:mixedReview')
  },
  modules: {
    status: invoke('modules:status'),
    track: invoke('modules:track'),
    there: invoke('modules:there'),
    preview: invoke('modules:preview'),
    switch: invoke('modules:switch'),
    removeFolders: invoke('modules:removeFolders'),
    switchBack: invoke('modules:switchBack'),
    projects: invoke('modules:projects'),
    startProject: invoke('modules:startProject'),
    page: invoke('modules:page'),
    queue: invoke('modules:queue'),
    suggest: invoke('modules:suggest'),
    addProject: invoke('modules:addProject')
  },
  northStar: {
    view: invoke('northStar:view'),
    glance: invoke('northStar:glance'),
    suggested: invoke('northStar:suggested'),
    synthesise: invoke('northStar:synthesise'),
    status: invoke('northStar:status'),
    draft: invoke('northStar:draft'),
    discard: invoke('northStar:discard'),
    build: invoke('northStar:build'),
    decide: invoke('northStar:decide'),
    review: invoke('northStar:review'),
    moveOn: invoke('northStar:moveOn'),
    confirmDepth: invoke('northStar:confirmDepth'),
    startCapstone: invoke('northStar:startCapstone'),
    install: invoke('northStar:install')
  },
  learner: {
    view: invoke('learner:view'),
    refresh: invoke('learner:refresh'),
    correct: invoke('learner:correct'),
    add: invoke('learner:add'),
    rhythm: invoke('learner:rhythm')
  },
  prep: {
    status: invoke('prep:status'),
    opening: invoke('prep:opening'),
    get: invoke('prep:get'),
    discard: invoke('prep:discard'),
    now: invoke('prep:now'),
    weeklyReview: invoke('prep:weeklyReview')
  },
  studying: invoke('app:study'),
  onTrayCommand: (cb) => {
    const off = subscribe('tray:command', cb as (c: unknown) => void)
    return () => void off()
  },
  windows: {
    openFocus: invoke('window:openFocus'),
    focusView: invoke('window:focusView'),
    close: invoke('window:close'),
    focusKey: invoke('window:focusKey'),
    setInfo: invoke('window:setInfo'),
    returnToMain: invoke('window:returnToMain'),
    held: invoke('window:held'),
    onHeld: (cb) => subscribe('windows:held', cb),
    onAdopt: (cb) => subscribe('windows:adopt', cb),
    mainHolds: invoke('window:mainHolds'),
    onShowKey: (cb) => subscribe('windows:showKey', cb),
    onClosing: (cb) => subscribe('windows:closing', () => cb()),
    closeNow: invoke('window:closeNow'),
    relay: (channel, payload) => ipcRenderer.send('windows:relay', channel, payload),
    onRelay: (cb) => subscribe('windows:relayed', cb),
    claimBreak: invoke('windows:claimBreak')
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
    labStatus: invoke('runner:labStatus'),
    setupLab: invoke('runner:setupLab'),
    onLabProgress: (cb: (step: string) => void) => subscribe<string>('runner:labProgress', cb),
    languagesStatus: invoke('runner:languagesStatus'),
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
  // humanities: see src/main/reading
  reading: {
    book: invoke('reading:book'),
    locate: invoke('reading:locate'),
    freeSearch: invoke('reading:freeSearch'),
    freeAdd: invoke('reading:freeAdd'),
    source: invoke('reading:source'),
    discuss: invoke('reading:discuss'),
    discussions: invoke('reading:discussions'),
    keep: invoke('reading:keep'),
    items: invoke('reading:items'),
    syncNotes: invoke('reading:syncNotes'),
    togetherOpen: invoke('reading:togetherOpen'),
    togetherOrient: invoke('reading:togetherOrient'),
    togetherDiscuss: invoke('reading:togetherDiscuss'),
    togetherFinish: invoke('reading:togetherFinish')
  },
  // The reading room (src/main/readingRoom)
  room: {
    shelf: invoke('room:shelf'),
    tonight: invoke('room:tonight'),
    book: invoke('room:book'),
    add: invoke('room:add'),
    addFree: invoke('room:addFree'),
    import: invoke('room:import'),
    remove: invoke('room:remove'),
    patch: invoke('room:patch'),
    goal: invoke('room:goal'),
    progress: invoke('room:progress'),
    time: invoke('room:time'),
    marks: invoke('room:marks'),
    saveMark: invoke('room:saveMark'),
    removeMark: invoke('room:removeMark'),
    page: invoke('room:page'),
    pageInfo: invoke('room:pageInfo'),
    talks: invoke('room:talks'),
    who: invoke('room:who'),
    challenge: invoke('room:challenge'),
    argument: invoke('room:argument'),
    keepTalk: invoke('room:keepTalk'),
    seminarTurn: invoke('room:seminarTurn'),
    seminarKeep: invoke('room:seminarKeep'),
    seminarSave: invoke('room:seminarSave')
  },
  covers: {
    search: invoke('covers:search'),
    art: invoke('covers:art'),
    thumb: invoke('covers:thumb'),
    own: invoke('covers:own'),
    y: invoke('covers:y'),
    remove: invoke('covers:remove'),
    icon: invoke('covers:icon')
  },
  tts: {
    engines: invoke('tts:engines'),
    synth: invoke('tts:synth'),
    prerender: invoke('tts:prerender'),
    cachedCount: invoke('tts:cachedCount')
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
  lab: {
    query: invoke('lab:query'),
    schema: invoke('lab:schema'),
    reset: invoke('lab:reset'),
    load: invoke('lab:load'),
    pgQuery: invoke('lab:pgQuery'),
    pgReset: invoke('lab:pgReset')
  },
  metabase: {
    status: invoke('metabase:status'),
    connect: invoke('metabase:connect'),
    disconnect: invoke('metabase:disconnect'),
    map: invoke('metabase:map'),
    mapInfo: invoke('metabase:mapInfo'),
    screen: invoke('metabase:screen')
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
