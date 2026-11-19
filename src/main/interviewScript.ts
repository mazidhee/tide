/**
 * Scripts (shared/interviewScript): co-writing a spoken answer to one question of a target with
 * the learner, in their voice, then practising it. Opus drafts and revises; a cheaper model pulls
 * out the beats when a version is locked and marks a run against them. Without Claude the
 * learner still edits, keeps versions, locks, and practises with the beats marked in code; the
 * first version comes from their own draft, the model answer or their outline.
 *
 * Files, in the vault only: `Interview prep/<Target>/scripts/<question id>.md` and
 * `Interview prep/<Target>/voice.md`.
 */
import { existsSync, promises as fs } from 'fs'
import { basename, join } from 'path'
import { ipcMain } from 'electron'
import { HUMAN_FEEDBACK, HUMAN_WRITING, SPOKEN_SCRIPT, aiTells, naturalness } from '@shared/humanWriting'
import { attemptOf, slugOf, type Question, type TargetFiles } from '@shared/interviewTarget'
import {
  SCRIPTS_DIR,
  VOICE_FILE,
  VOICE_START,
  WORDS_PER_MINUTE,
  addVersion,
  asksForOptions,
  beatsInCode,
  emptyScript,
  knownTokens,
  latest,
  lengthAsked,
  lockedText,
  parseBeats,
  parseScript,
  parseScriptReply,
  parseVoice,
  readSayIt,
  sampleSentences,
  sayItInCode,
  scriptFile,
  scriptMarkdown,
  scriptTarget,
  stamp,
  voiceMarkdown,
  voiceRuleFrom,
  voiceText,
  withVoiceLine,
  yourDraftOf,
  yourDrafts,
  type SayItResult,
  type Script,
  type ScriptBundle,
  type ScriptRevision,
  type Voice
} from '@shared/interviewScript'
import { absPath, readText, writeText } from './vault'
import { NO_INVENTING, contextText, documentText, folderOf, interviewModels, readContext, readFiles, readOr, saveAttempt } from './interviewTarget'

const FACTS_RULE = `Facts the learner states in their feedback ("say we reached the final") are allowed: use them, and list each one in "facts". Anything else the material doesn't back stays out. Where the answer needs a detail nobody has given, put a short gap in square brackets for the learner to fill, like [how many accounts], instead of a guess.`

const SYSTEM = (voice: Voice) =>
  [
    `You co-write a spoken interview answer with a candidate. It is theirs: they will learn it and say it in the room, so it must sound like them on a good day, not like a writer. ${NO_INVENTING.replace(/ Where a detail is missing.*$/, '')}`,
    FACTS_RULE,
    SPOKEN_SCRIPT,
    HUMAN_WRITING,
    voiceText(voice)
  ]
    .filter(Boolean)
    .join('\n\n')

const REPLY_SHAPE = `Reply with JSON only, no prose around it:
{"draft": "the whole script, plain text, paragraphs separated by a blank line", "note": "what you changed, to the candidate ('you'): one to three short sentences, 35 words at most", "facts": ["each new fact the candidate stated in their feedback, as a short sentence"], "voiceRule": "a short rule for how the candidate speaks in general, if their feedback was one ('Never say first-hand.'); otherwise null", "options": []}`

// ---------- Reading ----------

interface Ctx {
  slug: string
  folder: string
  files: TargetFiles
  q: Question
  questionsMd: string
  path: string
  voicePath: string
}

async function ctxOf(slug: string, questionId: string): Promise<Ctx> {
  const folder = await folderOf(slug)
  const { files } = await readFiles(folder)
  const q = files.questions.find((x) => x.id === questionId)
  if (!q) throw new Error('That question isn’t in questions.md any more.')
  return { slug, folder, files, q, questionsMd: await readOr(`${folder}/questions.md`), path: `${folder}/${SCRIPTS_DIR}/${scriptFile(q.id)}`, voicePath: `${folder}/${VOICE_FILE}` }
}

async function readScript(c: Ctx): Promise<Script | null> {
  if (!existsSync(absPath(c.path))) return null
  return parseScript(await readText(c.path), c.q)
}

const writeScript = (c: Ctx, s: Script) => writeText(c.path, scriptMarkdown(s))

/** The learner's sources folders: target.md's `sources`, and `.tide/interview-sources/<slug>/` (or the one named like it) */
async function sourceDirs(c: Ctx): Promise<string[]> {
  const out = c.files.meta.sources.map((s) => s.replace(/^~(?=\/)/, process.env.HOME ?? '~'))
  const base = '.tide/interview-sources'
  const names = await fs.readdir(absPath(base), { withFileTypes: true }).catch(() => [])
  const mine = new Set(c.slug.split('-').filter((w) => w.length > 2))
  for (const d of names) {
    if (!d.isDirectory()) continue
    const shared = slugOf(d.name)
      .split('-')
      .filter((w) => mine.has(w)).length
    if (slugOf(d.name) === c.slug || shared >= 2) out.push(absPath(`${base}/${d.name}`))
  }
  return out
}

/** The learner's own answers among their sources: HireVue answers, drafts, "my answers" */
async function ownWriting(c: Ctx): Promise<string[]> {
  const texts: string[] = []
  for (const dir of await sourceDirs(c)) {
    const st = await fs.stat(dir).catch(() => null)
    const paths = !st ? [] : st.isFile() ? [dir] : (await fs.readdir(dir).catch(() => [])).map((n) => join(dir, n))
    for (const p of paths.filter((x) => /hirevue|answers?|my words|draft/i.test(basename(x)) && /\.(md|txt|docx|pdf)$/i.test(x)).slice(0, 6)) texts.push(await documentText(p).catch(() => ''))
  }
  return texts.filter((t) => t.trim())
}

/** voice.md, seeded from the learner's own writing the first time */
async function readVoice(c: Ctx): Promise<Voice> {
  if (existsSync(absPath(c.voicePath))) return parseVoice(await readText(c.voicePath))
  const own = [...yourDrafts(c.questionsMd).map((d) => d.text), ...(await ownWriting(c))]
  const tellCount = (s: string) => aiTells(s).length
  const samples = [...new Set(own.flatMap((t) => sampleSentences(t, tellCount, 8)))].slice(0, 16)
  const voice: Voice = { rules: [], samples }
  await writeText(c.voicePath, voiceMarkdown(voice, `${VOICE_START}\nSeeded ${stamp(Date.now()).slice(0, 10)} from your own drafts and answers.\n`))
  // Rules from the samples come after, in the background, so the page doesn't wait on them
  void seedRules(c, samples)
  return voice
}

async function seedRules(c: Ctx, samples: string[]) {
  const m = interviewModels()
  if (samples.length < 4 || !(await m.ready())) return
  try {
    const out = await m.once(
      `Sentences the candidate wrote themselves:\n${samples.map((s) => `- ${s}`).join('\n')}`,
      `From a candidate's own sentences, write three to five short rules for writing their spoken interview answers so they sound like them: the words they reach for, how they open a point, their spelling, how formal they are. Each rule is an instruction ("Use British spelling.", "Open a point with 'So'."). Keep only habits worth keeping; leave out ones a speaking coach would fix, such as very long sentences. Only what the sentences show. Reply with a JSON array of strings only.`,
      'background',
      'interviewScript',
      AbortSignal.timeout(90_000)
    )
    let raw = await readOr(c.voicePath)
    for (const r of parseBeats(out) ?? []) raw = withVoiceLine(raw, 'rules', r)
    await writeText(c.voicePath, raw)
  } catch (e) {
    console.warn('[script] voice rules', (e as Error).message)
  }
}

/** Everything that counts as the learner's material, for checking a draft's claims */
async function material(c: Ctx, s: Script | null, voice: Voice): Promise<string[]> {
  const ctx = await readContext(c.slug)
  const files = await Promise.all(['target.md', 'stories.md', 'questions.md', 'firm.md'].map((f) => readOr(`${c.folder}/${f}`)))
  return [...files, ...(ctx?.texts ?? []), ...voice.samples, ...(s?.facts ?? []), ...(s?.log.filter((t) => t.who === 'you').map((t) => t.text) ?? []), c.q.text]
}

function startOf(c: Ctx, claude: boolean): ScriptBundle['start'] {
  if (yourDraftOf(c.questionsMd, c.q)) return 'yours'
  if (c.q.model) return 'model'
  if (claude) return 'claude'
  return c.q.outline.length ? 'outline' : 'blank'
}

async function bundleOf(c: Ctx, s?: Script | null): Promise<ScriptBundle> {
  const script = s === undefined ? await readScript(c) : s
  const voice = await readVoice(c)
  const claude = await interviewModels().ready()
  return {
    questionId: c.q.id,
    question: c.q.text,
    kind: c.q.kind,
    route: c.q.route,
    script,
    target: scriptTarget(c.q, script?.target),
    voice,
    known: knownTokens(await material(c, script, voice)),
    start: startOf(c, claude),
    claude,
    path: c.path,
    voicePath: c.voicePath
  }
}

export async function getScript(slug: string, questionId: string): Promise<ScriptBundle> {
  return bundleOf(await ctxOf(slug, questionId))
}

// ---------- Writing ----------

const storiesFor = (c: Ctx) =>
  c.files.stories
    .filter((s) => c.q.stories.includes(s.id))
    .map((s) => `${s.id}. ${s.title}\nEvidence: ${s.evidence.join('; ')}\nGaps: ${s.gaps.join('; ') || 'none'}`)
    .join('\n')

const brief = (c: Ctx, target: [number, number]) =>
  [
    `Target: ${c.files.meta.company}, ${c.files.meta.role}.`,
    `Question: ${c.q.text}`,
    `Kind: ${c.q.kind}${c.q.route.length ? `\nRoute to follow: ${c.q.route.join(' → ')}` : ''}`,
    `Length: ${target[0]} to ${target[1]} seconds spoken, so about ${Math.round((target[0] * WORDS_PER_MINUTE) / 60)} to ${Math.round((target[1] * WORDS_PER_MINUTE) / 60)} words.`,
    c.q.outline.length ? `The candidate's outline: ${c.q.outline.join('; ')}` : '',
    storiesFor(c) ? `Their stories for it:\n${storiesFor(c)}` : ''
  ]
    .filter(Boolean)
    .join('\n')

/** The first version: the learner's own draft, then the model answer, then Opus from their material, then their outline */
export async function startScript(slug: string, questionId: string): Promise<ScriptBundle> {
  const c = await ctxOf(slug, questionId)
  const existing = await readScript(c)
  if (existing?.versions.length) return bundleOf(c, existing)
  const voice = await readVoice(c)
  const at = stamp(Date.now())
  const m = interviewModels()
  const yours = yourDraftOf(c.questionsMd, c.q)
  let s = emptyScript(c.q)
  if (yours) s = addVersion(s, { at, by: 'start', note: 'Your own draft from questions.md.', text: yours })
  else if (c.q.model) s = addVersion(s, { at, by: 'start', note: 'The model answer from questions.md.', text: c.q.model.replace(/\*\*/g, '') })
  else if (await m.ready()) {
    const target = scriptTarget(c.q)
    const ctx = await contextText(slug, 30_000)
    const out = await m.once(`${brief(c, target)}\n\nWrite the first draft of their spoken answer.\n\n${ctx ? `The candidate's material:\n${ctx}` : 'No other material was gathered: use only the outline and stories above.'}\n\n${REPLY_SHAPE}`, SYSTEM(voice), 'hard', 'interviewScript', AbortSignal.timeout(300_000))
    const r = parseScriptReply(out)
    if (!r?.draft) throw new Error('Claude’s draft couldn’t be read. Try again.')
    s = addVersion(s, { at, by: 'tide', note: r.note, text: r.draft })
    if (r.facts?.length) s.facts.push(...r.facts.map((f) => `${f} (stated ${at.slice(0, 10)})`))
  } else if (c.q.outline.length) {
    const text = c.q.outline.map((o) => o.replace(/[.;]+$/, '').replace(/^\w/, (x) => x.toUpperCase()) + '.').join(' ')
    s = addVersion(s, { at, by: 'start', note: 'Your outline, as sentences. Claude isn’t available to draft one, so make it yours by hand.', text })
  }
  if (s.versions.length) await writeScript(c, s)
  return bundleOf(c, s.versions.length ? s : null)
}

/** A hand edit, kept as a version; sentences the learner wrote themselves become voice samples */
export async function saveScript(slug: string, questionId: string, text: string): Promise<ScriptBundle> {
  const c = await ctxOf(slug, questionId)
  const s = (await readScript(c)) ?? emptyScript(c.q)
  const before = latest(s)?.text ?? ''
  const next = addVersion(s, { at: stamp(Date.now()), by: 'you', note: 'Your edit.', text })
  if (next === s) return bundleOf(c, s)
  await writeScript(c, next)
  // New sentences in the learner's own words, as samples of their voice
  const old = new Set((before.match(/[^.!?\n]+[.!?]/g) ?? []).map((x) => x.trim()))
  const fresh = sampleSentences((text.match(/[^.!?\n]+[.!?]/g) ?? []).filter((x) => !old.has(x.trim())).join(' '), (x) => aiTells(x).length, 2)
  if (fresh.length) {
    let raw = await readOr(c.voicePath)
    for (const f of fresh) raw = withVoiceLine(raw, 'samples', f)
    await writeText(c.voicePath, raw)
  }
  return bundleOf(c, next)
}

/** Feedback on the draft: Opus revises, notes what changed, or offers two openings or endings */
export async function reviseScript(slug: string, questionId: string, feedback: string, current: string): Promise<ScriptRevision> {
  const fb = feedback.trim()
  if (!fb) throw new Error('Say what to change.')
  let c = await ctxOf(slug, questionId)
  // Hand edits since the last version are kept first, so Tide revises what the learner sees
  if (current.trim() && current.trim() !== (latest((await readScript(c)) ?? emptyScript(c.q))?.text ?? '').trim()) await saveScript(slug, questionId, current)
  c = await ctxOf(slug, questionId)
  let s = (await readScript(c)) ?? emptyScript(c.q)
  const at = stamp(Date.now())
  const asked = lengthAsked(fb)
  if (asked) s = { ...s, target: asked }
  s = { ...s, log: [...s.log, { at, who: 'you', text: fb }] }
  const codeRule = voiceRuleFrom(fb)
  const m = interviewModels()
  const base = latest(s)?.text ?? ''
  if (!(await m.ready())) {
    const note = 'Claude isn’t available, so Tide can’t rewrite this now. Your note is kept; edit the draft directly.'
    s = { ...s, log: [...s.log, { at, who: 'tide', text: note }] }
    await writeScript(c, s)
    return { bundle: await bundleOf(c, s), reply: { note, ...(codeRule ? { voiceRule: codeRule } : {}), by: 'code' } }
  }
  const voice = await readVoice(c)
  const target = scriptTarget(c.q, s.target)
  const ctx = await contextText(slug, 20_000)
  const options = asksForOptions(fb)
  const prompt = [
    brief(c, target),
    s.facts.length ? `Facts the candidate stated earlier:\n${s.facts.map((f) => `- ${f}`).join('\n')}` : '',
    s.log.length > 1 ? `The conversation so far:\n${s.log.slice(-13, -1).map((t) => `${t.who === 'you' ? 'Candidate' : 'You'}: ${t.text}`).join('\n')}` : '',
    base ? `The current script (the candidate may have edited it by hand: keep their edits):\n"""\n${base}\n"""` : 'There is no script yet: write the first draft.',
    `The candidate's feedback now: ${fb}`,
    options
      ? `They want alternatives. Leave "draft" out. Give exactly two "options", each {"kind": "opening" or "ending", "text": "just the new opening or ending lines", "draft": "the whole script with those lines in place"}, different from each other and from the current one.`
      : `Change what the feedback asks and nothing else.${asked ? ` Fit it into ${target[0]} to ${target[1]} seconds (${Math.round((target[1] * WORDS_PER_MINUTE) / 60)} words at most).` : ''}`,
    ctx ? `The candidate's material:\n${ctx}` : '',
    REPLY_SHAPE
  ]
    .filter(Boolean)
    .join('\n\n')
  const out = await m.once(prompt, SYSTEM(voice), 'hard', 'interviewScript', AbortSignal.timeout(300_000))
  const r = parseScriptReply(out)
  if (!r) throw new Error('Claude’s reply couldn’t be read. Try again.')
  if (r.draft) s = addVersion(s, { at, by: 'tide', note: r.note, text: r.draft })
  const made = r.draft ? latest(s)?.n : undefined
  s = { ...s, log: [...s.log, { at, who: 'tide', text: r.note || (r.options ? 'Two to choose from.' : 'Revised.'), ...(made ? { version: made } : {}) }] }
  if (r.facts?.length) s = { ...s, facts: [...s.facts, ...r.facts.filter((f) => !s.facts.some((x) => x.startsWith(f))).map((f) => `${f} (stated ${at.slice(0, 10)})`)] }
  await writeScript(c, s)
  const rule = r.voiceRule ?? codeRule ?? undefined
  return { bundle: await bundleOf(c, s), reply: { note: r.note, ...(r.options ? { options: r.options } : {}), ...(rule ? { voiceRule: rule } : {}), by: 'claude' } }
}

/** One of the alternatives Tide offered, as the next version */
export async function pickOption(slug: string, questionId: string, draft: string, note: string): Promise<ScriptBundle> {
  const c = await ctxOf(slug, questionId)
  const s = (await readScript(c)) ?? emptyScript(c.q)
  const next = addVersion(s, { at: stamp(Date.now()), by: 'tide', note: note || 'The option you picked.', text: draft })
  await writeScript(c, next)
  return bundleOf(c, next)
}

export async function restoreVersion(slug: string, questionId: string, n: number): Promise<ScriptBundle> {
  const c = await ctxOf(slug, questionId)
  const s = await readScript(c)
  const v = s?.versions.find((x) => x.n === n)
  if (!s || !v) throw new Error('That version isn’t in the script any more.')
  const next = addVersion(s, { at: stamp(Date.now()), by: 'you', note: `Back to version ${n}.`, text: v.text })
  await writeScript(c, next)
  return bundleOf(c, next)
}

/** Locks a version as the script and pulls out its beats once (Haiku, else code); null unlocks */
export async function lockScript(slug: string, questionId: string, n: number | null): Promise<ScriptBundle> {
  const c = await ctxOf(slug, questionId)
  const s = await readScript(c)
  if (!s?.versions.length) throw new Error('Write a version first.')
  if (n === null) {
    const next: Script = { ...s, status: 'draft' }
    delete next.lockedVersion
    await writeScript(c, next)
    return bundleOf(c, next)
  }
  const v = s.versions.find((x) => x.n === n) ?? latest(s)!
  let beats = s.lockedVersion === v.n && s.beats.length ? s.beats : []
  const m = interviewModels()
  if (!beats.length && (await m.ready())) {
    try {
      const out = await m.once(
        `The script:\n"""\n${v.text}\n"""`,
        `Pull out the beats of a spoken interview answer: the key points, in order, that must land for the answer to work. Four to seven beats, never more; cover the whole script, so the last beat is how it ends. Merge small details into the beat they belong to. Each beat is 4 to 10 words, using the script's own key words and any names and numbers. Reply with a JSON array of strings only.`,
        'background',
        'interviewScript',
        AbortSignal.timeout(90_000)
      )
      beats = parseBeats(out) ?? []
    } catch (e) {
      console.warn('[script] beats', (e as Error).message)
    }
  }
  if (!beats.length) beats = beatsInCode(v.text)
  const next: Script = { ...s, status: 'locked', lockedVersion: v.n, beats }
  await writeScript(c, next)
  return bundleOf(c, next)
}

export async function addVoice(slug: string, kind: 'rules' | 'samples', line: string): Promise<Voice> {
  const folder = await folderOf(slug)
  const path = `${folder}/${VOICE_FILE}`
  const raw = await readOr(path)
  const next = withVoiceLine(raw || voiceMarkdown({ rules: [], samples: [] }), kind, line)
  if (next !== raw) await writeText(path, next)
  return parseVoice(next)
}

/** A run of the locked script, marked on its beats, time and naturalness; saved as a drill attempt */
export async function sayIt(slug: string, questionId: string, answer: string, seconds: number | null): Promise<SayItResult> {
  const c = await ctxOf(slug, questionId)
  const s = await readScript(c)
  const script = s ? lockedText(s) : null
  if (!s || !script) throw new Error('Lock a version first.')
  const beats = s.beats.length ? s.beats : beatsInCode(script)
  let r = sayItInCode({ beats, answer, seconds, target: scriptTarget(c.q, s.target), natural: naturalness })
  const m = interviewModels()
  if (answer.trim() && (await m.ready())) {
    try {
      const out = await m.once(
        `The script's beats, in order:\n${beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}\n\nThe script:\n"""\n${script}\n"""\n\nWhat the candidate said (${Math.round(r.seconds)} seconds; target ${r.target[0]}–${r.target[1]}):\n"""\n${answer.slice(0, 8000)}\n"""\n\nPhrases code flagged as sounding scripted: ${aiTells(answer).map((t) => t.phrase).join(', ') || 'none'}`,
        `You check a candidate's run of an interview answer they have learnt. A beat landed if its point came across, in any words; it doesn't have to be word for word. ${HUMAN_FEEDBACK}\nReply with JSON only: {"hit": [true or false for each beat, in order], "natural": 0 to 1 (how much it sounded like talking, not reciting), "feedback": "to the candidate, at most three short sentences and 45 words: what they dropped and the one thing to fix"}`,
        'teach',
        'interviewScript',
        AbortSignal.timeout(90_000)
      )
      r = readSayIt(out, r) ?? r
    } catch (e) {
      console.warn('[script] say it', (e as Error).message)
    }
  }
  await saveAttempt(
    slug,
    attemptOf({ item: `q:${c.q.id}`, area: c.q.kind === 'cv' ? 'cv' : 'behavioural', drill: c.q.kind === 'cv' ? 'cv' : 'behavioural', mark: { score: r.score, marks: { beats: r.beats.filter((b) => b.hit).length / Math.max(1, r.beats.length), length: r.seconds >= r.target[0] && r.seconds <= r.target[1] ? 1 : 0.5, natural: r.natural }, covered: r.beats.filter((b) => b.hit).map((b) => b.text), missed: r.beats.filter((b) => !b.hit).map((b) => b.text), feedback: r.feedback, by: r.by }, seconds: r.seconds, spoken: seconds !== null, answer, at: Date.now() })
  )
  return r
}

/** The locked script of a question, for drill marking and the live mock's debrief */
export async function lockedScriptOf(folder: string, questionId: string): Promise<{ text: string; beats: string[] } | null> {
  const path = `${folder}/${SCRIPTS_DIR}/${scriptFile(questionId)}`
  if (!existsSync(absPath(path))) return null
  const s = parseScript(await readText(path))
  const text = lockedText(s)
  return text ? { text, beats: s.beats } : null
}

// ---------- Wiring ----------

export function registerInterviewScripts() {
  const S = String
  ipcMain.handle('interview:script', (_e, slug: string, q: string) => getScript(S(slug), S(q)))
  ipcMain.handle('interview:scriptStart', (_e, slug: string, q: string) => startScript(S(slug), S(q)))
  ipcMain.handle('interview:scriptSave', (_e, slug: string, q: string, text: string) => saveScript(S(slug), S(q), S(text ?? '')))
  ipcMain.handle('interview:scriptRevise', (_e, slug: string, q: string, fb: string, cur: string) => reviseScript(S(slug), S(q), S(fb ?? ''), S(cur ?? '')))
  ipcMain.handle('interview:scriptPick', (_e, slug: string, q: string, draft: string, note: string) => pickOption(S(slug), S(q), S(draft ?? ''), S(note ?? '')))
  ipcMain.handle('interview:scriptRestore', (_e, slug: string, q: string, n: number) => restoreVersion(S(slug), S(q), Number(n)))
  ipcMain.handle('interview:scriptLock', (_e, slug: string, q: string, n: number | null) => lockScript(S(slug), S(q), n === null ? null : Number(n)))
  ipcMain.handle('interview:voiceAdd', (_e, slug: string, kind: 'rules' | 'samples', line: string) => addVoice(S(slug), kind === 'samples' ? 'samples' : 'rules', S(line ?? '')))
  ipcMain.handle('interview:sayIt', (_e, slug: string, q: string, answer: string, seconds: number | null) => sayIt(S(slug), S(q), S(answer ?? ''), typeof seconds === 'number' ? seconds : null))
}
