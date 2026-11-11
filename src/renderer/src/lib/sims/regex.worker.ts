/** Runs a regular expression over the test strings away from the window, so a runaway pattern can be stopped */
import { runMatches } from './regex'

self.onmessage = (e: MessageEvent<{ id: number; pattern: string; flags: string; tests: string[] }>) => {
  const { id, pattern, flags, tests } = e.data
  self.postMessage({ id, outcome: runMatches(pattern, flags, tests) })
}
