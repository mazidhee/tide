import { MAP_FIELDS, MAP_RUBRIC, MAP_VERDICT, type ArgMap, type MapCompare, type MapKind, type MapRecord } from '@shared/comprehension'

/**
 * The map of how a passage works (docs/plans/comprehension.md, increment 4), as one calm
 * structure: a spine down the left, each part a line of writing on it. For an argument: the
 * claim, its reasons (each with what backs it), what it takes for granted, where it turns; for a
 * story: what happens, who, the turn, what it shows. Used by the lesson's map step and, smaller,
 * by the check in the book (`inBook`).
 */

const KINDS: { kind: MapKind; label: string }[] = [
  { kind: 'argued', label: 'It argues or explains' },
  { kind: 'narrative', label: 'It tells a story' }
]

/** A verdict drawn as the review's rules draw a point: matches as caught, missing dashed, off dotted */
export const VERDICT_CLASS: Record<MapCompare['verdict'], string> = {
  matches: 'v-caught',
  partly: 'v-partly',
  missing: 'v-missed',
  off: 'v-wrong'
}

export function MapEditor(p: { map: ArgMap; onChange: (m: ArgMap) => void; disabled?: boolean; inBook?: boolean; autoFocus?: boolean }) {
  const m = p.map
  const setField = (id: string, v: string) => p.onChange({ ...m, fields: { ...m.fields, [id]: v } })
  const setReason = (i: number, patch: Partial<ArgMap['reasons'][number]>) =>
    p.onChange({
      ...m,
      reasons: m.reasons.map((r, k) => (k === i ? { ...r, ...patch } : r))
    })
  const setKind = (kind: MapKind) =>
    kind !== m.kind &&
    p.onChange({
      kind,
      fields: {},
      reasons: kind === 'argued' ? [{ reason: '', backing: '' }] : []
    })
  return (
    <div className={`mp-editor${p.inBook ? ' in-book' : ''}`}>
      <div className="mp-kind" role="radiogroup" aria-label="What kind of passage">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={m.kind === k.kind} disabled={p.disabled} onClick={() => setKind(k.kind)}>
            {k.label}
          </button>
        ))}
      </div>
      <ol className="mp-spine">
        {MAP_FIELDS[m.kind].map((f, fi) =>
          f.list ? (
            <li key={f.id} className="mp-part list">
              <span className="mp-label">{f.label}</span>
              <ol className="mp-reasons">
                {m.reasons.map((r, i) => (
                  <li key={i} className="mp-reason">
                    <span className="mp-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="mp-reason-body">
                      <textarea
                        className="mp-write"
                        rows={1}
                        value={r.reason}
                        disabled={p.disabled}
                        placeholder={f.ask}
                        aria-label={`Reason ${i + 1}`}
                        onChange={(e) => setReason(i, { reason: e.target.value })}
                      />
                      <div className="mp-backing">
                        <span className="mp-backing-label">backed by</span>
                        <textarea
                          className="mp-write small"
                          rows={1}
                          value={r.backing}
                          disabled={p.disabled}
                          placeholder="what in the passage supports it"
                          aria-label={`What backs reason ${i + 1}`}
                          onChange={(e) => setReason(i, { backing: e.target.value })}
                        />
                      </div>
                    </div>
                    {m.reasons.length > 1 && !p.disabled && (
                      <button
                        type="button"
                        className="mp-remove"
                        aria-label={`Remove reason ${i + 1}`}
                        title="Remove this reason"
                        onClick={() =>
                          p.onChange({
                            ...m,
                            reasons: m.reasons.filter((_, k) => k !== i)
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {!p.disabled && m.reasons.length < (p.inBook ? 3 : 6) && (
                <button
                  type="button"
                  className="mp-add"
                  onClick={() =>
                    p.onChange({
                      ...m,
                      reasons: [...m.reasons, { reason: '', backing: '' }]
                    })
                  }
                >
                  + Another reason
                </button>
              )}
            </li>
          ) : (
            <li key={f.id} className={`mp-part${fi === 0 ? ' main' : ''}`}>
              <label className="mp-label" htmlFor={`mp-${f.id}${p.inBook ? '-b' : ''}`}>
                {f.label}
              </label>
              <textarea
                id={`mp-${f.id}${p.inBook ? '-b' : ''}`}
                className={`mp-write${fi === 0 ? ' main' : ''}`}
                rows={1}
                value={m.fields[f.id] ?? ''}
                disabled={p.disabled}
                placeholder={f.ask}
                autoFocus={p.autoFocus && fi === 0}
                onChange={(e) => setField(f.id, e.target.value)}
              />
            </li>
          )
        )}
      </ol>
    </div>
  )
}

/**
 * The two maps side by side, part by part: what the learner wrote and the passage's own map, the
 * verdict and a line on it. A part tied to the passage's words lights them (`onLight`).
 */
export function MapCompared(p: { record: MapRecord; on?: string | null; onLight?: (c: MapCompare | null) => void; inBook?: boolean }) {
  const r = p.record
  const mine = r.mine
  const yours = (id: string) => (id === 'reasons' ? mine.reasons.map((x) => x.reason + (x.backing ? ` (${x.backing})` : '')).filter(Boolean) : [mine.fields[id] ?? ''].filter((x) => x.trim()))
  const theirs = (id: string) => (id === 'reasons' ? (r.reference?.reasons ?? []).map((x) => x.reason + (x.backing ? ` (${x.backing})` : '')) : [r.reference?.fields[id]?.text ?? ''].filter(Boolean))
  return (
    <div className={`mp-compared${p.inBook ? ' in-book' : ''}`}>
      <div className="mp-cmp-head" aria-hidden="true">
        <span />
        <span>Yours</span>
        <span>The passage’s</span>
      </div>
      {MAP_FIELDS[mine.kind].map((f) => {
        const c = r.compare?.find((x) => x.field === f.id)
        const a = yours(f.id)
        const b = theirs(f.id)
        return (
          <div
            key={f.id}
            className={`mp-cmp-row${p.on === f.id ? ' on' : ''}${c?.anchor ? ' lights' : ''}`}
            onMouseEnter={() => c?.anchor && p.onLight?.(c)}
            onMouseLeave={() => p.onLight?.(null)}
            onClick={() => c?.anchor && p.onLight?.(c)}
            title={c?.anchor ? 'Show its words in the passage' : undefined}
          >
            <div className="mp-cmp-label">
              <span className={`mp-rule ${c ? VERDICT_CLASS[c.verdict] : ''}`} aria-hidden="true" />
              <span>
                <b>{f.label}</b>
                {c && <span className="mp-verdict">{MAP_VERDICT[c.verdict]}</span>}
              </span>
            </div>
            <div className="mp-cmp-yours">{a.length ? a.map((x, i) => <p key={i}>{x}</p>) : <p className="mp-blank">Left blank</p>}</div>
            <div className="mp-cmp-theirs">{b.length ? b.map((x, i) => <p key={i}>{x}</p>) : <p className="mp-blank">{f.id === 'turn' ? 'It doesn’t turn' : '—'}</p>}</div>
            {c?.note && <p className="mp-cmp-note">{c.note}</p>}
          </div>
        )
      })}
    </div>
  )
}

/** Without Claude: the rubric for the map, ticked by the learner */
export function MapRubric(p: { kind: MapKind; ticks: Record<string, boolean>; setTicks: (t: Record<string, boolean>) => void; done?: boolean; inBook?: boolean }) {
  return (
    <fieldset className={`mp-rubric${p.inBook ? ' in-book' : ''}`} disabled={p.done}>
      <legend>Look at the passage again. Is it true of your map?</legend>
      {MAP_RUBRIC[p.kind].map((r) => (
        <label key={r.id} className="mp-tick">
          <input type="checkbox" checked={!!p.ticks[r.id]} onChange={(e) => p.setTicks({ ...p.ticks, [r.id]: e.target.checked })} />
          <span>{r.text}</span>
        </label>
      ))}
    </fieldset>
  )
}
