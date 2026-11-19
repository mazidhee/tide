import { useState } from 'react'
import { roundTests, type MockLoaded } from '@shared/interviewMock'
import { PillSegment } from '../PromptBox'
import { Icon } from '../Icon'
import { LevelMeter, useMicCheck, type MicMode } from './LiveMockAudio'

export interface BriefChoice {
  micMode: MicMode
  scripted: boolean
  slides: { name: string; pages: string[]; image?: string } | null
}

/**
 * Before the call: the round, its length and what it tests, a mic check with a live level, how
 * to answer (open mic or push-to-talk), and for a presentation the learner's own slide file.
 */
export function LiveMockBrief({ loaded, onStart }: { loaded: MockLoaded; onStart(c: BriefChoice): void }) {
  const { input } = loaded
  const [micMode, setMicMode] = useState<MicMode>(() => (localStorage.getItem('tide.liveMock.mic') as MicMode) || 'open')
  const [checking, setChecking] = useState(true)
  const { level, error } = useMicCheck(checking && loaded.voice)
  const [slidePath, setSlidePath] = useState('')
  const [slides, setSlides] = useState<BriefChoice['slides']>(null)
  const [slideError, setSlideError] = useState<string | null>(null)
  const presentation = input.round.kind === 'presentation'
  const heard = level > 0.06

  const loadSlides = async () => {
    setSlideError(null)
    const r = await window.tide.interviewMock.slides(slidePath)
    if ('error' in r) return setSlideError(r.error)
    setSlides(r)
  }

  return (
    <div className="lm-brief">
      <p className="lm-eyebrow">
        Live mock · {input.company || 'Interview'}
        {input.role ? ` · ${input.role}` : ''}
      </p>
      <h1 className="page-title lm-brief-title">{input.round.name}</h1>
      <dl className="lm-facts">
        <div>
          <dt>Length</dt>
          <dd>{input.round.minutes} minutes</dd>
        </div>
        <div>
          <dt>Interviewer</dt>
          <dd>{loaded.claude ? 'New each time, played by Claude' : 'Scripted from your question bank'}</dd>
        </div>
        <div>
          <dt>Marked</dt>
          <dd>{loaded.claude ? 'By Claude (Opus) at the end' : 'In code: length, structure, coverage'}</dd>
        </div>
      </dl>

      <section className="lm-brief-block">
        <h2 className="lm-h2">What it tests</h2>
        {roundTests(input.round.kind).map((t) => (
          <p key={t}>{t}</p>
        ))}
        {input.round.notes && <p className="lm-muted lm-notes">{input.round.notes}</p>}
      </section>

      <section className="lm-brief-block">
        <h2 className="lm-h2">Your microphone</h2>
        {loaded.voice ? (
          <>
            <div className="lm-miccheck">
              <LevelMeter level={checking ? level : 0} />
              <span className={heard ? 'lm-ok' : 'lm-muted'}>{error ? 'No microphone' : heard ? 'Tide can hear you' : 'Say something to check the level'}</span>
              <button className="link-btn small" onClick={() => setChecking((c) => !c)}>
                {checking ? 'Stop check' : 'Check again'}
              </button>
            </div>
            {error && <p className="lm-warn">{error}</p>}
            <div className="lm-row">
              <PillSegment
                label="How you answer"
                value={micMode}
                onChange={(v) => (setMicMode(v), localStorage.setItem('tide.liveMock.mic', v))}
                options={[
                  { value: 'open', label: 'Open mic' },
                  { value: 'ptt', label: 'Push to talk' }
                ]}
              />
              <span className="lm-muted">{micMode === 'open' ? 'Your turn ends after about 2.5 seconds of silence, or press Done.' : 'Hold Space while you talk; let go to finish.'}</span>
            </div>
          </>
        ) : (
          <p className="lm-muted">Tide’s natural voice isn’t set up, so the interviewer uses the Mac’s voice and you type your answers. Set it up in Settings › Voice to answer out loud.</p>
        )}
        <p className="lm-muted">Use headphones if you can, so the mic doesn’t hear the interviewer. You can switch to typing at any point in the call.</p>
      </section>

      {presentation && (
        <section className="lm-brief-block">
          <h2 className="lm-h2">Your slides (optional)</h2>
          <p className="lm-muted">Paste the path to your own slide file (PDF, PowerPoint, image or Markdown). Tide only shows it, read-only, while you present.</p>
          <div className="lm-row">
            <input className="lm-input" placeholder="/path/to/slides.pdf" value={slidePath} onChange={(e) => setSlidePath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && slidePath.trim() && void loadSlides()} />
            <button className="btn small" onClick={() => void loadSlides()} disabled={!slidePath.trim()}>
              Show
            </button>
          </div>
          {slides && (
            <p className="lm-ok">
              <Icon name="check" size={13} /> {slides.name}
              {slides.pages.length ? `, ${slides.pages.length} slides` : ''}
            </p>
          )}
          {slideError && <p className="lm-warn">{slideError}</p>}
          {input.presentation?.topic && <p className="lm-muted">Topic: {input.presentation.topic}</p>}
        </section>
      )}

      <div className="lm-start">
        <button className="btn primary large" onClick={() => (setChecking(false), onStart({ micMode, scripted: !loaded.claude, slides }))}>
          <Icon name="play" size={15} />
          Start the call
        </button>
        <span className="lm-muted">The clock starts when the interviewer speaks. There are no hints.</span>
      </div>
    </div>
  )
}
