import type { WorkingMarks } from '@shared/mathsAnswer'
import { MathText, Tex } from './Calculator'
import { PaperView } from './PaperView'
import '../../styles/mathsAnswer.css'

const VERDICT_WORD = { correct: 'Correct.', partial: 'Nearly.', wrong: 'Not yet.' } as const

/** A marked working in the lesson's transcript: your page with its lines boxed, or your typed steps, each with its mark */
export function WorkingCard({ working }: { working: WorkingMarks }) {
  const { marks } = working
  if (working.kind === 'paper') return <div className="wcard paper"><PaperView pages={working.pages} lines={working.lines} marks={marks} compact /></div>
  return (
    <div className="wcard steps">
      <ol className="wc-lines">
        {working.lines.map((l, i) => {
          const m = marks.lines[i]
          const st = m?.ok === true ? 'ok' : m?.ok === false ? 'bad' : 'none'
          return (
            <li key={i} className={`wc-line ${st}`}>
              <span className="wc-mark" aria-label={st === 'ok' ? 'Right' : st === 'bad' ? 'Wrong' : 'Not marked'}>
                {st === 'ok' ? '✓' : st === 'bad' ? '✗' : i + 1}
              </span>
              <div>
                <Tex latex={l.latex} className="wc-tex" />
                {m?.note && <p className="wc-note"><MathText text={m.note} /></p>}
              </div>
            </li>
          )
        })}
      </ol>
      {(marks.verdict || marks.summary) && (
        <p className={`wc-verdict ${marks.verdict ?? 'open'}`}>
          {marks.verdict && <b>{VERDICT_WORD[marks.verdict]}</b>} <MathText text={marks.summary} />
        </p>
      )}
    </div>
  )
}
