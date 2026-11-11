/* Pathways prototype: the page around the two views. State, filters, search, the side panel, keys.
 * Query parameters: form=2d|3d, theme=light|dark, n=320|2000, focus=<concept id> (selects it and
 * turns on Focus chain), select=<concept id>, status=solid|fading|learning|ready|new, fps=1,
 * bench=1 (measures, writes JSON to #bench). */
(function () {
  'use strict'
  const $ = (s) => document.querySelector(s)
  const q = new URLSearchParams(location.search)
  const root = document.documentElement
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const store = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} } }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
  const fmt = (n) => n.toLocaleString('en-GB')

  const S = {
    n: Number(q.get('n')) === 2000 ? 2000 : 320,
    form: q.get('form') === '3d' ? '3d' : '2d',
    data: null,
    sel: null,
    hover: null,
    focus: false,
    areasOff: new Set(),
    status: q.get('status') || 'all',
    emph: null, // concepts lit by focus mode
    view: null,
    views: {},
    busy: false,
  }

  // ---------- Palette, read from the design's tokens ----------
  function palette() {
    const cs = getComputedStyle(root)
    const v = (k) => cs.getPropertyValue(k).trim()
    const p = { dark: root.dataset.theme === 'dark' }
    for (const k of ['paper', 'sunk', 'raised', 'line', 'line-2', 'ink', 'ink-2', 'ink-3', 'accent', 'accent-soft', 'warn', 'warn-mark', 'good-mark', 'grid']) p[k] = v('--' + k)
    p.area = {}
    for (const a of S.data.areas) p.area[a.id] = v(a.token)
    return p
  }
  S.palette = null

  // ---------- Data ----------
  function load(n) {
    const t0 = performance.now()
    const data = Pathways.build(n === 2000 ? 2000 : 0)
    PathwaysLayout.layout2d(data)
    data.built = performance.now() - t0
    S.data = data
    S.sel = null; S.hover = null; S.emph = null
    S.palette = palette()
    summary()
    areaButtons()
    statusButtons()
    side()
  }

  // ---------- Visibility: filters and focus ----------
  const statusOf = (c) => (c.ready ? 'ready' : c.status)
  function passes(c) {
    if (S.areasOff.has(c.area)) return false
    if (S.status === 'all') return true
    if (S.status === 'ready') return c.ready
    return c.status === S.status
  }
  function dim(c) { return !passes(c) || (S.emph !== null && !S.emph.has(c)) }
  S.passes = passes
  S.dim = dim

  function relight() {
    if (S.focus && S.sel) {
      const { up, down } = Pathways.chain(S.sel)
      S.emph = new Set([S.sel, ...up, ...down])
      S.up = up; S.down = down
    } else { S.emph = null; S.up = null; S.down = null }
    S.view && S.view.restyle()
  }

  // ---------- Header ----------
  function summary() {
    const d = S.data, c = d.counts
    const base = d.concepts.filter((x) => !x.parent).length
    const parts = d.concepts.length > base ? `, with their parts, <b>${fmt(c.all)}</b> in all` : ''
    $('#summary').innerHTML = `<b>${fmt(base)}</b> concepts across six areas${parts}. You hold <b>${fmt(c.solid)}</b> well, <b>${fmt(c.fading)}</b> are fading, and <b>${fmt(c.ready)}</b> are ready to start: everything they rest on is solid. <b>${fmt(c.cross)}</b> pathways cross from one subject to another.`
  }
  function areaButtons() {
    const el = $('#areas')
    el.innerHTML = S.data.areas.map((a, i) => `<button class="c${a.token.slice(3)}" data-area="${a.id}" aria-pressed="${!S.areasOff.has(a.id)}" title="Show or hide ${esc(a.name)}. Alt-click to show only this.">${esc(a.name)}</button>`).join('')
  }
  $('#areas').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return
    const id = b.dataset.area
    if (e.altKey) {
      const only = S.areasOff.size === S.data.areas.length - 1 && !S.areasOff.has(id)
      S.areasOff = new Set(only ? [] : S.data.areas.map((a) => a.id).filter((x) => x !== id))
    } else if (S.areasOff.has(id)) S.areasOff.delete(id)
    else S.areasOff.add(id)
    areaButtons()
    S.view && S.view.restyle()
  })
  const STATUSES = [['all', 'All'], ['solid', 'Solid'], ['fading', 'Fading'], ['ready', 'Ready'], ['learning', 'Learning'], ['new', 'Not started']]
  function statusButtons() {
    const c = S.data.counts
    const count = { all: c.all, solid: c.solid, fading: c.fading, ready: c.ready, learning: c.learning, new: c.new }
    $('#statusSeg').innerHTML = STATUSES.map(([k, l]) => `<button data-status="${k}" aria-pressed="${S.status === k}">${l}${k === 'all' ? '' : ` <span class="c">${fmt(count[k])}</span>`}</button>`).join('')
  }
  $('#statusSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return
    S.status = b.dataset.status
    statusButtons()
    S.view && S.view.restyle()
  })
  $('#focusBtn').addEventListener('click', () => setFocus(!S.focus))
  function setFocus(on) {
    S.focus = on
    $('#focusBtn').setAttribute('aria-pressed', String(on))
    relight()
    side()
    if (on && S.sel && S.view) S.view.flyTo(S.sel, false, true)
  }

  // ---------- Legend and keys ----------
  function legend() {
    const p = S.palette
    const tank = (est, hw, c) => `<svg width="14" height="14" viewBox="-7 -7 14 14"><clipPath id="lc${est}"><circle r="6"/></clipPath><circle r="6" fill="${p.paper}"/><rect x="-7" y="${6 - 12 * est}" width="14" height="14" fill="${c}" opacity="${hw > est + 0.05 ? 0.5 : 0.9}" clip-path="url(#lc${est})"/>${hw ? `<line x1="-6" x2="6" y1="${6 - 12 * hw}" y2="${6 - 12 * hw}" stroke="${p.ink}" stroke-width="1.3" clip-path="url(#lc${est})"/>` : ''}<circle r="6" fill="none" stroke="${c}" stroke-width="1.2"/></svg>`
    const a = p.area.cs
    $('#legend').innerHTML = `
      <div>${tank(0.78, 0.86, a)}<span>Held now, and the highest it stood</span></div>
      <div><svg width="14" height="14" viewBox="-7 -7 14 14">${''}<clipPath id="lcf"><circle r="6"/></clipPath><circle r="6" fill="${p.paper}"/><rect x="-7" y="1" width="14" height="14" fill="${a}" opacity=".5" clip-path="url(#lcf)"/><line x1="-6" x2="6" y1="-3.6" y2="-3.6" stroke="${p.ink}" stroke-width="1.3" clip-path="url(#lcf)"/><circle r="6" fill="none" stroke="${a}" stroke-width="1.2"/><path d="M6 -8.2l2.4 2.4L6 -3.4l-2.4-2.4z" fill="${p['warn-mark']}"/></svg><span>Fading</span></div>
      <div><svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="4" fill="${p.paper}" stroke="${p['line-2']}" stroke-width="1.2"/><circle r="6.6" fill="none" stroke="${p.accent}" stroke-width="1.5"/></svg><span>Ready next</span></div>
      <div><svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="4.5" fill="none" stroke="${p['line-2']}" stroke-width="1.2"/></svg><span>Not started</span></div>
      <div><svg width="14" height="14" viewBox="0 -7 14 14"><path d="M0 -3.5C5 -3.5 9 -3.5 14 -3.5" stroke="${a}" stroke-width="3" opacity=".6"/><path d="M0 3.5h14" stroke="${p['line-2']}" stroke-width="1"/></svg><span>Pathway, thicker when travelled more</span></div>
      <div><svg width="14" height="14" viewBox="-7 -7 14 14"><circle cx="-3" r="2" fill="${p['ink-3']}"/><circle cx="3" r="3.6" fill="${p['ink-3']}"/></svg><span>Size: how much rests on it</span></div>`
  }
  function keys() {
    const k = S.form === '2d'
      ? [['←→↑↓', 'move'], ['F', 'focus chain'], ['/', 'find'], ['0', 'everything']]
      : [['←→↑↓', 'move'], ['F', 'focus chain'], ['/', 'find'], ['Drag', 'turn'], ['Shift', 'pan']]
    S.keysHtml = `<div class="pw-keys">${k.map(([a, b]) => `<span><kbd>${a}</kbd>${b}</span>`).join('')}</div>`
    if (!S.sel) side()
  }

  // ---------- Side panel ----------
  const days = (t) => (S.data.now - t) / Pathways.DAY
  function ago(t) {
    if (t == null) return 'Never'
    const d = days(t)
    if (d < 1) return 'Today'
    if (d < 2) return 'Yesterday'
    if (d < 14) return `${Math.round(d)} days ago`
    if (d < 60) return `${Math.round(d / 7)} weeks ago`
    return `${Math.round(d / 30)} months ago`
  }
  const areaOf = (c) => S.data.areas.find((a) => a.id === c.area)
  const ac = (c) => `--ac: var(${areaOf(c).token})`
  const tank = (c, big) => `<span class="level" style="${ac(c)};--v:${Math.round(c.estimate * 100)};--hw:${Math.round(c.level * 100)}" aria-hidden="true"></span>`
  const stWord = { solid: 'Solid', fading: 'Fading', learning: 'Learning', ready: 'Ready next', new: 'Not started' }
  const st = (c) => `<span class="st ${statusOf(c)}">${stWord[statusOf(c)]}</span>`
  function why(c) {
    if (c.status === 'fading') return `Down to ${Math.round(c.estimate * 100)}% from ${Math.round(c.level * 100)}%`
    if (c.status === 'solid') return c.fadesIn != null && c.fadesIn < 30 ? `Holds for about ${Math.max(1, Math.round(c.fadesIn))} more days` : `Last seen ${ago(c.lastSeen).toLowerCase()}`
    if (c.ready) return c.seen ? `Begun ${ago(c.firstSeen).toLowerCase()}, held at ${Math.round(c.estimate * 100)}%` : c.prereq.length ? `Builds on ${c.prereq.map((p) => p.name).slice(0, 2).join(' and ')}` : 'A fundamental'
    if (c.status === 'learning') return 'Begun, not yet solid'
    const missing = c.prereq.filter((p) => p.status !== 'solid')
    return missing.length ? `Waits on ${missing[0].name}${missing.length > 1 ? ` and ${missing.length - 1} more` : ''}` : 'Not started'
  }
  const row = (c, btn) => `<li data-id="${esc(c.id)}" role="button" tabindex="0">${tank(c)}<span class="t"><b>${esc(c.name)}</b><span class="d">${esc(why(c))}</span></span>${btn ? `<button class="btn sm">${btn}</button>` : st(c)}</li>`

  function side() {
    const el = $('#side')
    const d = S.data
    if (!S.sel) {
      const ready = d.readyNext.filter(passes).slice(0, 6)
      const fading = d.fading.filter(passes).slice(0, 6)
      const soon = d.dueSoon.filter(passes).filter((c) => c.fadesIn < 14).slice(0, 4)
      el.innerHTML = `
        <section>
          <h2>Ready next<span class="meta">${fmt(d.readyNext.length)} in all</span></h2>
          <p class="lede">Everything these rest on is solid. Begun ones first.</p>
          <ul class="pw-list">${ready.map((c) => row(c, 'Study')).join('') || '<li class="more">None in this filter.</li>'}</ul>
        </section>
        <section>
          <h2>Fading most<span class="meta">${fmt(d.fading.length)} in all</span></h2>
          <p class="lede">Once solid, now below the line. What most rests on comes first.</p>
          <ul class="pw-list">${fading.map((c) => row(c, 'Check')).join('') || '<li class="more">None in this filter.</li>'}</ul>
        </section>
        ${soon.length ? `<section>
          <h2>Due within a fortnight</h2>
          <p class="lede">Still solid, but will fall below the line if left.</p>
          <ul class="pw-list">${soon.map((c) => row(c, 'Check')).join('')}</ul>
        </section>` : ''}
        <section><p class="meta">Pick a concept on the map, or move with the arrow keys, to see what it rests on and what it unlocks.</p>${S.keysHtml || ''}</section>`
      return
    }
    const c = S.sel
    const a = areaOf(c)
    const pct = (x) => Math.round(x * 100) + '%'
    let hold
    if (!c.seen) hold = c.ready ? `Not started. Everything it rests on is solid, so it is <b>ready</b>.` : `Not started. ${esc(why(c))}.`
    else if (c.status === 'fading') hold = `Held at <b>${pct(c.estimate)}</b> now, down from <b>${pct(c.level)}</b>. It fell below the line ${Math.max(1, Math.round(-c.fadesIn))} days ago.`
    else if (c.status === 'solid') hold = `Held at <b>${pct(c.estimate)}</b>, highest <b>${pct(c.level)}</b>.${c.fadesIn != null ? ` Stays solid for about <b>${Math.max(1, Math.round(c.fadesIn))}</b> more days if left.` : ''}`
    else hold = `Held at <b>${pct(c.estimate)}</b>. Begun, not yet solid: it counts as solid at 60%.`
    const up = c.prereq, down = c.next
    const chainNote = S.focus && S.up ? `<p class="lede">Lit on the map: ${fmt(S.up.size)} concepts back to fundamentals, ${fmt(S.down.size)} it leads to.</p>` : ''
    el.innerHTML = `
      <section class="pw-node">
        <div class="pw-node-top"><span class="area c${a.token.slice(3)}">${esc(a.name)}</span><button class="pw-back" id="clearSel" title="Esc">Close</button></div>
        <h1>${esc(c.name)}</h1>
        <div class="pw-hold">${tank(c, true)}<p>${hold}</p></div>
        <dl class="pw-facts">
          <dt>Status</dt><dd>${st(c)}</dd>
          <dt>Last seen</dt><dd>${ago(c.lastSeen)}</dd>
          ${c.seen ? `<dt>Answers</dt><dd>${c.right} right, ${c.partly} partly, ${c.wrong} wrong</dd><dt>Half-life</dt><dd>${Math.round(c.halfLife)} days</dd>` : ''}
          <dt>Rests on it</dt><dd>${fmt(c.importance)} concept${c.importance === 1 ? '' : 's'}</dd>
        </dl>
        <div class="pw-acts">
          <button class="btn primary">${c.seen ? 'Study this' : 'Start this'}</button>
          <button class="btn"${c.seen ? '' : ' disabled title="Nothing to check yet"'}>Quick check</button>
        </div>
        <div class="pw-acts" style="margin-top:8px"><button class="btn quiet sm" id="focusChain" aria-pressed="${S.focus}">${S.focus ? 'Stop focusing the chain' : 'Focus its chain on the map'}<kbd>F</kbd></button></div>
        ${chainNote}
      </section>
      <section>
        <h2>Rests on<span class="meta">${up.length || 'Nothing: a fundamental'}</span></h2>
        <ul class="pw-list">${up.map((x) => row(x)).join('')}</ul>
      </section>
      <section>
        <h2>Unlocks<span class="meta">${down.length || 'Nothing yet'}</span></h2>
        <ul class="pw-list">${down.slice(0, 12).map((x) => row(x)).join('')}${down.length > 12 ? `<li class="more">and ${down.length - 12} more</li>` : ''}</ul>
      </section>`
    $('#clearSel').addEventListener('click', () => select(null))
    $('#focusChain').addEventListener('click', () => setFocus(!S.focus))
  }
  $('#side').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return
    select(S.data.byId.get(li.dataset.id), true)
  })
  $('#side').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const li = e.target.closest('li[data-id]'); if (li) select(S.data.byId.get(li.dataset.id), true)
  })

  // ---------- Selection ----------
  function select(c, fly) {
    S.sel = c || null
    relight()
    side()
    if (S.view) { S.view.restyle(); if (c && fly) S.view.flyTo(c) }
  }
  S.select = select
  S.setHover = (c, x, y) => {
    if (S.hover === c) { if (c) tipAt(x, y); return }
    S.hover = c
    const tip = $('#tip')
    if (c) {
      tip.textContent = `${c.name}\n${stWord[statusOf(c)]}${c.seen ? `, held at ${Math.round(c.estimate * 100)}%` : ''}`
      tip.classList.add('on'); tipAt(x, y)
    } else tip.classList.remove('on')
    S.view && S.view.restyle(true)
  }
  function tipAt(x, y) { const t = $('#tip'); t.style.left = x + 14 + 'px'; t.style.top = y + 14 + 'px' }

  // ---------- Search ----------
  let hits = [], hit = 0
  function search() {
    const v = $('#search').value.trim().toLowerCase()
    const ul = $('#results')
    if (!v) { ul.hidden = true; hits = []; return }
    const all = S.data.concepts
    const starts = [], has = []
    for (const c of all) { const n = c.name.toLowerCase(); if (n.startsWith(v)) starts.push(c); else if (n.includes(v)) has.push(c) }
    const by = (a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || b.importance - a.importance
    hits = [...starts.sort(by), ...has.sort(by)].slice(0, 8)
    hit = 0
    ul.innerHTML = hits.length ? hits.map((c, i) => `<li role="option" data-id="${esc(c.id)}" aria-selected="${i === hit}"><span class="area c${areaOf(c).token.slice(3)}"></span><span class="n">${esc(c.name)}</span><span class="s">${stWord[statusOf(c)]}</span></li>`).join('') : '<li class="none">Nothing by that name</li>'
    ul.hidden = false
  }
  function markHit() { [...$('#results').children].forEach((li, i) => li.setAttribute('aria-selected', String(i === hit))) }
  $('#search').addEventListener('input', search)
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hit = Math.min(hits.length - 1, hit + 1); markHit(); e.preventDefault() }
    else if (e.key === 'ArrowUp') { hit = Math.max(0, hit - 1); markHit(); e.preventDefault() }
    else if (e.key === 'Enter' && hits[hit]) { pick(hits[hit]) }
    else if (e.key === 'Escape') { $('#search').value = ''; search(); $('#search').blur(); S.view && S.view.focusCanvas() }
  })
  $('#results').addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-id]'); if (li) { e.preventDefault(); pick(S.data.byId.get(li.dataset.id)) } })
  $('#search').addEventListener('blur', () => setTimeout(() => ($('#results').hidden = true), 100))
  function pick(c) {
    $('#search').value = ''
    search()
    if (!passes(c)) { S.areasOff.delete(c.area); S.status = 'all'; areaButtons(); statusButtons() }
    select(c, true)
    S.view && S.view.focusCanvas()
  }

  // ---------- Keys ----------
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea')
    if (typing || e.metaKey || e.ctrlKey) return
    const v = S.view
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); return }
    if (e.key === 'Escape') {
      if (!$('#about').hidden) { about(false); return }
      if (S.focus) setFocus(false); else select(null)
      return
    }
    if (e.key === 'f' || e.key === 'F') { setFocus(!S.focus); return }
    if (e.key === '2') { setForm('2d'); return }
    if (e.key === '3') { setForm('3d'); return }
    if (!v) return
    if (e.key === '+' || e.key === '=') { v.zoom(1.4); return }
    if (e.key === '-' || e.key === '_') { v.zoom(1 / 1.4); return }
    if (e.key === '0') { v.fit(true); return }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (dir) {
      e.preventDefault()
      const c = v.neighbour(S.sel, dir)
      if (c) { select(c); v.reveal(c) }
    }
    if (e.key === 'Enter' && S.sel) v.flyTo(S.sel)
  })

  // ---------- Theme ----------
  function setTheme(t) {
    root.dataset.theme = t
    store.set('tide-proto-theme', t)
    document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)))
    S.palette = palette()
    legend()
    S.view && S.view.theme()
  }
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)))

  // ---------- About ----------
  function about(on) { $('#about').hidden = !on; $('#aboutBtn').setAttribute('aria-expanded', String(on)) }
  $('#aboutBtn').addEventListener('click', () => about($('#about').hidden))
  $('#aboutClose').addEventListener('click', () => about(false))
  $('#busy').addEventListener('change', (e) => { S.busy = e.target.checked; S.view && S.view.resize() })

  // ---------- Forms ----------
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load ' + src)); document.head.appendChild(s) })
  }
  async function viewFor(form) {
    if (S.views[form]) return S.views[form]
    if (form === '3d' && !window.PathwaysView3D) {
      await loadScript('vendor/three.global.js')
      await loadScript('view3d.js')
    }
    const V = form === '2d' ? window.PathwaysView2D : window.PathwaysView3D
    const v = new V(form === '2d' ? $('#c2d') : $('#c3d'), S, { labels: $('#labels3d') })
    S.views[form] = v
    return v
  }
  async function setForm(form) {
    S.form = form
    document.querySelectorAll('[data-form]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.form === form)))
    const v = await viewFor(form)
    if (S.view && S.view !== v) S.view.hide()
    S.view = v
    $('#c2d').hidden = form !== '2d'
    $('#c3d').hidden = form !== '3d'
    $('#labels3d').hidden = form !== '3d'
    keys()
    v.show()
    if (S.sel) v.flyTo(S.sel, true)
  }
  document.querySelectorAll('[data-form]').forEach((b) => b.addEventListener('click', () => setForm(b.dataset.form)))
  async function setSize(n) {
    S.n = n
    document.querySelectorAll('[data-n]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n)))
    load(n)
    for (const v of Object.values(S.views)) v.setData()
    if (S.view) S.view.show()
  }
  document.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => setSize(Number(b.dataset.n))))
  S.reduced = () => reduced.matches

  // ---------- Frames: count every frame either view draws ----------
  const perf = (S.perf = { frames: 0, last: [], renderMs: [] })
  S.drew = (ms) => {
    perf.frames++
    perf.renderMs.push(ms)
    if (perf.renderMs.length > 240) perf.renderMs.shift()
    const now = performance.now()
    perf.last.push(now)
    while (perf.last.length && now - perf.last[0] > 1000) perf.last.shift()
    if (q.has('fps')) fpsMeter()
  }
  let fpsTimer = 0
  function fpsMeter() {
    const el = $('#fps'); el.hidden = false
    const ms = perf.renderMs.slice(-60)
    el.textContent = `${perf.last.length} frames in the last second\ndraw ${(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)).toFixed(1)} ms\n${fmt(perf.frames)} frames drawn since load`
    clearTimeout(fpsTimer)
    fpsTimer = setTimeout(fpsMeter, 1100) // so it shows 0 when idle
  }

  // Measures one form at one size: frames drawn while idle, then while being moved continuously
  async function measure(form, n, seconds = 3) {
    if (S.n !== n) await setSize(n)
    await setForm(form)
    const v = S.view
    await new Promise((r) => setTimeout(r, 1200))
    const f0 = perf.frames
    const ticks = await new Promise((r) => { let k = 0; const t0 = performance.now(); const tick = (t) => { k++; if (t - t0 < 2000) requestAnimationFrame(tick); else r(k) }; requestAnimationFrame(tick) })
    const idleFrames = perf.frames - f0
    const iv = [], draw = []
    await new Promise((r) => {
      const t0 = performance.now(); let prev = t0
      const step = (t) => {
        iv.push(t - prev); prev = t
        const a = performance.now()
        v.benchStep((t - t0) / 1000)
        v.renderNow()
        draw.push(performance.now() - a)
        if (t - t0 < seconds * 1000) requestAnimationFrame(step); else r()
      }
      requestAnimationFrame(step)
    })
    iv.shift()
    // Throughput with the GPU waited on: frames drawn back to back, each read back, so the time
    // includes the GPU's work and not only the commands sent to it
    const tf = performance.now()
    for (let i = 0; i < 60; i++) { v.benchStep(seconds + i / 30); v.renderNow(); v.sync() }
    const syncedMs = (performance.now() - tf) / 60
    const sorted = iv.slice().sort((a, b) => a - b), ds = draw.slice().sort((a, b) => a - b)
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length
    v.fit(false)
    return {
      form, n: S.data.concepts.length, links: S.data.links.length,
      idle: { framesDrawnIn2s: idleFrames, rafTicksIn2s: ticks },
      moving: { fps: +(1000 / mean).toFixed(1), p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), drawMsMean: +(draw.reduce((a, b) => a + b, 0) / draw.length).toFixed(2), drawMsP95: +ds[Math.floor(ds.length * 0.95)].toFixed(2), frames: iv.length + 1, gpuWaitedMsPerFrame: +syncedMs.toFixed(2) },
    }
  }
  window.pathwaysMeasure = measure

  // ---------- Start ----------
  async function start() {
    document.querySelectorAll('[data-n]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === S.n)))
    load(S.n)
    setTheme(root.dataset.theme)
    await setForm(S.form)
    const id = q.get('focus') || q.get('select')
    if (id) {
      const c = S.data.byId.get(id) || S.data.concepts.find((x) => x.name.toLowerCase() === id.toLowerCase())
      if (c) { S.focus = q.has('focus'); $('#focusBtn').setAttribute('aria-pressed', String(S.focus)); select(c); S.view.flyTo(c, true, q.has('focus')) }
    }
    if (q.get('about')) about(true)
    if (q.has('bench')) {
      const out = []
      for (const form of ['2d', '3d']) for (const n of [320, 2000]) out.push(await measure(form, n))
      const pre = document.createElement('pre'); pre.id = 'bench'; pre.textContent = JSON.stringify(out); pre.hidden = true
      document.body.appendChild(pre)
    }
    document.body.dataset.ready = '1'
  }
  window.PathwaysApp = S
  start().catch((e) => { console.error(e); $('#side').innerHTML = `<section><p>${esc(e.message)}</p></section>` })
})()
