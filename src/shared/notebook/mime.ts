/** Which of an output's forms the notebook draws (components/notebook/Outputs) */

/** The order Tide looks for a form in */
export const MIME_ORDER = [
  'application/vnd.tide.finance+json',
  'application/vnd.tide.graph+json',
  'application/vnd.plotly.v1+json',
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/latex',
  'text/markdown',
  'application/json',
  'text/plain'
]

export function pickMime(data: Record<string, unknown>): string | null {
  return MIME_ORDER.find((m) => data[m] !== undefined && data[m] !== null) ?? Object.keys(data)[0] ?? null
}
