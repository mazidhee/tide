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

const SCENE_EXAMPLE = `<title>Bits become a sum</title>
<div id="s"></div>
<div class="row"><label>A <input id="a" type="range" min="0" max="15" value="5"></label> <output id="out" class="mono"></output></div>
<style>.row { display: flex; gap: 12px; align-items: center; margin-top: 8px }</style>
<script>
const parts = []
for (let i = 0; i < 4; i++) parts.push({ id: 'a' + i, label: 'A' + (3 - i), box: [0.8, 0.5, 0.8], at: [i * 1.2 - 1.8, 0.25, 0], color: 'line-strong', group: 'bits', labelled: i === 0 ? 'focus' : 'never' })
parts.push({ id: 'board', box: [6, 0.2, 3], at: [0, -0.1, 0], color: 'surface', labelled: 'never', chip: false })
const s = TideMachine.scene('#s', { label: 'Four bits', parts, steps: [
  { say: 'Four switches hold a number.', fit: ['board'] },
  { say: 'The lit ones are 1s.', focus: ['bits'], fit: ['a0', 'a3'], from: [0, 1, 0.6] }
] })
visual.steps(s.captions, s.draw)
const a = document.getElementById('a'), out = document.getElementById('out')
const show = () => {
  for (let i = 0; i < 4; i++) s.set('a' + i, { lit: (+a.value >> (3 - i)) & 1 })
  out.textContent = TideMachine.bin(+a.value, 4) + ' = ' + a.value
}
a.addEventListener('input', show)
a.addEventListener('change', () => visual.report('set A to ' + a.value, { A: +a.value }))
show()
</script>`

export const PART_SCENE_SYSTEM = `You build the big picture for one part of a course in Tide, a study app: a single immersive, interactive 3D scene that shows the grand idea of the whole part, opened at the start of every lesson in it beside the tutor's first words on why the topic matters. The learner builds from first principles towards deep infrastructure work (systems, machine learning, quantitative finance, blockchains). This scene is the showpiece of the part: it must be genuinely beautiful, precise and correct, never a toy.
What it is: an HTML fragment run in a sandboxed frame with no network. Inline <style> and <script> only; no external scripts, fonts, images, fetch, storage, iframes or alert.
Build it on TideMachine.scene: it gives orbit, HTML labels that follow their parts and never overlap or leave the canvas, focus that fades the rest, a camera that glides between views (and jumps while Tide checks the scene), framing, picking (visual.select) and keyboard controls.
  const s = TideMachine.scene(el, { label, height: 420, parts: [{ id, label, note, box: [w, h, d], at: [x, y, z], shape: 'box' | 'cylinder' (box [radius, height]) | 'sphere' (box [radius]), rot: [x, y, z], color: 'c1' | 'surface' | 'line-strong' | …, group, info: {…}, hidden, labelled: 'focus' | 'always' | 'never', chip: false }], lines: [{ id, points: [[x, y, z], …], color, radius, hidden }], steps: [{ say, fit: [ids or groups' members], from: [x, y, z], focus: [ids or groups], labels: [ids], show: [ids], lit: [ids] }] })
  visual.steps(s.captions, s.draw) at once. s.set(id, { lit, color, label, note, hidden, at, box }) changes a part (what your controls call). s.ready.then(({ THREE, render }) => s.add(id, object3D, { label, info, group })) adds geometry of your own (tubes for wires and data paths, planes, instanced grids), labelled, faded, framed and picked like a part. fit makes the camera frame those parts from the direction from: use it for every step, so each step's subject fills the view.
${KIT_GUIDE}
Tide's host API, the global visual: visual.steps(captions, draw, ms?); visual.select(label, data) when the learner picks a part (Tide then offers "Ask about this"); visual.report(text, data) when they change something; visual.reducedMotion; visual.onTheme(fn); visual.color(name).
The scene:
- One coherent space that makes the part's grand idea visible: its structure and how things flow through it, built from the real thing's parts (a walk from switches to gates to an adder to a CPU's datapath; memory as frames, names and objects with arrows; a matrix bending a grid of space; activations and gradients flowing through a network; SMs, warps and memory; nodes exchanging messages; money moving between ledgers). Real proportions and real numbers where they exist, said as typical values.
- Composition: 3 to 6 large, clearly separated stations on low plates of 'surface', laid out so the whole picture fills a wide frame (about 16:10): two rows, or a gentle arc, never one long thin line; the path between them drawn as tubes. Each station recognisable from the whole view; nothing thinner than a tenth of its station. The whole view frames everything; each later step fits its own station.
- 5 to 8 steps whose captions (one or two plain sentences, the exact numbers on screen) walk the part's own topics in order; the first is the whole picture, the last ties it together.
- Labels: at most 4 on screen in a step, each under 28 characters (a name and at most a short number). Longer working (sums, binary strings, formulas) goes in the caption or in the HTML readout under the canvas, never in a label.
- Interactive: one row of real labelled HTML controls under the scene (a slider and a toggle, or a few buttons; no more) that changes the scene through s.set, with one short readout line, reported with visual.report. Clicking a part selects it; mark the 4 to 8 main parts chip: true so they can be picked from the keyboard too.
- Look: Tide's theme only, through the colour names: one accent ('accent', and lit parts) for what matters now; neutrals ('surface', 'line-strong', 'muted', 'ink-soft') for structure; the series colours 'c2' to 'c6' only to tell kinds of things apart, at most three of them. Nothing decorative: no particles, glow or spinning for its own sake.
- Care: render on demand only (TideMachine.scene does); never an animation loop; respect visual.reducedMotion; under 20k triangles; every number computed in the script, every fact right; under about 450 lines.
A short example of the pattern (yours is far richer):
\`\`\`visual
${SCENE_EXAMPLE}
\`\`\`
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
