/**
 * Gemma on demand (shared/gemmaPolicy, main/modelIdle, main/ai completeFor): while Claude teaches,
 * nothing loads Gemma ahead of time; a job routed to Gemma (picked, or Claude failed) loads it;
 * it is unloaded at launch only when nobody is using it. Against a fake mlx-vlm server and a
 * stand-in `claude`, never the real ones.
 */
import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-gemma-'))
let online = true
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd(), on: () => {}, isPackaged: false }, net: { isOnline: () => online } }))
const settings = { vaultPath: dir, libraryFolder: 'Library', ai: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma', temperature: 0.3, autoStart: false, unloadAfterMinutes: 15 as number | undefined, gemmaUnloadWithClaudeMinutes: undefined as number | undefined, claude: {} } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/learn', async (orig) => ({ ...(await orig<object>()), getNotebooks: async () => [{ path: 'Secret', name: 'Secret', project: { private: true, docs: [] } }] }))

const policy = await import('../src/shared/gemmaPolicy')
const idle = await import('../src/main/modelIdle')
const ai = await import('../src/main/ai')
const engine = await import('../src/main/claudeEngine')
const { PREFIX_CACHE } = await import('../src/main/modelServer')
const { unavailableReason } = await import('../src/main/claudeCli')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude-job.mjs'))

// ---------- A fake mlx-vlm server ----------

const fake = { loaded: false, inFlight: 0, lastRequestAt: 0, chats: 0, unloads: 0, patches: 0 }
let server: Server
beforeAll(async () => {
  server = createServer((req, res) => {
    const json = (o: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)))
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const url = req.url ?? ''
      if (url === '/v1/settings' && req.method === 'GET') return json({ current: { ...PREFIX_CACHE } })
      if (url === '/v1/settings') return (fake.patches++, json({ ok: true }))
      if (url === '/v1/models') return json({ data: [{ id: 'gemma' }] })
      if (url === '/health') return json({ loaded_model: fake.loaded ? 'gemma' : null })
      if (url === '/v1/metrics') return json({ summary: { in_flight: fake.inFlight, last_request_at: fake.lastRequestAt / 1000 } })
      if (url === '/unload') return ((fake.loaded = false), fake.unloads++, json({ ok: true }))
      if (url.endsWith('/chat/completions')) {
        // A request loads the model, as mlx-vlm does
        fake.chats++
        fake.loaded = true
        fake.lastRequestAt = Date.now()
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'gemma: ok' } }] })}\n\n`)
        return res.end('data: [DONE]\n\n')
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  settings.ai.baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
afterAll(() => server?.close())

const claudeIs = async (s: { main: boolean; why?: import('../src/shared/gemmaPolicy').GemmaReason }) => {
  idle.setClaudeProbe(async () => s)
  await idle.refreshClaude()
}

beforeEach(async () => {
  Object.assign(fake, { loaded: false, inFlight: 0, lastRequestAt: Date.now() - 60 * 60_000, chats: 0, unloads: 0, patches: 0 })
  settings.ai.unloadAfterMinutes = 15
  settings.ai.gemmaUnloadWithClaudeMinutes = undefined
  online = true
  idle.setGemmaWarmer(async () => {})
  // Not main first, so the next claudeIs({main: true}) isn't seen as Claude failing
  await claudeIs({ main: false, why: 'no-claude' })
})

// ---------- The routing table ----------

/** Every job that used to run on Gemma while Claude taught, and the Claude role it has now (null: stays on Gemma) */
const EXPECTED: Record<string, string | null> = {
  flashcards: 'teach',
  labCards: 'background',
  marginNote: 'background',
  marginQuestion: 'teach',
  dailyMark: 'mark',
  tieBreak: 'background',
  examPaper: 'teach',
  examMark: 'mark',
  bookContents: 'background',
  readingPicks: 'background',
  projectMap: 'background',
  projectBrief: 'teach',
  companyPrep: 'teach',
  readAlong: 'teach',
  readTogether: 'teach',
  readChallenge: 'teach',
  readArgument: 'hard',
  readSeminar: 'teach',
  readKeep: 'background',
  weekPlan: 'teach',
  goalPlan: 'hard',
  weekMix: 'hard',
  learnerProfile: 'background',
  profileUpdate: 'background',
  profileWeekly: 'hard',
  lessonPrep: 'hard',
  prepExercises: 'teach',
  weeklyReview: 'hard',
  weekProgress: 'background',
  lessonReview: 'mark',
  curriculum: 'background',
  workshop: 'teach',
  lessonChecks: null,
  handwriting: 'mark',
  mockInterviewer: 'teach',
  mockMark: 'mark',
  projectQuestions: 'hard',
  projectPlan: 'hard',
  projectMentor: 'hard',
  projectReady: 'hard',
  projectReadyMark: 'mark',
  projectDebrief: 'hard',
  projectIdeas: 'teach'
}

describe('the routing table', () => {
  const jobs = Object.keys(policy.JOB_ROUTES) as import('../src/shared/gemmaPolicy').JobName[]
  it('lists every audited job, each on the expected Claude model', () => {
    expect(Object.fromEntries(jobs.map((j) => [j, policy.JOB_ROUTES[j].role]))).toEqual(EXPECTED)
  })
  it('sends every job to Claude while Claude teaches, with no privacy gate: Gemma only when picked or the job is Gemma’s alone', () => {
    const main = { main: true }
    for (const job of jobs) {
      const role = EXPECTED[job]
      expect(policy.routeJob(job, { claude: main })).toEqual(role ? { who: 'claude', role } : { who: 'gemma', reason: 'gemma-only' })
      expect(policy.routeJob(job, { claude: main, picked: 'gemma' })).toEqual({ who: 'gemma', reason: 'picked' })
      // Old callers' privacy flags are ignored: routeJob takes none
      expect(policy.routeJob(job, { claude: main, private: true, metabase: true } as never)).toEqual(role ? { who: 'claude', role } : { who: 'gemma', reason: 'gemma-only' })
    }
  })
  it('has no privacy field on any job, and no private or Metabase reason', () => {
    for (const job of jobs) expect(Object.keys(policy.JOB_ROUTES[job]).sort()).toEqual(['label', 'role'])
    expect(policy.reasonFromWhy('Private: this stays on your Mac')).toBe('claude-failed')
  })
  it('sends everything to Gemma, with Claude’s reason, when Claude can’t teach', () => {
    for (const why of ['limit', 'logged-out', 'offline', 'no-claude'] as const)
      for (const job of jobs) expect(policy.routeJob(job, { claude: { main: false, why } })).toEqual({ who: 'gemma', reason: EXPECTED[job] ? why : 'gemma-only' })
  })
  it('reads Claude’s reasons, including no network', () => {
    expect(policy.reasonFromWhy('at your plan’s limit until 14:00')).toBe('limit')
    expect(policy.reasonFromWhy('not logged in')).toBe('logged-out')
    expect(policy.reasonFromWhy('offline: no connection to Claude')).toBe('offline')
    expect(policy.reasonFromWhy('Claude Code isn’t installed')).toBe('no-claude')
    expect(unavailableReason('API Error: getaddrinfo ENOTFOUND api.anthropic.com')).toBe('network')
    expect(unavailableReason('Claude usage limit reached')).toBe('limit')
  })
})

// ---------- The rules ----------

describe('when Gemma loads and unloads', () => {
  it('goes after 5 minutes while Claude teaches, never later than the setting, and never when set to Never', () => {
    expect(policy.gemmaIdleMinutes({ unloadAfterMinutes: 15, claudeMain: true })).toBe(5)
    expect(policy.gemmaIdleMinutes({ unloadAfterMinutes: 15, claudeMain: false })).toBe(15)
    expect(policy.gemmaIdleMinutes({ unloadAfterMinutes: 2, claudeMain: true })).toBe(2)
    expect(policy.gemmaIdleMinutes({ unloadAfterMinutes: 30, withClaudeMinutes: 10, claudeMain: true })).toBe(10)
    expect(policy.gemmaIdleMinutes({ unloadAfterMinutes: 0, claudeMain: true })).toBe(0)
    expect(policy.gemmaIdleMinutes({ claudeMain: false })).toBe(15)
  })
  it('is warmed ahead only when Claude can’t teach or a job needed Gemma lately', () => {
    const now = Date.now()
    expect(policy.shouldWarmGemma({ claudeMain: false, now, idleMinutes: 15 })).toBe(true)
    expect(policy.shouldWarmGemma({ claudeMain: true, now, idleMinutes: 5 })).toBe(false)
    expect(policy.shouldWarmGemma({ claudeMain: true, demandAt: now - 60_000, now, idleMinutes: 5 })).toBe(true)
    expect(policy.shouldWarmGemma({ claudeMain: true, demandAt: now - 6 * 60_000, now, idleMinutes: 5 })).toBe(false)
  })
  it('says plainly whether Gemma is loaded and why', () => {
    expect(policy.gemmaStatusLine({ loaded: false, claudeMain: true, idleMinutes: 5 })).toBe('Gemma: not loaded. Claude is teaching. It loads when Claude can’t answer or you pick Gemma.')
    expect(policy.gemmaStatusLine({ loaded: true, claudeMain: true, reason: 'limit', idleMinutes: 5 })).toBe('Gemma: loaded for teaching while Claude is at its limit, unloads after 5 min unused.')
    expect(policy.takeoverNote({ why: 'Claude is unavailable (at your plan’s limit): Gemma is teaching', loaded: false })).toBe('Claude is unavailable (at your plan’s limit): Gemma is teaching, about 5 s to load')
    expect(policy.takeoverNote({ why: 'Gemma is teaching', loaded: true })).toBe('Gemma is teaching')
  })
})

// ---------- Against the fake server ----------

describe('no warm-up while Claude teaches', () => {
  it('doesn’t load Gemma at launch, on focus or in the minute’s check, and unloads it sooner', async () => {
    await claudeIs({ main: true })
    const warm = vi.fn(async () => {})
    expect(await idle.getGemmaReady(warm)).toBe('skipped')
    idle.wakeModel(warm)
    expect(await idle.minuteCheck(warm)).toBe('skipped')
    await new Promise((r) => setTimeout(r, 50))
    expect(warm).not.toHaveBeenCalled()
    expect(fake).toMatchObject({ chats: 0, patches: 0, loaded: false })
    expect(idle.idleMinutes()).toBe(5)
    expect((await idle.gemmaStatus()).line).toBe('Gemma: not loaded. Claude is teaching. It loads when Claude can’t answer or you pick Gemma.')
  })
  it('keeps Gemma ready as before when Claude can’t teach', async () => {
    await claudeIs({ main: false, why: 'logged-out' })
    const warm = vi.fn(async () => {})
    expect(await idle.getGemmaReady(warm)).toBe('warmed')
    expect(warm).toHaveBeenCalledOnce()
    expect(idle.idleMinutes()).toBe(15)
  })
})

describe('on-demand load', () => {
  it('sends a job from a once-private project to Claude, leaving Gemma unloaded', async () => {
    await claudeIs({ main: true })
    expect(await ai.completeFor('flashcards', 'cards on loops', undefined)).toBe('claude sonnet: ok')
    expect(await ai.completeFor('marginNote', 'a margin note', undefined)).toBe('claude haiku: ok')
    expect(await ai.completeFor('flashcards', 'cards on the design in Secret/design.md', undefined)).toBe('claude sonnet: ok')
    expect(fake).toMatchObject({ chats: 0, loaded: false })
  })
  it('sends Metabase work and private projects named in a job’s text to Claude', async () => {
    await claudeIs({ main: true })
    expect(await ai.completeFor('weekPlan', 'plan a week with the metabase dashboards', 'You plan.')).toBe('claude sonnet: ok')
    expect(await ai.completeFor('weekPlan', 'plan a week: Notebooks: Secret, Python', 'You plan.')).toBe('claude sonnet: ok')
    expect(fake.chats).toBe(0)
  })
  it('loads Gemma ahead when Claude hits its limit, not because a note opens', async () => {
    const warm = vi.fn(async () => {})
    idle.setGemmaWarmer(warm)
    await claudeIs({ main: true })
    expect('prewarmForPath' in ai).toBe(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(warm).not.toHaveBeenCalled()
    await claudeIs({ main: false, why: 'limit' })
    await new Promise((r) => setTimeout(r, 50))
    expect(warm).toHaveBeenCalledTimes(1)
    expect(idle.gemmaDemand()?.reason).toBe('limit')
  })
})

describe('fallback on Claude failure', () => {
  it('hands the job to Gemma when Claude is at its limit, offline or too slow', async () => {
    for (const [word, reason] of [
      ['LIMIT', 'limit'],
      ['OFFLINE', 'offline'],
      ['HANG', 'claude-failed']
    ] as const) {
      await claudeIs({ main: false, why: 'no-claude' })
      await claudeIs({ main: true })
      const before = fake.chats
      expect(await ai.completeFor('readAlong', `discuss this ${word}`, 'You discuss.', { timeoutMs: 1500 })).toBe('gemma: ok')
      expect(fake.chats).toBe(before + 1)
      expect(idle.gemmaDemand()?.reason).toBe(reason)
    }
  })
  it('doesn’t load Gemma for a job that has its own answer when Claude can’t give one', async () => {
    await claudeIs({ main: true })
    await expect(ai.completeFor('tieBreak', 'pick HANG', 'Pick.', { timeoutMs: 300, noFallback: true })).rejects.toThrow()
    expect(fake.chats).toBe(0)
  })
})

describe('unload at launch', () => {
  it('unloads only when Gemma is loaded, Claude teaches and nobody has used the server lately', async () => {
    await claudeIs({ main: true })
    fake.loaded = true
    fake.lastRequestAt = Date.now() - 10_000
    expect(await idle.unloadIdleAtLaunch()).toBe(false)
    fake.lastRequestAt = Date.now() - 10 * 60_000
    fake.inFlight = 1
    expect(await idle.unloadIdleAtLaunch()).toBe(false)
    fake.inFlight = 0
    settings.ai.unloadAfterMinutes = 0
    expect(await idle.unloadIdleAtLaunch()).toBe(false)
    settings.ai.unloadAfterMinutes = 15
    await claudeIs({ main: false, why: 'limit' })
    expect(await idle.unloadIdleAtLaunch()).toBe(false)
    expect(fake.unloads).toBe(0)
    await claudeIs({ main: true })
    fake.loaded = true
    expect(await idle.unloadIdleAtLaunch()).toBe(true)
    expect(fake).toMatchObject({ unloads: 1, loaded: false })
  })
  it('won’t unload by hand while the server is answering', async () => {
    await claudeIs({ main: true })
    fake.loaded = true
    fake.inFlight = 1
    expect((await idle.unloadGemmaNow()).busy).toBe(true)
    expect(fake.unloads).toBe(0)
    fake.inFlight = 0
    expect((await idle.unloadGemmaNow()).loaded).toBe(false)
    expect(fake.unloads).toBe(1)
  })
})
