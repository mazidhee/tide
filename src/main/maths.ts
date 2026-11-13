/**
 * Maths mode in the main process (shared/mathsMode): what a maths lesson's first turn adds, for
 * the engine teaching it, and two tools Tide serves Claude over MCP:
 * - place_explorable: checks an explorable's settings against what the app can draw and hands
 *   back the exact block to paste, with what the learner will see
 * - set_challenge: proves a poke-holes challenge with SymPy (shared/pokeHoles) before the learner
 *   sees it, and hands back its block
 * Gemma's lessons get the same rules in their own words and write the blocks directly; the app
 * checks the learner's side of a challenge itself, so nothing here is needed without Claude.
 */
import type { ChatScope } from '@shared/types'
import type { McpTool } from './tideMcp'
import type { ToolContext } from './agent'
import { formulaLooksOk, mathsMode, mathsRules, SCENE_LABEL, SCENES, type Scene } from '@shared/mathsMode'
import { challengeBlock, parseChallenge, proveChallenge } from '@shared/pokeHoles'

/** The notebook a lesson sits in, by name and roadmap path, for telling a maths roadmap (RM_MATH) */
export async function notebookWords(scope: ChatScope): Promise<string> {
  if (scope.kind === 'none' || scope.kind === 'vault') return ''
  const path = scope.path
  const { getNotebooks } = await import('./learn')
  const nb = (await getNotebooks().catch(() => [])).find((n) => path === n.path || path.startsWith(`${n.path}/`) || (n.outline && path === n.outline))
  return [path, nb?.name, nb?.outline].filter(Boolean).join(' ')
}

/** A teaching lesson (not a quiz, an interview or a placement check) */
const teaches = (instructions: string) => /You are running a TEACH session|REFRESHER/.test(instructions)

/** What a maths lesson's first turn adds for this engine; '' for anything else */
export async function mathsContext(req: { topic?: string; scope: ChatScope; instructions?: string }, engine: 'claude' | 'gemma'): Promise<string> {
  if (!req.topic || !req.instructions || !teaches(req.instructions)) return ''
  return mathsRules(engine, req.topic, await notebookWords(req.scope))
}

/** Whether a lesson is in maths mode (Claude teaches those turns on the stronger model) */
export async function isMathsLesson(req: { topic?: string; scope: ChatScope; session?: boolean }): Promise<boolean> {
  if (!req.session || !req.topic) return false
  return mathsMode(req.topic, await notebookWords(req.scope)).on
}

// ---------- Claude's tools ----------

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })

export const placeExplorableTool: McpTool = {
  name: 'place_explorable',
  description:
    'Check an explorable before you put it in a lesson: give its settings as JSON (kind explore, a scene, its numbers, the question you ask about it, and usually a "predict"). Tide reads it exactly as the lesson will, and answers with the block to paste into your reply (a ```sim block), what the learner will see and be able to move, and any setting it had to change. It does not show anything by itself: paste the block.',
  inputSchema: obj({ spec: { type: 'string', description: 'The explorable as JSON, e.g. {"kind":"explore","scene":"clt","dist":"exponential","size":5,"question":"What shape do the means make?","predict":"How spread out will the means be at n = 25?"}' } }, ['spec']),
  async run(args) {
    let raw: Record<string, unknown>
    try {
      raw = typeof args.spec === 'string' ? JSON.parse(args.spec) : (args.spec as Record<string, unknown>)
    } catch (e) {
      return `That isn't valid JSON: ${(e as Error).message}`
    }
    if (!raw || typeof raw !== 'object') return 'Give the explorable as a JSON object.'
    const scene = String(raw.scene ?? '').trim().toLowerCase() as Scene
    if (!SCENES.includes(scene)) return `Tide can’t draw that: the scene must be one of ${SCENES.join(', ')}.`
    const changed: string[] = []
    if (typeof raw.f === 'string' && !formulaLooksOk(raw.f)) changed.push(`f (${raw.f}) isn't a formula in x the app can read (x, numbers, + - * / ^, sin cos tan exp ln sqrt abs, pi, e), so it would fall back to the default: fix it`)
    if (!raw.question) changed.push('there is no question: add one, it is what makes them think')
    const block = JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'kind')))
    return `${SCENE_LABEL[scene]}: ready.${changed.length ? ` Note: ${changed.join('; ')}.` : ''}${raw.predict ? ' Its answer stays hidden until they lock in a prediction.' : ''} Paste this where it belongs:\n\`\`\`sim\n{"kind":"explore",${block.slice(1)}\n\`\`\``
  }
}

export const setChallengeTool: McpTool = {
  name: 'set_challenge',
  description:
    'Prove a poke-holes challenge before the learner sees it, and get its block. counterexample: the claim as lhs rel rhs over vars, plus witness (values that break it; SymPy checks exactly that the claim fails there) and optionally example (values where it holds, so the claim is tempting). wrong-step: the steps and which one is wrong, plus optionally check (Python with SymPy printing the wrong step\'s number last). asn: the statement and answer (always, sometimes or never), plus optionally check (Python printing the answer last). Without a check, the last two are set unproven and their reasoning is marked like any answer. Paste the ```challenge block it returns, then ask them to justify.',
  inputSchema: obj(
    {
      challenge: { type: 'string', description: 'The challenge as JSON, e.g. {"type":"counterexample","claim":"n² + n + 41 is prime for every natural n","vars":{"n":"natural"},"lhs":"n^2+n+41","rel":"prime"}' },
      witness: { type: 'object', description: 'counterexample: values that break the claim, e.g. {"n":"40"}' },
      example: { type: 'object', description: 'counterexample: values where the claim holds, e.g. {"n":"1"}' },
      check: { type: 'string', description: 'wrong-step or asn: Python (SymPy) that prints the answer as its last line' }
    },
    ['challenge']
  ),
  async run(args, ctx: ToolContext) {
    const { lessonInfo } = await import('./exercises')
    if (lessonInfo(ctx.labId)?.private) return 'This lesson is private: its challenges are written as blocks directly, checked on the Mac as the learner answers.'
    const c = parseChallenge(typeof args.challenge === 'string' ? args.challenge : JSON.stringify(args.challenge ?? {}))
    if (!c) return 'That isn’t a challenge Tide can show: see the formats (counterexample with vars, lhs, rel, rhs; wrong-step with steps and wrong; asn with statement and answer).'
    const asStrings = (v: unknown) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)])) : undefined)
    const step = ctx.step({ kind: 'run_code', label: 'Checking a poke-holes challenge before you see it', status: 'running', depth: 0 })
    const { ioFor } = await import('./exercises')
    const proof = await proveChallenge(c, { witness: asStrings(args.witness), example: asStrings(args.example), check: typeof args.check === 'string' ? args.check : undefined }, await ioFor(ctx.labId ?? 'claude'))
    ctx.updateStep(step, proof.ok ? { status: 'done', label: 'Checked a poke-holes challenge before you see it', detail: proof.detail } : { status: 'error', detail: proof.why.slice(0, 140) })
    if (!proof.ok) return `${proof.fatal ? 'Tide couldn’t check it' : 'It failed its check'}: ${proof.why}`
    return `Proven (${proof.detail}). Paste this block, then an <ask type="explain"> asking them to justify their answer:\n${challengeBlock(c)}`
  }
}

export const MATHS_TOOLS = [placeExplorableTool, setChallengeTool]
