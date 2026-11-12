/**
 * A section of a video offered in a lesson: "Watch 4:10–9:30 first", a recap after it, or a moment
 * the tutor points at with a <clip> tag. Its times are checked against the video's real transcript
 * (main/videos checkClipTimes) before it's shown; times that don't hold are never played.
 */
import { useEffect, useState } from 'react'
import { formatRange, type Clip } from '@shared/video'
import { VideoPlayer } from './VideoPlayer'

type Checked = { ok: true; clip: Clip; title?: string; channel?: string; course?: string } | { ok: false; why: string }

export function ClipCard({ clip, kicker, why, onDone }: { clip: Clip; kicker?: string; why?: string; onDone?: () => void }) {
  const [checked, setChecked] = useState<Checked | null>(null)
  useEffect(() => {
    let live = true
    window.tide.videos
      .check(clip)
      .then((r) => live && setChecked(r.ok ? { ok: true, clip: r.clip, title: r.title, channel: r.channel, course: r.course } : { ok: false, why: r.why }))
      .catch(() => live && setChecked({ ok: false, why: 'It couldn’t be checked.' }))
    return () => {
      live = false
    }
  }, [clip.video, clip.start, clip.end]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!checked) return <div className="vclip vclip-loading" aria-busy="true" />
  if (!checked.ok) return <p className="vclip-quiet">A video clip was suggested here, but its times don’t match the video’s transcript, so it isn’t shown. {checked.why}</p>
  const c = checked.clip
  return (
    <section className="vclip" aria-label={`${kicker ?? 'Watch'} ${formatRange(c.start, c.end)}`}>
      <header className="vclip-head">
        <span className="vclip-kicker">
          {kicker ?? 'Watch'} {formatRange(c.start, c.end)}
          {checked.course && <span className="vclip-course"> · {checked.course}</span>}
        </span>
        {checked.title && (
          <span className="vclip-title">
            {checked.title}
            {checked.channel && <span className="vclip-by"> · {checked.channel}</span>}
          </span>
        )}
      </header>
      {(why ?? clip.why) && !/^(watch first|recap)$/i.test(why ?? clip.why ?? '') && <p className="vclip-why">{why ?? clip.why}</p>}
      <VideoPlayer source={{ kind: 'youtube', id: c.video }} clip={{ start: c.start, end: c.end }} compact onClipEnd={onDone} />
    </section>
  )
}
