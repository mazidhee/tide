/**
 * The practice stack: a MongoDB with generated practice data and a Metabase connected to it, run by
 * Docker Compose on this Mac (main/practiceStack). Fixed loopback ports, named volumes, one project
 * name, so Start, Stop and Reset always find the same containers. Pure: the compose file and labels.
 */

/**
 * A throwaway copy of Tide (a dev build started with TIDE_USER_DATA, for checks and walks) can run a
 * stack of its own beside yours: TIDE_PRACTICE_PROJECT names it and moves it 100 ports up, so it
 * never starts, resets or writes to your tide-practice volumes. Ignored anywhere else.
 */
const env: Record<string, string | undefined> = (typeof process !== 'undefined' && process.env) || {}
const testStack = !!env.TIDE_USER_DATA && /^tide-practice-[a-z0-9-]+$/.test(env.TIDE_PRACTICE_PROJECT ?? '')
export const PRACTICE_PROJECT: string = testStack ? env.TIDE_PRACTICE_PROJECT! : 'tide-practice'
export const PRACTICE_PORTS: { mongo: number; metabase: number } = testStack ? { mongo: 27147, metabase: 3147 } : { mongo: 27047, metabase: 3047 }
export const PRACTICE_IMAGES = { mongo: 'mongo:8.0', metabase: 'metabase/metabase:v0.64.3.3' } as const
export const PRACTICE_DB = 'practice'
export const PRACTICE_URL = `http://127.0.0.1:${PRACTICE_PORTS.metabase}`
/** Where the spec is read from, in the notes folder (the first that exists) */
export const SPEC_PATHS = ['Practice/spec.json', 'Practice/spec.yaml', 'Practice/spec.yml']

/** The two places Metabase can be, as the window names them, always */
export const PLACE_LABEL = { practice: 'Practice (yours to break)', production: 'Your company’s data (read-only)' } as const

/**
 * The compose file: loopback ports only, named volumes, memory kept small (Docker Desktop's VM is
 * often 2 GB and shared). The data is copied into the container to load, so no folder is shared.
 */
export function composeFile(): string {
  return `name: ${PRACTICE_PROJECT}
services:
  mongo:
    image: ${PRACTICE_IMAGES.mongo}
    ports:
      - "127.0.0.1:${PRACTICE_PORTS.mongo}:27017"
    command: ["--wiredTigerCacheSizeGB", "0.25"]
    volumes:
      - mongo:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 5s
      timeout: 5s
      retries: 30
    restart: "no"
  metabase:
    image: ${PRACTICE_IMAGES.metabase}
    ports:
      - "127.0.0.1:${PRACTICE_PORTS.metabase}:3000"
    environment:
      MB_DB_FILE: /metabase-data/metabase.db
      MB_ANON_TRACKING_ENABLED: "false"
      MB_CHECK_FOR_UPDATES: "false"
      MB_SITE_NAME: "Tide practice"
      JAVA_OPTS: "-Xmx512m -XX:+UseSerialGC"
    volumes:
      - metabase:/metabase-data
    depends_on:
      mongo:
        condition: service_healthy
    restart: "no"
volumes:
  mongo:
  metabase:
`
}

export type DockerState = 'missing' | 'not-running' | 'ok'

export interface PracticeStatus {
  docker: DockerState
  /** Containers up */
  running: boolean
  mongo: 'down' | 'up'
  metabase: 'down' | 'starting' | 'ready'
  /** Metabase has its admin, the practice database and Tide's key */
  setUp: boolean
  seeded: { at: number; collections: { name: string; count: number }[]; spec: string } | null
  spec: { path: string | null; problems: string[]; name?: string; collections: number; documents: number }
  /** The learner's Metabase layout (Practice/layout.json), when there is one, and the last rebuild */
  layout?: { path: string | null; problems: string[]; questions: number; dashboards: number; built: { at: number; questions: number; dashboards: number; made: number; missing: string[] } | null }
  url: string
  ports: typeof PRACTICE_PORTS
  /** What's happening now (starting, loading data…) */
  busy?: string
  error?: string
}

export interface PracticeApi {
  status(): Promise<PracticeStatus>
  start(): Promise<PracticeStatus>
  stop(): Promise<PracticeStatus>
  reset(): Promise<PracticeStatus>
  /** Recreates the layout in the practice Metabase, updating in place */
  layout(): Promise<PracticeStatus>
  open(): Promise<void>
  /** The practice Metabase's own login (local only), to sign in and look around yourself */
  login(): Promise<{ email: string; password: string } | null>
}

/** One plain sentence for the state, for Settings */
export function statusLine(s: PracticeStatus): string {
  if (s.docker === 'missing') return 'Docker isn’t installed. Install Docker Desktop to run practice data.'
  if (s.docker === 'not-running') return 'Docker isn’t running. Open Docker Desktop, then press Start.'
  if (s.busy) return s.busy
  if (!s.running) return s.seeded ? 'Stopped. Your practice data is kept.' : 'Not started yet.'
  if (s.metabase === 'starting') return 'Starting Metabase (this takes a minute or two)…'
  if (s.metabase === 'ready' && s.setUp) return 'Running.'
  return 'Running, Metabase not set up yet.'
}

/**
 * The shell script that loads the generated files (copied to /tmp/seed in the Mongo container), one
 * mongoimport per collection, stopping at the first that fails and saying which. Names are plain
 * (letters, digits, _ . -), as the spec requires; anything else is refused rather than quoted.
 */
export function loadScript(collections: { name: string; drop: boolean }[]): string {
  const lines = collections.map(({ name, drop }) => {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`Not a plain collection name: ${JSON.stringify(name)}`)
    return `mongoimport --quiet --db ${PRACTICE_DB} --collection '${name}'${drop ? ' --drop' : ''} --jsonArray --file '/tmp/seed/${name}.json' || { echo "Loading ${name} failed" >&2; exit 1; }`
  })
  return lines.join('\n')
}
