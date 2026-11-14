/**
 * Visuals written once and kept in the vault (main/conceptVisuals): a concept's visual, asked for
 * with a ```draw block, at .tide/visuals/<concept>.html, and each module part's big picture, an
 * immersive 3D scene, at .tide/visuals/parts/<module>#<part>.html. Each file is the visual's code
 * after a one-line header saying which model wrote it, when, whether it passed Tide's check, and
 * what the learner thought of it ("Was this clear?"); a thumbs-down redraws it next time. Pure:
 * the paths, the header, the prompts.
 */
import { conceptId } from './kitVisuals'
import { moduleParts, type ModuleDef } from './modules'
import { KIT_GUIDE, MAX_SCENE } from './visuals'

export const VISUALS_DIR = '.tide/visuals'

export interface SceneMeta {
  model: string
  /** ISO date it was written */
  at: string
  /** It passed Tide's check in the real frame (and was repaired first, if so) */
  checked: boolean
  repaired?: boolean
  /** "Was this clear?" */
  feedback?: 'up' | 'down'
  title?: string
  /** What it was asked to show */
  show?: string
}

export interface KeptVisual {
  code: string
  meta: SceneMeta
}

/** Where a concept's kept visual lives */
export const conceptFile = (concept: string) => `${VISUALS_DIR}/${conceptId(concept) || 'visual'}.html`

/** A module part's key: module id and part number (from 1) */
export const partKey = (module: string, part: number) => `${module.replace(/[^a-z0-9-]/gi, '').slice(0, 80)}#${Math.max(1, Math.floor(part))}`
export const partFile = (key: string) => `${VISUALS_DIR}/parts/${key.replace(/[^a-z0-9#-]/gi, '')}.html`

const HEADER = /^<!--\s*tide-visual\s+(\{[^\n]*\})\s*-->\n?/

/** The file's text: the header line, then the code */
export function keptText(v: KeptVisual): string {
  const meta: SceneMeta = { model: v.meta.model, at: v.meta.at, checked: !!v.meta.checked, ...(v.meta.repaired ? { repaired: true } : {}), ...(v.meta.feedback ? { feedback: v.meta.feedback } : {}), ...(v.meta.title ? { title: v.meta.title.slice(0, 120) } : {}), ...(v.meta.show ? { show: v.meta.show.slice(0, 400) } : {}) }
  return `<!-- tide-visual ${JSON.stringify(meta).replace(/--/g, '\\u002d\\u002d')} -->\n${v.code.trim()}\n`
}

/** A kept file read back; null when it isn't one */
export function readKept(text: string): KeptVisual | null {
  const m = HEADER.exec(text)
  if (!m) return null
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown>
    const code = text.slice(m[0].length).trim()
    if (!code || code.length > MAX_SCENE) return null
    const meta: SceneMeta = { model: typeof raw.model === 'string' ? raw.model : 'unknown', at: typeof raw.at === 'string' ? raw.at : '', checked: raw.checked === true }
    if (raw.repaired === true) meta.repaired = true
    if (raw.feedback === 'up' || raw.feedback === 'down') meta.feedback = raw.feedback
    if (typeof raw.title === 'string') meta.title = raw.title
    if (typeof raw.show === 'string') meta.show = raw.show
    return { code, meta }
  } catch {
    return null
  }
}

/** Whether a kept visual should be shown as it is: checked, and not thumbed down */
export const usable = (v: KeptVisual | null): v is KeptVisual => !!v && v.meta.checked && v.meta.feedback !== 'down'

// ---------- A concept's visual (```draw) ----------

export const CONCEPT_VISUAL_SYSTEM = `You write one interactive visual for Tide, a study app, that teaches one concept to a learner building from first principles. It will be kept and shown again whenever the concept comes up, so make it the definitive picture of the idea: correct to the last number, beautiful, and something the learner does, not only watches.
The visual is an HTML fragment that runs in a sandboxed frame with no network: inline <style>, SVG or canvas, inline <script>; no external scripts, fonts, images, fetch, storage, iframes or alert.
Tide's host API is the global visual: visual.steps(captions, draw, ms?) gives Back, Play, Step and Reset with a caption per step (draw(i) paints step i from 0; compute every state up front); visual.report(text, data?) tells the tutor what the learner did and what it shows now; visual.select(label, data?) for a part they click or press Enter on; visual.onReset(fn); visual.reducedMotion.
TideMath (TideMath.plane, slider, predict, goal, katex, three, fmt) is loaded for maths. ${KIT_GUIDE}
Design: one accent (--accent) for what matters now, neutrals (--ink --ink-soft --muted --line --line-strong --bg --surface) for the rest, the series colours --c1 to --c6 only for categories that must be told apart. Label parts directly, text 12px or more, no two labels overlapping at any step, nothing decorative, motion only to show a change. SVG gets a viewBox and the same width (640 for "0 0 640 …"), at most about 420 tall. Keyboard accessible. Every number computed in the script.
Teach: 4 to 9 steps whose captions build the idea in order, each a sentence or two using the numbers on screen; where it helps, a "predict first" (TideMath.predict) or a small goal (TideMath.goal) the learner reaches by changing something.
Reply with the visual only, as one fenced block whose language is visual, starting with a <title>.`

export const conceptVisualPrompt = (o: { concept: string; show?: string; topic?: string }) =>
  `Concept: ${o.concept}${o.show ? `\nWhat it must make visible: ${o.show}` : ''}${o.topic && o.topic !== o.concept ? `\nThe lesson it is for: ${o.topic}` : ''}`

// ---------- A module part's big picture ----------

export const PART_SCENE_SYSTEM = `You build the big picture for one part of a course in Tide, a study app: a single immersive, interactive 3D scene that shows the grand idea of the whole part, opened at the start of every lesson in it beside the tutor's first words on why the topic matters. The learner builds from first principles towards deep infrastructure work (systems, machine learning, quantitative finance, blockchains). This scene is the showpiece of the part: it must be genuinely beautiful, precise and correct, never a toy.
What it is: an HTML fragment run in a sandboxed frame with no network. Inline <style> and <script> only; no external scripts, fonts, images, fetch, storage, iframes or alert. three.js is served by Tide: \`const THREE = await TideMachine.three()\` (with THREE.OrbitControls), or build on TideMachine.scene, which already gives orbit, HTML labels that follow their parts, focus that fades the rest, a camera that glides between views, picking (visual.select) and keyboard controls.
${KIT_GUIDE}
Tide's host API, the global visual: visual.steps(captions, draw, ms?) shows Back, Play, Step and Reset with each step's caption (call it at once, before any await; draw(i) must work for any i, in any order, from i alone); visual.select(label, data) when the learner picks a part (Tide then offers "Ask about this"); visual.report(text, data) when they change something; visual.reducedMotion; visual.onTheme(fn); visual.color(name) reads a theme colour (e.g. visual.color('accent')) as a CSS colour for three.js.
The scene:
- One coherent space that makes the part's grand idea visible: the structure and how things flow through it (a walk from switches to gates to an adder to a CPU die; memory as frames, names and objects with arrows; a matrix bending a grid of space; activations and gradients flowing through a network; SMs, warps and memory; nodes exchanging messages; money moving between ledgers). Real proportions and real numbers where they exist, said as typical values.
- 5 to 8 steps, each a camera view and a focus on what that step is about, with a caption of one or two plain sentences that names the part's own topics in the order it teaches them. The first step is the whole picture; the last ties it together.
- Interactive: drag to orbit, scroll to zoom, click a part to select it, and at least one thing the learner can change (a slider or buttons, real labelled HTML controls under the canvas) that the scene answers, reported with visual.report.
- Labels: HTML, 12px or more, on what the current step is about, never overlapping; no text inside WebGL.
- Look: Tide's theme only. Colours from visual.color('accent' | 'ink' | 'ink-soft' | 'muted' | 'line' | 'line-strong' | 'bg' | 'surface' | 'c1'…'c6'), read again in visual.onTheme so light and dark both work; transparent renderer over var(--bg). One accent for what matters now; neutrals for structure; series colours only to tell categories apart. Soft hemisphere and directional light, MeshStandardMaterial, thin edge lines (EdgesGeometry) for crispness. Nothing decorative: no particles, glow, bloom or spinning for its own sake.
- Performance and care: render on demand (on controls change and during a glide), never an endless animation loop; respect visual.reducedMotion (jump instead of glide); keep it under 25k triangles; the canvas fills the frame's width, about 420px tall.
- Every number computed in the script, every fact right. Under about 600 lines.
Reply with the scene only, as one fenced block whose language is visual, starting with a <title> naming the part's grand idea.`

/** A wiki link's text, and no trailing source note: how a topic reads in a prompt or a match */
export const topicText = (s: string) => s.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_x, a: string, b: string) => b || a).replace(/\s+—\s+_.*$/, '').trim()

/** What a part's scene is asked from: the module, the part (from 1), its topics, the other parts */
export function partBrief(m: ModuleDef, part: number): { module: string; moduleTitle: string; part: number; title: string; topics: string[]; depthGoal?: string; others: string[] } | null {
  const parts = moduleParts(m)
  const p = parts[part - 1]
  if (!p) return null
  return { module: m.id, moduleTitle: m.title, part, title: p.title, topics: p.topics.map((t) => topicText(t.title)), ...(m.depthGoal ? { depthGoal: m.depthGoal } : {}), others: parts.filter((_x, i) => i !== part - 1).map((x) => x.title) }
}

export const partScenePrompt = (o: { module: string; part: string; depthGoal?: string; topics: string[]; others?: string[] }) =>
  `Course: ${o.module}${o.depthGoal ? `\n${o.depthGoal}` : ''}\nThis part: ${o.part}\nIts topics, in order:\n${o.topics.map((t) => `- ${t}`).join('\n')}${o.others?.length ? `\nThe course's other parts, for context: ${o.others.join('; ')}` : ''}\n\nBuild this part's big picture as one 3D scene. It must come out within ${Math.round(MAX_SCENE / 1000)}k characters.`

/** The repair call's instructions for a scene: the visual repair's, with the scene's limits */
export const SCENE_REPAIR_NOTE = `This is a 3D scene, a part's big picture: keep it 3D and keep its steps, and fix what Tide's check found. A blank canvas usually means the renderer never rendered (render after the scene is built and on every controls change), the camera looks away from the scene, or the scene's colours were read before the theme (read them with visual.color inside the draw).`
