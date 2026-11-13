/**
 * The Run and Copy buttons on code blocks in rendered Markdown (lib/markdown puts them there): a
 * note, a lesson's reading, a course's lesson. Run uses Tide's sandboxed runner (main/runner) and
 * writes what came out under the block.
 *
 * A notebook's cells share their state, as in Jupyter: with `cumulative`, a cell is run after every
 * cell of its language above it, and only its own output is shown. Lines that are Jupyter's own
 * (!pip, %matplotlib) are left out, since the runner is plain Python.
 */

import { trackPack, type TrackPackId } from '@shared/trackPacks'

const MARK = '__tide_cell_output_starts__'

const PACK_NAMES: Record<string, TrackPackId> = { 'C++': 'cpp', Foundry: 'foundry', 'Big data': 'bigdata', Postgres: 'postgres' }

/**
 * When a run says it needs a track pack ("needs the Foundry pack"), an Install button under its
 * output, with the pack's size; it installs in the background and says when to run again.
 */
export function offerPack(out: HTMLElement, stderr: string) {
  if (out.nextElementSibling?.classList.contains('pack-offer')) out.nextElementSibling.remove()
  const id = PACK_NAMES[/needs the (C\+\+|Foundry|Big data|Postgres) pack\b/.exec(stderr)?.[1] ?? '']
  if (!id) return
  const pack = trackPack(id)!
  const box = document.createElement('div')
  box.className = 'pack-offer'
  const text = document.createElement('div')
  text.className = 'pack-offer-text'
  const title = document.createElement('strong')
  title.textContent = `This needs the ${pack.title}`
  const line = document.createElement('span')
  line.textContent = `${pack.contents}. ${pack.download} to download, ${pack.size} on disk, into Tide’s own tools folder.`
  text.append(title, line)
  const button = document.createElement('button')
  button.className = 'btn small primary'
  button.textContent = `Install · ${pack.download.replace(/^about /, '')}`
  button.addEventListener('click', async () => {
    button.remove()
    const off = window.tide.packs.onProgress((p) => p.id === id && (line.textContent = p.step))
    try {
      const s = await window.tide.packs.install(id)
      line.textContent = s.ready ? `Installed (${s.detail}). Run it again.` : s.detail
    } finally {
      off()
    }
  })
  box.append(text, button)
  out.after(box)
}

const jupyterOnly = (code: string) =>
  code
    .split('\n')
    .filter((l) => !/^\s*[!%]/.test(l))
    .join('\n')

function codeOf(pre: HTMLElement) {
  return pre.querySelector('code')?.textContent ?? ''
}

/** Handles a click on a code block's Run or Copy; true when it was one */
export async function codeBlockClick(target: EventTarget | null, opts: { cumulative?: boolean } = {}): Promise<boolean> {
  const el = target instanceof Element ? target : null
  const copy = el?.closest<HTMLButtonElement>('.copy-code')
  if (copy) {
    await navigator.clipboard.writeText(codeOf(copy.parentElement as HTMLElement)).catch(() => {})
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy'), 1200)
    return true
  }
  const run = el?.closest<HTMLButtonElement>('.run-code')
  if (!run) return false
  const pre = run.parentElement as HTMLElement
  const lang = (pre.dataset.lang || 'python').toLowerCase()
  let code = codeOf(pre)
  let cumulative = false
  if (opts.cumulative && /^(python|py)$/.test(lang)) {
    // Every Python cell above it in the same reading, in order
    const scope = pre.closest('.crs-prose, .prose') ?? document.body
    const cells = [...scope.querySelectorAll<HTMLElement>('pre.code-block')].filter((p) => /^(python|py)$/i.test(p.dataset.lang ?? ''))
    const before = cells.slice(0, cells.indexOf(pre)).map((p) => jupyterOnly(codeOf(p)))
    if (before.length) {
      code = `${before.join('\n\n')}\n\nprint(${JSON.stringify(MARK)})\n${jupyterOnly(code)}`
      cumulative = true
    } else code = jupyterOnly(code)
  }
  let out = pre.nextElementSibling as HTMLElement | null
  if (!out?.classList.contains('run-output')) {
    out = document.createElement('div')
    out.className = 'run-output'
    pre.after(out)
  }
  run.disabled = true
  run.textContent = 'Running…'
  out.textContent = ''
  try {
    const r = await window.tide.runner.run(lang, code)
    let stdout = r.stdout || ''
    let stderr = r.stderr || ''
    if (cumulative) {
      const at = stdout.indexOf(MARK)
      // Failed before reaching this cell: say it was an earlier cell
      if (at < 0) stderr = `An earlier cell stopped before this one ran.\n${stderr}`
      stdout = at < 0 ? '' : stdout.slice(at + MARK.length).replace(/^\n/, '')
    }
    out.classList.toggle('failed', r.exitCode !== 0 || r.timedOut)
    out.textContent =
      stdout + (stderr ? (stdout ? '\n' : '') + stderr : '') + (r.timedOut ? '\nStopped after 10 seconds.' : '') + (!stdout && !stderr && !r.timedOut ? 'Ran with no output.' : '')
    out.dataset.meta = r.timedOut ? 'timed out' : `exit ${r.exitCode}, ${r.durationMs} ms${cumulative ? ', with the cells above' : ''}`
    offerPack(out, stderr)
  } catch (e) {
    out.classList.add('failed')
    out.textContent = (e as Error).message
  } finally {
    run.disabled = false
    run.textContent = 'Run'
  }
  return true
}
