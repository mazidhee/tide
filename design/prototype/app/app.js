/* Tide redesign prototype: shared shell, icons, theme. No dependencies. */
(function () {
  const q = new URLSearchParams(location.search)
  const store = { get: (k) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } }
  const root = document.documentElement
  const setTheme = (t) => { root.dataset.theme = t; store.set('tide-proto-theme', t); document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t))) }
  const setRead = (r) => { root.dataset.read = r; store.set('tide-proto-read', r) }
  root.dataset.theme = q.get('theme') || store.get('tide-proto-theme') || 'light'
  root.dataset.read = q.get('read') || store.get('tide-proto-read') || 'serif'

  /* One icon set: 20 px grid, 1.5 px round strokes, no fills. */
  const I = {
    home: 'M3.5 9 10 3.5 16.5 9v6.5a1 1 0 0 1-1 1h-3.25v-4.5h-4.5v4.5H4.5a1 1 0 0 1-1-1z',
    learn: 'M10 5.5C8.6 4.4 6.7 4 3.5 4v11c3.2 0 5.1.4 6.5 1.5 1.4-1.1 3.3-1.5 6.5-1.5V4c-3.2 0-5.1.4-6.5 1.5zM10 5.5v11',
    note: 'M5.5 3h6l3.5 3.5V16a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11.5 3v3.5H15M7.5 10.5h5M7.5 13.5h3.5',
    library: 'M3.5 3.5H6v13H3.5zM8 3.5h2.5v13H8zM12.6 4.7l2.3-.7 3 11.6-2.3.7z',
    know: 'M3.5 4h3v12h-3zM8.5 4h3v12h-3zM13.5 4h3v12h-3zM3.5 9h3M8.5 6.5h3M13.5 12h3',
    review: 'M6.5 3.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM3.5 7v8.5a1 1 0 0 0 1 1H13',
    search: 'M9 14.5A5.5 5.5 0 1 0 9 3.5a5.5 5.5 0 0 0 0 11zM16.5 16.5l-3.6-3.6',
    plus: 'M10 4.5v11M4.5 10h11',
    chev: 'M7.5 5l5 5-5 5', chevd: 'M5 7.5l5 5 5-5', back: 'M12.5 5l-5 5 5 5',
    settings: 'M3.5 6h7M14 6h2.5M3.5 14h2.5M9.5 14h7M12.25 7.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM7.75 15.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
    sun: 'M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 2.5V4M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1',
    moon: 'M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5z',
    speak: 'M3.5 8H6l3.5-3v10L6 12H3.5zM12.5 7.5a3.5 3.5 0 0 1 0 5M14.5 5.5a6.5 6.5 0 0 1 0 9',
    verify: 'M10 2.8 15.5 5v4.6c0 3.4-2.2 6.2-5.5 7.6-3.3-1.4-5.5-4.2-5.5-7.6V5zM7.5 10l1.8 1.8 3.4-3.6',
    shield: 'M10 2.8 15.5 5v4.6c0 3.4-2.2 6.2-5.5 7.6-3.3-1.4-5.5-4.2-5.5-7.6V5z',
    show: 'M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5zM10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
    addnote: 'M11.5 3h-6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H10M11.5 3 15 6.5V10M11.5 3v3.5H15M14.5 12.5v5M12 15h5',
    mic: 'M10 12.5a2.5 2.5 0 0 0 2.5-2.5V5.5a2.5 2.5 0 0 0-5 0V10a2.5 2.5 0 0 0 2.5 2.5zM15 9.5a5 5 0 0 1-10 0M10 14.5v3',
    play: 'M7 4.8v10.4a.5.5 0 0 0 .77.42l8-5.2a.5.5 0 0 0 0-.84l-8-5.2A.5.5 0 0 0 7 4.8z',
    pause: 'M7.5 5v10M12.5 5v10',
    step: 'M5.5 5v10l7-5zM14.5 5v10',
    reset: 'M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3',
    send: 'M10 16V4.5M5.5 9 10 4.5 14.5 9',
    link: 'M8.5 11.5a3.5 3.5 0 0 0 5 0l2.3-2.3a3.5 3.5 0 0 0-5-5l-.8.8M11.5 8.5a3.5 3.5 0 0 0-5 0l-2.3 2.3a3.5 3.5 0 0 0 5 5l.8-.8',
    gauge: 'M4 14.5a7 7 0 1 1 12 0M10 11.5l3-4',
    laptop: 'M4.5 4.5h11a1 1 0 0 1 1 1v7h-13v-7a1 1 0 0 1 1-1zM2 15.5h16',
    cloud: 'M14.5 15.5a3.2 3.2 0 1 0-1-6.25A4.5 4.5 0 0 0 4.8 10.4 2.6 2.6 0 0 0 5.5 15.5z',
    timer: 'M10 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 8v3l2 1.2M8.5 2.5h3',
    more: 'M5 10h.01M10 10h.01M15 10h.01',
    x: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
    check: 'M4.5 10.5 8 14l7.5-8',
    down: 'M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5',
    folder: 'M3 6a1 1 0 0 1 1-1h3.6l1.6 1.8H16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    article: 'M5 3.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM7 7.5h6M7 10.5h6M7 13.5h3.5',
    book: 'M4.5 15V5A1.5 1.5 0 0 1 6 3.5h9.5v10H6a1.5 1.5 0 0 0 0 3h9.5v-3',
    tutor: 'M4 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.5 3v-3H5a1 1 0 0 1-1-1z',
    models: 'M6.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM8 3v2.5M12 3v2.5M8 14.5V17M12 14.5V17M3 8h2.5M3 12h2.5M14.5 8H17M14.5 12H17',
    terminal: 'M4 4.5h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM6.5 8 9 10l-2.5 2M11 12.5h2.5',
    usage: 'M3.5 16.5h13M5.5 13V9.5M10 13V5M14.5 13V7.5',
    appearance: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 3v14M10 7h6.3M10 10h7M10 13h6.3',
    text: 'M3 15l3.5-9.5L10 15M4.2 12h4.6M12 12.2a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 0 0-4.6 0zM16.6 9.5V15',
    panel: 'M4.5 3.5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM12.5 3.5v13',
    bolt: 'M11 2.5 4.5 11.5H10l-1 6 6.5-9H10z',
    clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6v4l2.5 1.5',
    flag: 'M5 17V3.5M5 4.5h9.5l-2 3 2 3H5',
    hint: 'M7.5 13.5c-1.2-.9-2-2.3-2-4a4.5 4.5 0 0 1 9 0c0 1.7-.8 3.1-2 4V15h-5zM8 17.5h4',
    external: 'M11.5 4H16v4.5M16 4l-6.5 6.5M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5',
    filter: 'M3.5 5.5h13M6 10h8M8.5 14.5h3',
    grid: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
    list: 'M7 5.5h9.5M7 10h9.5M7 14.5h9.5M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
    copy: 'M7.5 7.5h8v9h-8zM4.5 12.5v-9h8',
    pen: 'M4 16h3l8.5-8.5a1.8 1.8 0 0 0-2.5-2.5L4.5 13.5zM12 6l2.5 2.5',
    general: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4'
  }
  const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 20 20" aria-hidden="true"><path d="${I[n] || ''}"/></svg>`
  window.tideIcon = icon
  const mark = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#12305c"/><path d="M5 10.2q3.5-4.4 7 0t7 0" fill="none" stroke="#e3eeff" stroke-width="2" stroke-linecap="round"/><path d="M5 15.6q3.5-4.4 7 0t7 0" fill="none" stroke="#e3eeff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/></svg>`

  /* The tutor: Tide's pixel professor, taken from src/shared/professorArt.ts (idle face). */
  const HALF = ['........', '.....sss', '....ssss', '..hhssss', '.hhhssss', '.hhkkkks', '.Shkwwks', '..skwpks', '...kkkkk', '....ssss', '....smmm', '.....smm', '....cccc', '...jjjct', '..Jjjjjt', '..JJjjjj']
  const PAL = { s: '#e3b48f', S: '#c9946d', h: '#ece8e1', m: '#ece8e1', k: '#2a2622', w: '#d6e7ef', p: '#1b1815', c: '#f3efe7', j: '#7a5b3d', J: '#5f4630', t: '#b8433a' }
  const prof = (size) => {
    let r = ''
    HALF.forEach((row, y) => { const full = row + [...row].reverse().join(''); [...full].forEach((v, x) => { if (v !== '.') r += `<rect x="${x}" y="${y}" width="1.03" height="1.03" fill="${PAL[v]}"/>` }) })
    return `<svg class="prof" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" role="img" aria-label="Tide, your tutor">${r}</svg>`
  }

  const page = document.body.dataset.page
  const a = (href, ic, label, key, extra = '') => `<a href="${href}"${key === page ? ' aria-current="page"' : ''}>${icon(ic)}<span class="t">${label}</span>${extra}</a>`
  const foot = `<div class="seg" role="group" aria-label="Theme"><button data-theme-btn="light" title="Light">${icon('sun', 's')}</button><button data-theme-btn="dark" title="Dark">${icon('moon', 's')}</button></div>`
  const top = `<div class="rail-top"><span class="lights"><i></i><i></i><i></i></span><button class="icon-btn" title="Back">${icon('back')}</button><button class="icon-btn" title="Search (⌘K)">${icon('search')}</button><button class="icon-btn" title="New">${icon('plus')}</button></div>`
  const rail = document.getElementById('rail')
  if (rail && document.body.dataset.rail === 'settings') {
    rail.innerHTML = `${top}<nav class="nav"><a href="index.html">${icon('back')}<span class="t">Back to Tide</span></a></nav>
      <div class="rail-scroll">
      <div class="rail-head">App</div><nav class="nav">${a('#', 'general', 'General')}${a('#', 'appearance', 'Appearance')}</nav>
      <div class="rail-head">Learning</div><nav class="nav">${a('#', 'tutor', 'Tutor and voice')}${a('#', 'timer', 'Study time')}</nav>
      <div class="rail-head">Models and services</div><nav class="nav">${a('connections.html', 'link', 'Connections', 'connections', '<span class="count">14</span>')}${a('#', 'models', 'Models')}${a('#', 'terminal', 'Tools')}${a('#', 'usage', 'Usage')}${a('speed.html', 'gauge', 'Speed', 'speed')}</nav>
      </div><div class="rail-foot"><span class="meta" style="flex:1;padding-left:8px">Tide 0.9, on this Mac</span>${foot}</div>`
  } else if (rail) {
    const nb = (c, label, kids = '') => `<li><a href="#"><span class="dot" style="background:var(--a${c})"></span><span class="t">${label}</span></a>${kids}</li>`
    rail.innerHTML = `${top}<a class="brand" href="index.html">${mark}Tide<small>Wed 11 Nov</small></a>
      <nav class="nav">${a('index.html', 'home', 'Home', 'home')}${a('lesson.html', 'learn', 'Learn', 'lesson')}${a('library.html', 'library', 'Library', 'library')}${a('know.html', 'know', 'What you know', 'know', '<span class="count">9 fading</span>')}</nav>
      <div class="rail-scroll">
      <div class="rail-head">Carry on</div>
      <nav class="nav"><a href="lesson.html">${icon('tutor')}<span class="t">Backpropagation in a two-layer network</span><span class="live" title="Lesson in progress"></span></a><a href="note.html"${page === 'note' ? ' aria-current="page"' : ''}>${icon('note')}<span class="t">Replication: leaders and followers</span></a></nav>
      <div class="rail-head">Notebooks <button class="icon-btn" style="width:22px;height:22px;margin:-4px -4px -4px 0" title="New notebook">${icon('plus', 's')}</button></div>
      <ul class="tree">
        ${nb(1, 'Computer systems')}
        ${nb(2, 'Distributed systems', `<ul><li class="kid"><a href="note.html"${page === 'note' ? ' aria-current="page"' : ''}><span class="t">Replication: leaders and followers</span></a></li><li class="kid"><a href="#"><span class="t">Consensus and Raft</span></a></li><li class="kid"><a href="#"><span class="t">Clocks and ordering</span></a></li></ul>`)}
        ${nb(3, 'Machine learning')}${nb(4, 'Data engineering')}${nb(5, 'C++')}
      </ul></div>
      <div class="rail-foot"><nav class="nav">${a('connections.html', 'settings', 'Settings', 'settings')}</nav>${foot}</div>`
  }
  document.querySelectorAll('[data-i]').forEach((el) => { el.outerHTML = icon(el.dataset.i, el.className) })
  document.querySelectorAll('[data-prof]').forEach((el) => { el.outerHTML = prof(+el.dataset.prof) })
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)))
  document.querySelectorAll('[data-read-toggle]').forEach((b) => b.addEventListener('click', () => setRead(root.dataset.read === 'sans' ? 'serif' : 'sans')))
  setTheme(root.dataset.theme)

  /* Segmented controls and tabs respond; they do not filter in the prototype. */
  document.querySelectorAll('.seg[data-pick]').forEach((s) => s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; s.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))) }))

  /* Hover detail on any mark with data-tip. */
  const tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip)
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]')
    if (!t) { tip.classList.remove('on'); return }
    tip.textContent = t.dataset.tip; tip.classList.add('on')
    const w = tip.offsetWidth, x = Math.min(window.innerWidth - w - 8, e.clientX + 12)
    tip.style.left = x + 'px'; tip.style.top = e.clientY + 14 + 'px'
  })
  /* For screenshots: ?y=600 scrolls the main pane. */
  if (q.get('y')) requestAnimationFrame(() => { const m = document.querySelector('.main'); if (m) m.scrollTop = +q.get('y') })
})()
