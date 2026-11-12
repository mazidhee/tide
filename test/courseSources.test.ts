/**
 * Courses from everywhere: the rules every source is read by (robots.txt, content signals, logins
 * and paywalls, sites never read, licences), the polite fetcher, and each adapter on saved pages
 * (test/fixtures/sources): MIT OpenCourseWare, Open Yale Courses, a YouTube playlist, book sites
 * (Quarto, Sphinx, mdBook), a guide, a Jupyter Book's _toc.yml with MyST, and AsciiDoc. No network.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { asciidocMarkdown, captionSegments, gate, mystMarkdown, neverHost, parseJbToc, parseRobots, refusesAi, robotsAllow, tierOfLicence, transcriptMarkdown } from '@shared/courseSource'
import { allCourses, catalogueCourse, CATALOGUE, fromRepo, homeUrl, mediaOf, registerCourses, sourceOf, sourceSite, unregisterCourse, type CatalogueCourse } from '@shared/courseCatalogue'
import { WEB_COURSES } from '@shared/courseCatalogueWeb'
import { jbOutline, lessonSections } from '@shared/courses'
import { politeFetcher, SourceRefused, type Fetcher } from '../src/main/courseSources/fetcher'
import { flatten, parseHtml, parseToc } from '../src/main/courseSources/html'
import { lectureNumber, ocw, ocwNav, ocwResources, ocwVideo } from '../src/main/courseSources/ocw'
import { yale, yaleSession, yaleSessions } from '../src/main/courseSources/yale'
import { parsePlaylist, youtube } from '../src/main/courseSources/youtube'
import { docs, guidePlan, site, tocModules } from '../src/main/courseSources/site'
import { pdfParagraphs } from '../src/main/courseSources/pdf'

const FIX = join(__dirname, 'fixtures', 'sources')
const fixture = (name: string) => readFileSync(join(FIX, name), 'utf8')

/** A fetch that answers from saved pages; anything else is a 404 */
function fakeFetch(pages: Record<string, string | { status: number; body?: string; url?: string; type?: string }>) {
  const asked: string[] = []
  const impl = async (url: string): Promise<Response> => {
    asked.push(url)
    const p = pages[url]
    if (p === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    const o = typeof p === 'string' ? { status: 200, body: p } : p
    const res = new Response(o.body ?? '', { status: o.status, headers: { 'content-type': o.type ?? (/\.(vtt|txt)$/.test(url) || url.endsWith('robots.txt') ? 'text/plain' : 'text/html') } })
    if (o.url) Object.defineProperty(res, 'url', { value: o.url })
    else Object.defineProperty(res, 'url', { value: url })
    return res
  }
  return { impl, asked }
}
const fetcherOver = (pages: Parameters<typeof fakeFetch>[0]): Fetcher & { urls: string[] } => {
  const f = fakeFetch(pages)
  const p = politeFetcher({ fetchImpl: f.impl, sleep: async () => {}, gapMs: 0 })
  return Object.assign(p, { urls: f.asked })
}

// ---------- The rules ----------

describe('robots.txt', () => {
  const r = parseRobots(`# a comment
User-agent: GPTBot
Disallow: /

User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Disallow: /admin/
Disallow: /search
Allow: /search/help
Disallow: /*.pdf$
Crawl-delay: 2
`)
  it('reads the group for every robot when none names Tide, with its delay and content signals', () => {
    expect(r.crawlDelay).toBe(2)
    expect(r.signals['ai-train']).toBe('no')
    expect(refusesAi(r)).toBe(false)
  })
  it('lets the longest matching rule decide, Allow winning a tie, with * and $', () => {
    expect(robotsAllow(r, '/courses/x/')).toBe(true)
    expect(robotsAllow(r, '/admin/users')).toBe(false)
    expect(robotsAllow(r, '/search?q=x')).toBe(false)
    expect(robotsAllow(r, '/search/help')).toBe(true)
    expect(robotsAllow(r, '/files/notes.pdf')).toBe(false)
    expect(robotsAllow(r, '/files/notes.pdf?x=1')).toBe(true)
  })
  it('uses a group that names Tide over the general one', () => {
    const t = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: Tide\nDisallow: /private/')
    expect(robotsAllow(t, '/private/a')).toBe(false)
    expect(robotsAllow(t, '/public')).toBe(true)
  })
  it('refuses a site that says its pages may not be given to AI models', () => {
    expect(refusesAi(parseRobots('User-agent: *\nContent-Signal: ai-input=no\nAllow: /'))).toBe(true)
  })
  it('reads YouTube’s rules as they are: playlists allowed, its API and caption endpoints not', () => {
    const yt = parseRobots('User-agent: *\nDisallow: /api/\nDisallow: /feeds/videos.xml\nDisallow: /youtubei/\nDisallow: /results\n')
    expect(robotsAllow(yt, '/playlist?list=PL123')).toBe(true)
    expect(robotsAllow(yt, '/@mitocw/playlists')).toBe(true)
    expect(robotsAllow(yt, '/youtubei/v1/browse')).toBe(false)
    expect(robotsAllow(yt, '/api/timedtext?v=x')).toBe(false)
    expect(robotsAllow(yt, '/results?search_query=x')).toBe(false)
  })
})

describe('free, without a login', () => {
  it('never reads the sites that keep courses behind accounts', () => {
    for (const u of ['https://www.coursera.org/learn/cryptocurrency', 'https://learning.edx.org/course/x', 'https://www.udemy.com/course/iso-20022', 'https://learn-iso-20022.teachable.com/p/x', 'https://www.linkedin.com/learning/x']) expect(neverHost(u), u).toBe(true)
    for (const u of ['https://ocw.mit.edu/courses/x/', 'https://oyc.yale.edu/economics/econ-252', 'https://www.youtube.com/playlist?list=PL1']) expect(neverHost(u), u).toBe(false)
  })
  it('sees a login wall: a redirect to sign in, a 401, a sign-in form', () => {
    expect(gate({ url: 'https://x.org/course/1', finalUrl: 'https://x.org/users/sign_in?next=/course/1', status: 200 })).toBe('login')
    expect(gate({ url: 'https://x.org/course/1', status: 401 })).toBe('login')
    expect(gate({ url: 'https://x.org/c', status: 200, html: '<form><input name="email"><input type="password"></form><p>Sign in</p>' })).toBe('login')
    expect(gate({ url: 'https://x.org/c', status: 200, html: '<p>Log in to continue watching this lecture.</p>' })).toBe('login')
  })
  it('sees a paywall', () => {
    expect(gate({ url: 'https://x.org/a', status: 402 })).toBe('paywall')
    expect(gate({ url: 'https://x.org/a', status: 200, html: '<script type="application/ld+json">{"isAccessibleForFree": false}</script><p>text</p>' })).toBe('paywall')
    expect(gate({ url: 'https://x.org/a', status: 200, html: '<p>Subscribe to continue reading.</p>' })).toBe('paywall')
  })
  it('lets a free page through, even one that mentions logging in somewhere', () => {
    expect(gate({ url: 'https://ocw.mit.edu/courses/x/', status: 200, html: fixture('ocw-home.html') })).toBeNull()
    expect(gate({ url: 'https://x.org/login', finalUrl: 'https://x.org/login', status: 200, html: '<p>How login works, a long article</p>' })).toBeNull()
  })
})

describe('licences', () => {
  it('sorts licences into open (copying with attribution) and personal study', () => {
    for (const l of ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC BY-SA 4.0', 'CC0-1.0', 'GPL-3.0']) expect(tierOfLicence(l), l).toBe('open')
    for (const l of ['CC BY-NC-SA 4.0', 'CC-BY-NC-ND-4.0', 'CC BY-NC-SA 3.0', 'None stated', 'NOASSERTION', '', 'Stripe documentation (all rights reserved)', 'Standard YouTube licence']) expect(tierOfLicence(l), l).toBe('personal')
  })
  it('records a licence on every web course, and keeps OCW, Yale and YouTube courses personal', () => {
    for (const c of WEB_COURSES) {
      expect(c.licence.trim().length, c.id).toBeGreaterThan(2)
      if (c.tier === 'open') expect(tierOfLicence(c.licence), `${c.id}: ${c.licence}`).toBe('open')
      if (c.source === 'ocw' || c.source === 'yale' || c.source === 'youtube') expect(c.tier, c.id).toBe('personal')
      if (c.tier === 'personal') expect(c.licenceNote, c.id).toBeTruthy()
    }
  })
  it('never lists a course from a site behind accounts', () => {
    for (const c of CATALOGUE) {
      expect(neverHost(homeUrl(c)), c.id).toBe(false)
      for (const p of c.pages ?? []) expect(neverHost(p.url), `${c.id} ${p.url}`).toBe(false)
    }
  })
})

describe('the web catalogue', () => {
  it('adds 30 to 60 courses with what each covers, its level, and where it is read from', () => {
    expect(WEB_COURSES.length).toBeGreaterThanOrEqual(30)
    expect(WEB_COURSES.length).toBeLessThanOrEqual(60)
    const ids = CATALOGUE.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of WEB_COURSES) {
      expect(c.covers.length, c.id).toBeGreaterThan(40)
      expect(['beginner', 'intermediate', 'advanced']).toContain(c.level)
      const s = sourceOf(c)
      if (s === 'youtube') expect(c.playlist, c.id).toMatch(/^PL[\w-]{16,}$/)
      else if (s === 'docs') expect(c.pages?.length, c.id).toBeGreaterThan(0)
      else if (fromRepo(c)) expect(c.repo, c.id).toMatch(/^[\w.-]+\/[\w.-]+$/)
      else expect(c.url, c.id).toMatch(/^https:\/\//)
      if (c.jbToc) expect(c.jbToc).toMatch(/^https:\/\/raw\.githubusercontent\.com\/.+_toc\.yml$/)
      expect(sourceSite(c).length, c.id).toBeGreaterThan(3)
    }
  })
  it('covers the focus subjects: payments, blockchain, quant and economics, with every kind of source', () => {
    const by = (a: string) => WEB_COURSES.filter((c) => c.area === a).length
    for (const a of ['payments', 'blockchain', 'quant', 'econ']) expect(by(a), a).toBeGreaterThanOrEqual(5)
    for (const s of ['ocw', 'yale', 'jupyterbook', 'site', 'youtube', 'docs']) expect(WEB_COURSES.some((c) => sourceOf(c) === s), s).toBe(true)
    expect(WEB_COURSES.some((c) => mediaOf(c) === 'video')).toBe(true)
  })
  it('takes courses found at run time into the catalogue, and lets them go', () => {
    const c: CatalogueCourse = { id: 'found-x', source: 'youtube', playlist: 'PL0123456789abcdefghij', title: 'X', by: 'Y', area: 'econ', licence: 'Standard YouTube licence', tier: 'personal', licenceNote: 'n', covers: 'c', kind: 'course', level: 'beginner', topics: ['x'] }
    registerCourses([c])
    expect(catalogueCourse('found-x')?.title).toBe('X')
    expect(allCourses().some((x) => x.id === 'found-x')).toBe(true)
    unregisterCourse('found-x')
    expect(catalogueCourse('found-x')).toBeUndefined()
  })
})

// ---------- The polite fetcher ----------

describe('the polite fetcher', () => {
  it('reads robots.txt first and refuses what it disallows', async () => {
    const f = fetcherOver({ 'https://site.org/robots.txt': 'User-agent: *\nDisallow: /private/', 'https://site.org/ok': '<p>ok</p>' })
    expect((await f.page('https://site.org/ok')).text).toContain('ok')
    await expect(f.page('https://site.org/private/x')).rejects.toMatchObject({ why: 'robots' })
    expect(f.urls[0]).toBe('https://site.org/robots.txt')
    // Once per site
    await f.page('https://site.org/ok')
    expect(f.urls.filter((u) => u.endsWith('robots.txt'))).toHaveLength(1)
  })
  it('refuses a login wall and a paywall, and never asks a site behind accounts', async () => {
    const f = fetcherOver({ 'https://site.org/course': { status: 200, body: '<p>please</p>', url: 'https://site.org/login?next=/course' }, 'https://site.org/paid': { status: 402 } })
    await expect(f.page('https://site.org/course')).rejects.toMatchObject({ why: 'login' })
    await expect(f.page('https://site.org/paid')).rejects.toMatchObject({ why: 'paywall' })
    await expect(f.page('https://www.coursera.org/learn/x')).rejects.toMatchObject({ why: 'never' })
    expect(f.urls.some((u) => u.includes('coursera'))).toBe(false)
  })
  it('keeps a gap between requests to a site, longer when robots.txt asks', async () => {
    const waits: number[] = []
    const { impl } = fakeFetch({ 'https://slow.org/robots.txt': 'User-agent: *\nCrawl-delay: 3', 'https://slow.org/a': 'a', 'https://slow.org/b': 'b' })
    const f = politeFetcher({ fetchImpl: impl, sleep: async (ms) => void waits.push(ms), gapMs: 1000 })
    await f.page('https://slow.org/a')
    await f.page('https://slow.org/b')
    expect(Math.max(...waits)).toBeGreaterThan(2500)
  })
  it('refuses a site that asks not to be given to AI models', async () => {
    const f = fetcherOver({ 'https://no.org/robots.txt': 'User-agent: *\nContent-Signal: ai-input=no\nAllow: /', 'https://no.org/x': 'x' })
    await expect(f.page('https://no.org/x')).rejects.toBeInstanceOf(SourceRefused)
  })
})

// ---------- MIT OpenCourseWare ----------

const OCW_BASE = 'https://ocw.mit.edu/courses/18-s096-topics-in-mathematics-with-applications-in-finance-fall-2013/'
const ocwPages = {
  [OCW_BASE]: fixture('ocw-home.html'),
  [`${OCW_BASE}video_galleries/video-lectures/`]: fixture('ocw-video-gallery.html'),
  [`${OCW_BASE}pages/lecture-notes/`]: fixture('ocw-lecture-notes.html'),
  [`${OCW_BASE}pages/assignments/`]: fixture('ocw-assignments.html'),
  [`${OCW_BASE}resources/lecture-7-value-at-risk-var-models/`]: fixture('ocw-resource-lecture7.html'),
  [`${OCW_BASE}resources/mit18_s096f13_lecnote7/`]: fixture('ocw-resource-lecnote7.html'),
  [`${OCW_BASE}9f5c877175f25ea2aa86d226ca41e35b_92WaNz9mPeY.vtt`]: 'WEBVTT\n\n00:00:00.500 --> 00:00:04.000\nThe following content is provided under a Creative Commons license.\n\n00:00:20.000 --> 00:00:25.000\nToday we talk about value at risk.\n\n00:01:30.000 --> 00:01:34.000\nVaR is a quantile of the loss distribution.\n'
}
const ocwCourse = WEB_COURSES.find((c) => c.id === 'ocw-18-s096-math-finance')!

describe('MIT OpenCourseWare', () => {
  it('finds the course’s pages, lecture videos, notes and problem sets', () => {
    const home = parseHtml(fixture('ocw-home.html'), OCW_BASE)
    const nav = ocwNav(home, OCW_BASE)
    expect([...nav.pages.keys()]).toEqual(expect.arrayContaining(['syllabus', 'lecture-notes', 'assignments']))
    expect(nav.galleries).toEqual([`${OCW_BASE}video_galleries/video-lectures/`])
    const vids = ocwResources(parseHtml(fixture('ocw-video-gallery.html'), OCW_BASE), OCW_BASE)
    expect(vids.length).toBeGreaterThan(20)
    expect(vids[0].title).toBe('Lecture 1: Introduction, Financial Terms and Concepts')
    const notes = ocwResources(parseHtml(fixture('ocw-lecture-notes.html'), OCW_BASE), OCW_BASE)
    expect(notes[0].title).toBe('Introduction & Financial Terms and Concepts')
    expect(lectureNumber(notes[0].row)).toBe(1)
    const v = ocwVideo(parseHtml(fixture('ocw-resource-lecture7.html'), OCW_BASE), OCW_BASE)
    expect(v.video).toBe('92WaNz9mPeY')
    expect(v.vtt).toBe(`${OCW_BASE}9f5c877175f25ea2aa86d226ca41e35b_92WaNz9mPeY.vtt`)
    expect(v.description).toContain('Value At Risk')
  })
  it('builds a course: syllabus, lectures with their video and OCW’s own captions as the transcript, notes joined by number, problem sets as homework', async () => {
    const f = fetcherOver(ocwPages)
    const built = await ocw.build(ocwCourse, f, () => {})
    const titles = built.modules.map((m) => m.title)
    expect(titles[0]).toBe('Introduction')
    expect(titles).toContain('Problem sets')
    const lessons = built.modules.flatMap((m) => m.lessons)
    const l7 = lessons.find((l) => l.title.startsWith('Lecture 7'))!
    expect(l7.markdown).toContain('https://www.youtube.com/watch?v=92WaNz9mPeY')
    expect(l7.markdown).toContain('## Lecture notes: Value At Risk (VAR) Models')
    expect(l7.markdown).toContain('## Transcript')
    expect(l7.markdown).toContain('VaR is a quantile')
    expect(built.captions).toHaveLength(1)
    expect(built.captions[0]).toMatchObject({ video: '92WaNz9mPeY' })
    // Pages it couldn't read leave the lecture with its video still to be transcribed, not an error
    const l1 = lessons.find((l) => l.title.startsWith('Lecture 1:'))!
    expect(l1.url).toBe(`${OCW_BASE}resources/lecture-1-introduction-financial-terms-and-concepts/`)
    const psets = built.modules.find((m) => m.title === 'Problem sets')!.lessons
    expect(psets.length).toBeGreaterThan(5)
    expect(psets.every((p) => p.kind === 'homework')).toBe(true)
    // Lectures in order, in modules of at most eight
    for (const m of built.modules) expect(m.lessons.length).toBeLessThanOrEqual(9)
    // The check's fingerprint is the build's
    expect(await ocw.probe(ocwCourse, fetcherOver(ocwPages))).toBe(built.version)
  })
  it('turns captions into a transcript in parts, each paragraph linked to its moment', () => {
    const segs = captionSegments(ocwPages[`${OCW_BASE}9f5c877175f25ea2aa86d226ca41e35b_92WaNz9mPeY.vtt`])
    expect(segs).toHaveLength(3)
    expect(segs[2].start).toBe(90)
    const md = transcriptMarkdown('92WaNz9mPeY', segs)
    expect(md).toMatch(/^### From 0:00/)
    expect(md).toContain('[1:30](https://www.youtube.com/watch?v=92WaNz9mPeY&t=90s)')
    expect(lessonSections(`## Transcript\n\n${md}`, 'x').length).toBeGreaterThan(0)
  })
})

// ---------- Open Yale Courses ----------

describe('Open Yale Courses', () => {
  const base = 'https://oyc.yale.edu/economics/econ-252'
  it('lists the sessions and reads a lecture: video, overview, reading, transcript in chapters linked to the video', () => {
    const s = yaleSessions(parseHtml(fixture('yale-course.html'), base), base)
    expect(s).toHaveLength(26)
    expect(s[0]).toMatchObject({ label: 'Lecture 1', url: 'https://oyc.yale.edu/economics/econ-252-11/lecture-1' })
    const x = yaleSession(parseHtml(fixture('yale-lecture7.html'), s[6].url), s[6].url)
    expect(x.video).toBe('3EzdvkRgToY')
    expect(x.overview).toContain('Efficient Markets Hypothesis')
    expect(x.assignment).toContain('Finance and the Good Society')
    expect(x.transcript).toMatch(/### Chapter 1\. .* · \[0:00\]\(https:\/\/www\.youtube\.com\/watch\?v=3EzdvkRgToY&t=0s\)/)
    expect(x.transcript.split(/\s+/).length).toBeGreaterThan(3000)
  })
  it('builds the course: lectures, and exams as homework without their solutions', async () => {
    const f = fetcherOver({ [base]: fixture('yale-course.html'), 'https://oyc.yale.edu/economics/econ-252-11/lecture-7': fixture('yale-lecture7.html'), 'https://oyc.yale.edu/economics/econ-252-11/exam-1': fixture('yale-exam1.html') })
    const built = await yale.build(WEB_COURSES.find((c) => c.id === 'yale-econ-252-financial-markets')!, f, () => {})
    const all = built.modules.flatMap((m) => m.lessons)
    expect(all.find((l) => l.title.startsWith('Lecture 7'))!.markdown).toContain('## Transcript')
    const exams = built.modules.find((m) => m.title === 'Exams')!.lessons
    expect(exams[0].kind).toBe('homework')
    expect(exams[0].markdown).not.toMatch(/Solution\.pdf/)
    expect(built.notes.length).toBeGreaterThan(10) // the sessions with no saved page
  })
})

// ---------- YouTube ----------

describe('a YouTube playlist', () => {
  it('reads the playlist page: its title, channel and each video in order', () => {
    const pl = parsePlaylist(fixture('youtube-playlist.html'))
    expect(pl.title).toBe('Financial Markets (2011) with Robert Shiller')
    expect(pl.channel).toBe('YaleCourses')
    expect(pl.videos).toHaveLength(23)
    expect(pl.videos[0]).toMatchObject({ id: 'WQui_3Hpmmc', title: '1. Introduction and What this Course Will Do for You and Your Purposes', length: 4452 })
  })
  it('makes each video a lesson that shows the kept transcript, reading only the playlist page', async () => {
    const f = fetcherOver({ 'https://www.youtube.com/robots.txt': 'User-agent: *\nDisallow: /api/\nDisallow: /youtubei/', 'https://www.youtube.com/playlist?list=PL8FB14A2200B87185': fixture('youtube-playlist.html') })
    const c: CatalogueCourse = { id: 'x', source: 'youtube', playlist: 'PL8FB14A2200B87185', title: 'x', by: 'y', area: 'quant', licence: 'Standard YouTube licence', tier: 'personal', covers: 'c', kind: 'course', level: 'beginner', topics: [] }
    const built = await youtube.build(c, f, () => {})
    const lessons = built.modules.flatMap((m) => m.lessons).filter((l) => l.url.includes('watch'))
    expect(lessons).toHaveLength(23)
    expect(lessons[0].markdown).toContain('<!-- tide:transcript WQui_3Hpmmc -->')
    expect(f.urls.every((u) => !u.includes('/youtubei/') && !u.includes('/api/'))).toBe(true)
  })
})

// ---------- Books and guides ----------

describe('online books', () => {
  it('reads a Quarto book’s contents (Python for Data Analysis): its chapters as a module', () => {
    const base = 'https://wesmckinney.com/book/'
    const nodes = parseToc(parseHtml(fixture('pda-index.html'), base), base)
    const mods = tocModules(nodes, base)
    const pages = mods.flatMap((m) => m.pages)
    expect(pages.length).toBeGreaterThanOrEqual(14)
    expect(pages.some((p) => /Data Cleaning and Preparation/.test(p.title))).toBe(true)
    expect(new Set(pages.map((p) => p.url)).size).toBe(pages.length)
    expect(pages.every((p) => p.url.startsWith(base))).toBe(true)
  })
  it('reads a Sphinx book’s parts (d2l) as modules, each chapter’s pages its lessons', () => {
    const base = 'https://d2l.ai/'
    const mods = tocModules(parseToc(parseHtml(fixture('d2l-index.html'), base), base), base)
    const prelim = mods.find((m) => m.title === 'Preliminaries')!
    expect(prelim.pages[0].url).toBe('https://d2l.ai/chapter_preliminaries/index.html')
    expect(prelim.pages.map((p) => p.title)).toContain('2.1. Data Manipulation')
  })
  it('reads an mdBook’s chapter list', () => {
    const html = '<nav><ol class="chapter"><li class="chapter-item"><a href="intro.html">Introduction</a></li><li class="chapter-item"><a href="ch1.html">1. Keys</a><ol class="section"><li class="chapter-item"><a href="ch1-1.html">1.1 Hashes</a></li></ol></li><li class="chapter-item"><a href="ch2.html">2. Scripts</a></li></ol></nav>'
    const nodes = parseToc(parseHtml(html, 'https://book.org/'), 'https://book.org/')
    expect(flatten(nodes).map((n) => n.title)).toEqual(['Introduction', '1. Keys', '1.1 Hashes', '2. Scripts'])
    const mods = tocModules(nodes, 'https://book.org/')
    expect(mods.map((m) => m.title)).toEqual(['Front matter', 'Keys', 'More'])
  })
  it('builds a book from its pages and keeps a Jupyter Book chapter’s notebook, so its code runs', async () => {
    const base = 'https://jb.org/book/'
    const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', source: '# Prices' }, { cell_type: 'code', source: 'print(1+1)', outputs: [] }], metadata: { language_info: { name: 'python' } } })
    const f = fetcherOver({
      [`${base}intro.html`]: '<nav class="bd-links"><ul><li><a href="intro.html">Intro</a></li><li><a href="prices.html">Prices</a></li><li><a href="https://elsewhere.org/x">Elsewhere</a></li></ul></nav><main><article class="bd-article"><h1>Intro</h1><p>' + 'word '.repeat(60) + '</p></article></main>',
      [`${base}prices.html`]: '<a href="_sources/prices.ipynb">Download</a><article class="bd-article"><h1>Prices</h1><p>' + 'price '.repeat(60) + '</p><pre><code class="language-python">x = 1</code></pre></article>',
      [`${base}_sources/prices.ipynb`]: { status: 200, body: nb, type: 'application/json' }
    })
    const c: CatalogueCourse = { id: 'jb', source: 'site', url: `${base}intro.html`, title: 't', by: 'b', area: 'econ', licence: 'MIT', tier: 'open', covers: 'c', kind: 'book', level: 'beginner', topics: [] }
    const built = await site.build(c, f, () => {})
    const lessons = built.modules.flatMap((m) => m.lessons)
    expect(lessons.map((l) => l.title)).toEqual(['Intro', 'Prices'])
    expect(lessons[1].kind).toBe('notebook')
    expect(lessons[1].notebook).toContain('print(1+1)')
    expect(lessons[0].markdown).toContain('word word')
    // Never left the book
    expect(f.urls.some((u) => u.includes('elsewhere.org'))).toBe(false)
  })
  it('reads a guide’s pages in order, grouped by module, a PDF among them', async () => {
    const c = WEB_COURSES.find((x) => x.id === 'stripe-payments')!
    const plan = guidePlan(c)
    expect(plan.map((m) => m.title)).toEqual(['Taking a payment', 'Ways to pay', 'After the payment', 'Platforms and marketplaces'])
    const g: CatalogueCourse = { ...c, pages: [{ title: 'A', url: 'https://g.org/a', module: 'One' }, { title: 'Paper', url: 'https://g.org/p.pdf' }] }
    const f = fetcherOver({ 'https://g.org/a': '<main><h1>A</h1><p>' + 'pay '.repeat(80) + '</p></main>', 'https://g.org/p.pdf': { status: 200, body: '%PDF-1.4 fake', type: 'application/pdf' } })
    const built = await docs.build(g, f, () => {})
    expect(built.modules[0].lessons.map((l) => l.title)).toEqual(['A', 'Paper'])
    expect(built.modules[0].lessons[1].markdown).toContain('[The document as a PDF](https://g.org/p.pdf)')
    expect(await docs.probe(g, fetcherOver({ 'https://g.org/a': '<main><h1>A</h1><p>' + 'pay '.repeat(80) + '</p></main>', 'https://g.org/p.pdf': { status: 200, body: '%PDF-1.4 fake', type: 'application/pdf' } }))).toBe(built.version)
  })
  it('turns a PDF’s text into paragraphs', () => {
    expect(pdfParagraphs('Value at risk is a quan-\ntile of losses.\n\n3\nIt is used by banks')).toBe('Value at risk is a quantile of losses.\n\nIt is used by banks')
  })
})

// ---------- Jupyter Books (QuantEcon) and AsciiDoc ----------

describe('a Jupyter Book: QuantEcon', () => {
  const toc = `format: jb-book
root: intro
parts:
- caption: Introduction
  numbered: true
  chapters:
  - file: about
- caption: Economic Data
  chapters:
  - file: long_run_growth
  - file: business_cycle
    sections:
    - file: business_cycle_extra
`
  it('reads _toc.yml as parts and files', () => {
    expect(parseJbToc(toc)).toEqual({ root: 'intro', parts: [{ title: 'Introduction', files: ['about'] }, { title: 'Economic Data', files: ['long_run_growth', 'business_cycle', 'business_cycle_extra'] }] })
  })
  it('builds the outline from a .notebooks repository (flat notebooks) with the book’s _toc.yml', () => {
    const nb = (t: string) => JSON.stringify({ cells: [{ cell_type: 'markdown', source: `# ${t}\n\n${'text '.repeat(40)}` }, { cell_type: 'code', source: 'import numpy as np', outputs: [] }] })
    const o = jbOutline({}, [
      { path: '_toc.yml', text: toc },
      { path: 'about.ipynb', text: `# About\n\n${'a '.repeat(40)}` },
      { path: 'long_run_growth.ipynb', text: `# Growth\n\n${'g '.repeat(40)}\n\n\`\`\`python\nx=1\n\`\`\`` },
      { path: 'business_cycle.ipynb', text: nb('Cycles') }
    ])!
    expect(o.modules.map((m) => m.title)).toEqual(['Introduction', 'Economic Data'])
    expect(o.modules[1].lessons.map((l) => l.path)).toEqual(['long_run_growth.ipynb', 'business_cycle.ipynb'])
    expect(o.modules[1].lessons.every((l) => l.kind === 'notebook')).toBe(true)
  })
  it('reads MyST as Markdown: code cells runnable, maths, exercises and solutions, roles', () => {
    const md = mystMarkdown(`(label)=
# Prices

The price is {math}\`p_t\` (see {doc}\`the intro <intro>\`).

\`\`\`{code-cell} ipython3
:tags: [hide-output]
import numpy as np
\`\`\`

\`\`\`{math}
p_t = \\beta p_{t+1}
\`\`\`

\`\`\`{exercise-start}
:label: ex1
\`\`\`
Compute it.
\`\`\`{exercise-end}
\`\`\`

\`\`\`{solution-start} ex1
:class: dropdown
\`\`\`
It is 1.
\`\`\`{solution-end}
\`\`\`

:::{note}
Careful.
:::
`)
    expect(md).not.toContain('(label)=')
    expect(md).toContain('The price is $p_t$ (see the intro)')
    expect(md).toContain('```python\nimport numpy as np\n```')
    expect(md).not.toContain(':tags:')
    expect(md).toContain('$$\np_t = \\beta p_{t+1}\n$$')
    expect(md).toContain('#### Exercise\nCompute it.')
    expect(md).toContain('#### Solution\nIt is 1.')
    expect(md).toContain('> **Note**')
    expect(md).toContain('> Careful.')
  })
})

describe('AsciiDoc books (Mastering Bitcoin)', () => {
  it('reads a chapter as Markdown', () => {
    const md = asciidocMarkdown(`[[ch04_keys_addresses]]
== Keys and Addresses

((("keys")))Bitcoin uses *public key* cryptography, see <<ch05_wallets>> and https://bitcoin.org[the site].

[source,python]
----
print("hello") <1>
----

[TIP]
====
Keep your keys safe.
====

NOTE: A note.

* One
** Two
image::images/mbc3_0401.png["Public key"]
`)
    expect(md).toContain('## Keys and Addresses')
    expect(md).not.toContain('[[ch04')
    expect(md).toContain('Bitcoin uses **public key** cryptography, see wallets and [the site](https://bitcoin.org).')
    expect(md).toContain('```python\nprint("hello")\n```')
    expect(md).toContain('> **Tip**')
    expect(md).toContain('> Keep your keys safe.')
    expect(md).toContain('> **Note**: A note.')
    expect(md).toContain('- One\n  - Two')
    expect(md).toContain('![Public key](images/mbc3_0401.png)')
  })
})
