/**
 * The run tracker's records, for the notebook's Runs tab: each experiment is a folder of
 * JSON-lines files in Tide's runs folder (main/runner runsDir), written by tide_runs from a
 * notebook's kernel or a lesson's run.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { parseRun, safeExperiment, type TrainingRun } from '@shared/runs'
import { runsDir } from '../runner'

const MAX_RUNS = 40

export async function listRuns(experiment: string, root = runsDir()): Promise<TrainingRun[]> {
  const dir = join(root, safeExperiment(experiment || 'default'))
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl')).sort().slice(-MAX_RUNS)
  const out: TrainingRun[] = []
  for (const n of names) {
    const text = await fs.readFile(join(dir, n), 'utf8').catch(() => '')
    if (text) out.push(parseRun(text, n.slice(0, -6), experiment))
  }
  // Two runs started in the same second are named in random order; their start times aren't
  return out.sort((a, b) => a.started - b.started || a.id.localeCompare(b.id))
}

/** Forgets one run: its file goes */
export async function deleteRun(experiment: string, id: string, root = runsDir()): Promise<void> {
  if (!/^[\w.-]+$/.test(id)) throw new Error('Not a run.')
  await fs.rm(join(root, safeExperiment(experiment || 'default'), `${id}.jsonl`), { force: true })
}
