/**
 * Projects: something you're building or need to understand, with its documents. Two kinds:
 * - understand: a system that exists (a design doc, a spec). Tide maps it and teaches its parts,
 *   its flows and the tools it uses, in the system's own terms, as you need them.
 * - build: something new you'll build yourself. Tide drafts the project brief with you (goal,
 *   architecture, milestones, what to learn first) and then works through it beside you, without
 *   writing it for you.
 *
 * Mapping a project is mostly code: headings give the structure, a lexicon finds the tools, and
 * flow-like headings give the flows. One short model call names the components and writes the
 * overview from the headings alone; no document is read through.
 */
import { connect, findNode, makeNode, NODE_H, NODE_W, placeNode, type Canvas, type ComponentKind } from './canvas'

export type ProjectKind = 'understand' | 'build'

export interface ProjectInfo {
  kind: ProjectKind
  /** Its documents, by vault path (anything filed under the project in the Library counts too) */
  docs: string[]
  /** For a build: the brief Tide drafted with you */
  brief?: string
  /** For a project planned from an idea: its code folder (vault path, in the Code folder) */
  code?: string
}

export interface ProjectMap {
  builtAt: number
  /** The documents' versions it was built from, to know when to rebuild */
  key: string
  overview: string
  components: { name: string; about: string }[]
  flows: string[]
  tools: { name: string; mentions: number }[]
  headings: string[]
}

/** Tools and systems worth recognising, with the spellings documents use */
const TOOLS: [string, RegExp][] = [
  ['MongoDB', /\bmongo(db)?\b|\bmongoose\b/i],
  ['PostgreSQL', /\bpostgres(ql)?\b|\bpsql\b/i],
  ['MySQL', /\bmysql\b/i],
  ['SQLite', /\bsqlite\b/i],
  ['Redis', /\bredis\b/i],
  ['Kafka', /\bkafka\b/i],
  ['RabbitMQ', /\brabbitmq\b/i],
  ['Elasticsearch', /\belastic ?search\b/i],
  ['Docker', /\bdocker(file|-compose)?\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b|\bkubectl\b/i],
  ['Terraform', /\bterraform\b/i],
  ['AWS', /\baws\b|\bamazon web services\b|\bs3\b|\blambda\b|\bsqs\b|\bdynamodb\b/i],
  ['GCP', /\bgcp\b|\bgoogle cloud\b|\bbigquery\b/i],
  ['Azure', /\bazure\b/i],
  ['n8n', /\bn8n\b/i],
  ['Airflow', /\bairflow\b/i],
  ['Temporal', /\btemporal(\.io)?\b(?= workflow| worker| server|\.io)/i],
  ['GraphQL', /\bgraphql\b/i],
  ['gRPC', /\bgrpc\b|\bprotobuf\b/i],
  ['REST APIs', /\brest(ful)? api\b/i],
  ['Webhooks', /\bwebhooks?\b/i],
  ['OAuth', /\boauth2?\b|\bopenid\b/i],
  ['JWT', /\bjwt\b/i],
  ['Node.js', /\bnode(\.js|js)?\b(?! of)|\bexpress(\.js)?\b|\bnestjs\b/i],
  ['TypeScript', /\btypescript\b/i],
  ['Python', /\bpython\b|\bfastapi\b|\bdjango\b|\bflask\b/i],
  ['Go', /\bgolang\b/i],
  ['Rust', /\brust\b(?! belt)/i],
  ['C', /\bC language\b|\bin C\b|\bANSI C\b|\bC99\b|\bC11\b|\bmalloc\b|\bpointers?\b/],
  ['C++', /\bc\+\+\b/i],
  ['Java', /\bjava\b(?!script)|\bspring boot\b/i],
  ['React', /\breact(\.js)?\b|\bnext\.js\b/i],
  ['Metabase', /\bmetabase\b/i],
  ['Mixpanel', /\bmixpanel\b/i],
  ['dbt', /\bdbt\b/i],
  ['Spark', /\bapache spark\b|\bpyspark\b/i],
  ['Pandas', /\bpandas\b/i],
  ['Stripe', /\bstripe\b/i],
  ['ISO 20022', /\biso ?20022\b|\bpacs\.008\b|\bcamt\.05[234]\b/i],
  ['SWIFT', /\bswift\b(?= (mt|gpi|network|message|code))|\bmt103\b|\bmt940\b/i],
  ['ACH', /\bach\b(?= (file|transfer|payment|network|batch))|\bnacha\b/i],
  ['Blockchain', /\bblockchain\b|\bsmart contracts?\b|\bethereum\b|\bsolidity\b/i],
  ['Git', /\bgit(hub|lab)?\b/i],
  ['Linux', /\blinux\b|\bsystemd\b|\bbash\b/i],
  ['Nginx', /\bnginx\b/i],
  ['Prometheus', /\bprometheus\b|\bgrafana\b/i],
  ['OpenTelemetry', /\bopentelemetry\b|\botel\b/i]
]

/** The tools a set of texts uses, most mentioned first (two mentions at least) */
export function detectTools(texts: string[]): { name: string; mentions: number }[] {
  const counts = new Map<string, number>()
  for (const text of texts)
    for (const [name, re] of TOOLS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
      const n = text.match(g)?.length ?? 0
      if (n) counts.set(name, (counts.get(name) ?? 0) + n)
    }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name, mentions]) => ({ name, mentions }))
}

/** Headings that describe something happening in order: flows, pipelines, lifecycles */
const FLOWISH = /\b(flows?|process|lifecycle|life cycle|pipeline|sequence|workflows?|journey|end[- ]to[- ]end|state machine|how .+ works?|step by step)\b/i
/** A part, not a flow: "Matching Engine", "Ledger service" */
const PART = /\b(service|engine|module|component|api|database|collection|model|design|overview|architecture)s?\s*$/i

export function flowsIn(headings: string[]): string[] {
  const seen = new Set<string>()
  return headings
    .map((h) => h.replace(/^[\d.\s]+/, '').replace(/[:.\s]+$/, '').trim())
    .filter((h) => h.length > 3 && h.length < 90 && FLOWISH.test(h) && !PART.test(h) && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()))
    .slice(0, 12)
}

/** A Markdown document's headings, in order */
export const markdownHeadings = (md: string) => [...md.matchAll(/^#{1,4}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].replace(/[*_`]/g, '').trim())

/** The milestones in a build brief: the checklist under its "Milestones" heading */
export function briefMilestones(md: string): { text: string; done: boolean }[] {
  const at = md.search(/^#{2,3}\s+milestones\b/im)
  if (at < 0) return []
  const rest = md.slice(at).split('\n').slice(1)
  const out: { text: string; done: boolean }[] = []
  for (const line of rest) {
    if (/^#{1,3}\s/.test(line)) break
    const m = line.match(/^\s*[-*] \[([ xX])\]\s+(.+)$/)
    if (m) out.push({ text: m[2].replace(/\*\*/g, '').trim(), done: m[1] !== ' ' })
  }
  return out
}

/**
 * A walkthrough's canvas, laid out before the lesson from what the project map already knows: its
 * parts in a row, the data stores it uses beneath them, nothing connected yet. The tutor then only
 * has to draw the flow between them, step by step, which is quicker and far more reliable than a
 * small model placing every box itself.
 */
export function seedCanvas(map: Pick<ProjectMap, 'components' | 'tools'>): Canvas {
  let canvas: Canvas = { nodes: [], edges: [] }
  const kindOf = (name: string): ComponentKind =>
    /\b(db|database|store|collection)\b/i.test(name) ? 'database' : /\b(queue|bus|stream|kafka)\b/i.test(name) ? 'queue' : /\b(worker|job|scheduler|cron)\b/i.test(name) ? 'worker' : /\b(client|app|ui|dashboard|portal)\b/i.test(name) ? 'client' : /\b(bank|partner|provider|third|external)\b/i.test(name) ? 'external' : 'service'
  const STORES = new Set(['MongoDB', 'PostgreSQL', 'MySQL', 'SQLite', 'Redis', 'Kafka', 'RabbitMQ', 'Elasticsearch'])
  const parts = map.components.slice(0, 7)
  parts.forEach((c, i) => {
    // Two columns: a lesson's canvas is a tall, narrow panel
    canvas = { ...canvas, nodes: [...canvas.nodes, makeNode(canvas, { label: c.name, kind: kindOf(c.name), ...(c.about ? { details: c.about.slice(0, 60) } : {}), x: (i % 2) * (NODE_W + 80), y: Math.floor(i / 2) * (NODE_H + 110) })] }
  })
  map.tools
    .filter((t) => STORES.has(t.name))
    .slice(0, 3)
    .forEach((t, i) => {
      canvas = { ...canvas, nodes: [...canvas.nodes, makeNode(canvas, { label: t.name, kind: t.name === 'Kafka' || t.name === 'RabbitMQ' ? 'queue' : 'database', x: (i % 2) * (NODE_W + 80) + (NODE_W + 80) / 2, y: Math.ceil(parts.length / 2) * (NODE_H + 110) + 20 + Math.floor(i / 2) * (NODE_H + 90) })] }
    })
  return canvas
}

/** One step of a flow: something passing from one part to another */
export interface FlowStep {
  from: string
  to: string
  /** What passes, in a few words */
  label: string
}

/**
 * How many of a flow's steps the lesson has reached: a step counts once the tutor has named the part
 * it arrives at (or, for the first, either end), in order. Code, not the model, so the canvas
 * always keeps pace with the lesson and never runs ahead of what you've been asked to predict.
 */
export function stepsReached(steps: FlowStep[], tutorText: string): number {
  const said = tutorText.toLowerCase()
  // The full name, or any two words of it in a row ("ingestion service" for "Statement Ingestion service")
  const named = (part: string) => {
    const words = part.toLowerCase().split(/\s+/)
    if (said.includes(words.join(' '))) return true
    for (let i = 0; i + 1 < words.length; i++) if (said.includes(`${words[i]} ${words[i + 1]}`)) return true
    return words.length === 1 && said.includes(words[0])
  }
  let n = 0
  for (const s of steps) {
    if (!(named(s.to) || (n === 0 && named(s.from)))) break
    n++
  }
  return n
}

/** The canvas with the first `n` steps drawn, adding any part a step needs that isn't there yet */
export function drawSteps(start: Canvas, steps: FlowStep[], n: number): Canvas {
  let c: Canvas = { nodes: [...start.nodes], edges: [] }
  const ensure = (label: string) => {
    if (findNode(c, label)) return
    const near = c.nodes[c.nodes.length - 1]
    const at = placeNode(c, near, 'below')
    c = { ...c, nodes: [...c.nodes, makeNode(c, { label, kind: /\b(bank|customer|partner|provider|merchant|user|client)\b/i.test(label) ? 'external' : 'service', ...at })] }
  }
  steps.slice(0, n).forEach((s, i) => {
    ensure(s.from)
    ensure(s.to)
    c = connect(c, findNode(c, s.from)!.id, findNode(c, s.to)!.id, `${i + 1}. ${s.label}`)
  })
  return c
}
