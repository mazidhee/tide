import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { emptyMap, mapKindFor, mapLine, mapReady, type ArgMap, type CompLesson, type MapCompare } from '@shared/comprehension'
import { useApp } from '../../state'
import { Credit } from './Credit'
import { MapCompared, MapEditor, MapRubric, VERDICT_CLASS } from './MapEditor'
import { Passage, type Range } from './Passage'

/**
 * Map the argument (docs/plans/comprehension.md, increment 4): the passage on the left, the map
 * on the right. The learner writes the claim, the reasons and what backs them, what it takes for
 * granted and where it turns (or, for a story, what happens, who, the turn and what it shows);
 * Claude compares it with its own map of the passage, part by part, and each part lights its
 * words in the passage. Without Claude, a short rubric. Optional: it can be skipped.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const NARROW = 860

type Update = (patch: Parameters<typeof window.tide.comprehension.update>[1]) => Promise<CompLesson | null>

export function MapStep({ lesson, update, setLesson }: { lesson: CompLesson; update: Update; setLesson: (l: CompLesson) => void }) {
  const app = useApp()
  const rec = lesson.map
  const [map, setMap] = useState<ArgMap>(() => rec?.mine ?? emptyMap(mapKindFor(lesson)))
  const [editing, setEditing] = useState(!rec?.by)
  const [busy, setBusy] = useState(false)
  const [selfCheck, setSelfCheck] = useState(false)
  const [ticks, setTicks] = useState<Record<string, boolean>>(rec?.ticks ?? {})
  const [lit, setLit] = useState<MapCompare | null>(null)
  const [narrow, setNarrow] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const change = (m: ArgMap) => {
    setMap(m)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void window.tide.comprehension.update(lesson.id, { map: m }).catch(() => {}), 900)
  }

  const compare = async () => {
    clearTimeout(saveTimer.current)
    setBusy(true)
    try {
      const can = await window.tide.comprehension.canGrade()
      const r = can ? await window.tide.comprehension.map(lesson.id, map) : null
      if (r?.by === 'claude') {
        setLesson(r.lesson)
        setEditing(false)
      } else {
        if (r) app.toast('Claude couldn’t compare it just now: check it yourself against the passage.')
        setSelfCheck(true)
      }
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
    setBusy(false)
  }

  const saveSelf = async () => {
    setBusy(true)
    try {
      setLesson(await window.tide.comprehension.mapSelf(lesson.id, map, ticks))
      setSelfCheck(false)
      setEditing(false)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
    setBusy(false)
  }

  const goOn = () =>
    void update({
      step: lesson.marks.length ? 'words' : 'done',
      ...(editing && !rec?.by ? { map } : {})
    })

  const compared = !editing && rec?.by === 'claude'
  const ranges = useMemo<Range[]>(
    () =>
      compared
        ? (rec?.compare ?? []).flatMap((c) =>
            c.anchor
              ? [
                  {
                    id: c.field,
                    start: c.anchor.start,
                    end: c.anchor.end,
                    cls: `cp-pt ${VERDICT_CLASS[c.verdict]}`
                  }
                ]
              : []
          )
        : [],
    [compared, rec]
  )
  const litSet = useMemo(() => new Set(lit ? [lit.field] : []), [lit])

  return (
    <div className={`cp-body cp-mapstep${narrow ? ' narrow' : ''}`} ref={wrap}>
      <div className="cp-col mp-passage-col">
        <Passage text={lesson.passage} ranges={ranges} lit={litSet} onRangeClick={(ids) => setLit(rec?.compare?.find((c) => ids.includes(c.field)) ?? null)} />
        {lesson.source.web && <Credit web={lesson.source.web} />}
      </div>
      <div className="cp-col mp-col">
        {editing ? (
          <>
            <p className="cp-ask">How does it work? Map it.</p>
            <p className="mp-lede">The passage is here to look at. Put each part in your own words.</p>
            <MapEditor map={map} onChange={change} disabled={busy || selfCheck} autoFocus />
            {selfCheck && <MapRubric kind={map.kind} ticks={ticks} setTicks={setTicks} />}
            <div className="cp-after">
              <span className="cp-after-note">{busy ? 'Comparing your map with the passage…' : !mapReady(map) ? 'Write the first part and one more to compare' : ''}</span>
              {!selfCheck && (
                <button className="btn ghost" disabled={busy} onClick={goOn}>
                  Skip the map
                </button>
              )}
              {selfCheck ? (
                <button className="btn primary" disabled={busy} onClick={() => void saveSelf()}>
                  Done checking
                </button>
              ) : (
                <button className="btn primary" disabled={busy || !mapReady(map)} onClick={() => void compare()}>
                  {busy ? 'Comparing…' : 'Compare with the passage'}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="cp-result">
              <p className="cp-result-line">{mapLine(rec)}</p>
              {rec?.overall && <p className="cp-result-overall">{rec.overall}</p>}
            </div>
            {rec?.by === 'claude' ? <MapCompared record={rec} on={lit?.field ?? null} onLight={setLit} /> : rec && <MapEditor map={rec.mine} onChange={() => {}} disabled />}
            <div className="cp-after">
              <button className="btn ghost" onClick={() => setEditing(true)}>
                Change my map
              </button>
              <button className="btn primary" onClick={goOn}>
                {lesson.marks.length ? 'Next: your hard words' : 'Finish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
