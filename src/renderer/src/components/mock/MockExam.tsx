import { useRef } from 'react'
import type { ExamMark, ExamPaper } from '@shared/types'
import { renderMarkdown } from '../../lib/markdown'
import { readImageFile } from '../../lib/pastedImages'
import { Icon } from '../Icon'

export type ExamAnswers = Record<string, { text: string; images: string[] }>

const key = (q: number, p: number) => `${q}:${p}`
const md = (s: string) => ({ __html: renderMarkdown(s, { notePath: '', filesByName: new Map() }) })
const isHeic = (f: File) => /^image\/hei[cf]$/.test(f.type) || /\.hei[cf]$/i.test(f.name)

/** A photo of working, made small enough to mark quickly: longest side 1568 px (the most Claude uses), JPEG */
function shrink(file: File): Promise<string> {
  if (isHeic(file)) return readImageFile(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 1568 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('That file is not an image'))
    img.src = url
  })
}

/**
 * Marks every part with the exam marker (main/exam markPart: Opus when Claude is ready, Gemma
 * otherwise; photos of handwriting included), one after another. A part left blank scores 0.
 */
export async function markPaper(paper: ExamPaper, answers: ExamAnswers, progress: (where: string) => void): Promise<Record<string, ExamMark>> {
  const out: Record<string, ExamMark> = {}
  for (const q of paper.questions) {
    for (let i = 0; i < q.parts.length; i++) {
      const k = key(q.number, i)
      const a = answers[k] ?? { text: '', images: [] }
      progress(`${q.number}(${q.parts[i].label})`)
      if (!a.text.trim() && !a.images.length) {
        out[k] = { awarded: 0, marks: q.parts[i].marks, feedback: 'No answer given.', missed: '' }
        continue
      }
      try {
        out[k] = await window.tide.exam.mark(q, i, a.text, a.images)
      } catch (e) {
        out[k] = { awarded: 0, marks: q.parts[i].marks, feedback: `Couldn’t mark this part: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, missed: '' }
      }
    }
  }
  return out
}

/** The paper, sat: typed answers and photos of handwritten working (⌘V or Add photo) for each part */
export function ExamSitting({ paper, answers, onChange, onHandIn }: { paper: ExamPaper; answers: ExamAnswers; onChange(a: ExamAnswers): void; onHandIn(): void }) {
  const file = useRef<HTMLInputElement>(null)
  const target = useRef('')
  const latest = useRef(answers)
  latest.current = answers
  const set = (k: string, patch: Partial<{ text: string; images: string[] }>) => onChange({ ...latest.current, [k]: { ...{ text: '', images: [] as string[] }, ...latest.current[k], ...patch } })
  const add = async (k: string, files: File[]) => {
    const urls = (await Promise.all(files.filter((f) => f.type.startsWith('image/') || isHeic(f)).map((f) => shrink(f).catch(() => '')))).filter(Boolean)
    if (urls.length) set(k, { images: [...(latest.current[k]?.images ?? []), ...urls] })
  }
  const total = paper.questions.reduce((n, q) => n + q.parts.reduce((m, p) => m + p.marks, 0), 0)
  return (
    <div className="doc-scroll">
      <div className="exam-paper mk-paper">
        <header className="exam-head">
          <h1>{paper.title}</h1>
          <p className="exam-meta">
            {total} marks, {paper.minutes} minutes
          </p>
          <p className="exam-instructions">{paper.instructions} Type, or paste a photo of your handwritten working (⌘V) into any answer.</p>
        </header>
        {paper.questions.map((q) => (
          <section key={q.number} className="exam-q">
            <h2>
              <span>Question {q.number}</span>
              <span className="exam-marks">[{q.parts.reduce((n, p) => n + p.marks, 0)} marks]</span>
            </h2>
            {q.text && <div className="prose" dangerouslySetInnerHTML={md(q.text)} />}
            {q.parts.map((p, i) => {
              const k = key(q.number, i)
              const a = answers[k]
              return (
                <div key={k} className="exam-part">
                  <div className="exam-part-q">
                    <span className="exam-label">({p.label})</span>
                    <div className="prose" dangerouslySetInnerHTML={md(p.text)} />
                    <span className="exam-marks">[{p.marks}]</span>
                  </div>
                  <div
                    className="exam-answer"
                    onPaste={(e) => {
                      const files = [...e.clipboardData.files]
                      if (files.some((f) => f.type.startsWith('image/') || isHeic(f))) {
                        e.preventDefault()
                        void add(k, files)
                      }
                    }}
                  >
                    <textarea value={a?.text ?? ''} onChange={(e) => set(k, { text: e.target.value })} rows={4} placeholder="Your answer, with working" />
                    <div className="exam-photos">
                      {(a?.images ?? []).map((src, j) => (
                        <div key={j} className="exam-photo">
                          <img src={src} alt={`Photo ${j + 1} of your working`} />
                          <button className="icon-btn small" title="Remove photo" onClick={() => set(k, { images: a!.images.filter((_, x) => x !== j) })}>
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="exam-add-photo"
                        onClick={() => {
                          target.current = k
                          file.current?.click()
                        }}
                      >
                        <Icon name="image" size={14} />
                        Add photo
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
        <div className="row-gap end exam-actions">
          <button className="btn primary" onClick={onHandIn}>
            Hand in for marking
          </button>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void add(target.current, [...e.target.files])
          e.target.value = ''
        }}
      />
    </div>
  )
}
