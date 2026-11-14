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

/** How a 3D scene is built and how it must look: the scene prompt's craft, shared with any other 3D brief */
export const SCENE_CRAFT = `How it runs: an HTML fragment in a sandboxed frame with no network (inline <style> and <script> only; no external scripts, fonts, images, fetch, storage or iframes). three.js comes from Tide: \`const THREE = await TideMachine.three()\` (with THREE.OrbitControls). Write the scene freehand on three.js: you have full freedom of geometry, composition and camera. Tide's helpers are there to save work, never to limit it:
  - TideMachine.studio(THREE, scene, renderer, { ground }) gives the house look in one call: filmic tone mapping, a soft key light with shadows plus fill and sky light, a ground that only shows shadows over the page colour, fog into the page, all in the theme and switched with it; .frame(center, radius) aims the shadows at what the camera looks at.
  - TideMachine.materials(THREE): .metal .darkMetal .silicon (a die's floorplan texture) .pcb (green-black board with copper traces) .glass (a bulb: raise emissiveIntensity to light it) .wire .plastic(colourName) .matte(colourName). TideMachine.halo(THREE, colourName, size) is a glow sprite for what is on. TideMachine.text3d(THREE, text, { size, color }) is crisp text in the scene. TideMachine.arrow3d(THREE, colourName, radius).set(from, to).
  - Patterns: TideMachine.teardown(el, { parts: [{ id, label, note, box, at, explode: [dx, dy, dz], parent, material, say }], order }) is an exploded view (assembled, taken apart, each part isolated with the rest ghosted, click to isolate). TideMachine.surface(el, { f, x, y, descent: { start, rate, steps } }) is a surface with a probe point, its tangent plane and gradient, and an optimiser's path. TideMachine.space(el, { matrix }) is a linear map deforming a grid, with basis vectors, eigenvectors and the determinant. TideMachine.scene(el, { parts, steps: [{ say, fit, focus, only }] }) is a general scene of labelled parts. Use one as it is, or build your own the same way.
The contract with Tide (keep all of it):
  - Call visual.steps(captions, draw, ms) at once, before any await; draw(i) shows step i from i alone, in any order. Captions are one or two plain sentences with the exact numbers on screen.
  - While Tide checks the scene (visual.auditing is true) and when visual.reducedMotion is true, steps jump: no glides.
  - Clicking or pressing Enter on a part calls visual.select(name, { facts }); a control the learner moves calls visual.report(what changed, { numbers }).
  - Colours come from the theme: visual.color('bg' | 'surface' | 'ink' | 'ink-soft' | 'muted' | 'line-strong' | 'accent' | 'c1'…'c6'), read again in visual.onTheme (TideMachine.studio and TideMachine.materials follow the theme for you). Restraint: structure is neutral or a believable material (metal, silicon, a PCB, glass, which keep their own colours); one accent for what matters in this step; at most three series colours in the whole scene, and only to tell kinds of thing apart. Never a rainbow of regions.
  - Render on demand: on a controls change, during a glide, during a short pulse that stops. Never a loop that runs for ever (Tide stops a frame that keeps a core busy).
  - Labels: HTML elements over the canvas, positioned each render from their 3D anchor, 13px or larger, one line each (a name, and at most a short number after it), their background box always containing all their text; hidden when their anchor leaves the canvas; never overlapping one another or the subject's key detail (Tide checks every step). At most 5 at a time. Longer facts go in the caption or the readout. text3d sprites are fine for names fixed in the scene, sized to read at least as large.
  - The canvas has a fixed height (about 460px) and the frame's full width: never size anything from window.innerHeight, 100vh or the document's height (the frame grows to fit its content, so that would grow without end).
  - Build everything and render the first step at once on load: no fade-in or intro animation from an empty canvas.
  - No network, no storage. Under about 700 lines.
How it must look (the bar is a calm, beautiful scale model, stylised and precise, never a toy or a chart):
  - Each step's subject fills most of the frame (its widest extent across about 80% of the canvas) and all of it is in view: frame every step with TideMachine.fitView(THREE, camera, subjectObject, { from: [x, y, z], fill: 0.85 }), which fits the subject's actual geometry, not a bounding sphere; do not write your own fitting, and never guess camera numbers. Prefer views from the front and a little above (from about [0.2, 0.6, 1]) so a flat subject faces the camera rather than lying edge-on. Only that step's station is visible (hide the others, or place stations far apart so fog swallows them): nothing from another step bleeds in at the edges, and nothing is cut off by the frame.
  - Soft key light with shadows, a cool fill, filmic tone mapping; materials that read as the real thing; what is on glows (emissive plus a halo); generous spacing so no two objects crowd or overlap (at least an object's own width between neighbours).
  - Confident camera moves between steps (0.7 to 1.2 s, eased), each ending on a composed view; the learner may orbit and zoom at any time.
  - Every element the brief names is in the scene; every number and fact is right.
  - Controls, when there are any, are one row of real labelled HTML controls under the canvas, with one short readout.`

export const PART_SCENE_SYSTEM = `You build the big picture for one part of a course in Tide, a study app: a single immersive, interactive 3D scene of the part's grand idea, opened at the start of every lesson in it beside the tutor's first words on why the topic matters. The learner builds from first principles towards deep infrastructure work (systems, machine learning, quantitative finance, blockchains). This scene is the showpiece of the part: beautiful, precise and correct.
Choose the form that fits the part:
  - A system (hardware, a machine, an architecture, a protocol stack, a model): an exploded view. Show the whole assembled and rendered in full, then take it apart into its pieces one by one, each isolated with the rest ghosted and captioned, and let the learner click any piece to isolate it. For example a motherboard → the CPU package → the die → a core → its ALU, registers and caches; a GPU → its SMs → warps → tensor cores; a transformer block → embeddings, attention heads, the MLP, the residual stream.
  - A flow (a payment rail, a network request, a pipeline, a ledger): the stations as one 3D system whose pieces separate along the path, with the messages or money moving between them as glowing pulses, step by step (card → terminal → acquirer → network → issuer → settlement).
  - Maths or ML mechanics: a manipulable 3D space. A surface with its tangent plane and gradient; a linear map deforming space, with its eigenvectors; a distribution as a density surface; a loss landscape with an optimiser's path; a network whose activations and gradients flow.
  - A journey of levels (switch → gate → adder → CPU; source → bytecode → frames → objects): a walk through stations, one per step, each a small world of its own.
The steps (5 to 9) walk the part's own topics in the order it teaches them; the first shows the whole, the last ties it together.
${SCENE_CRAFT}
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
