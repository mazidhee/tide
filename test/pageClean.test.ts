/**
 * Course pages without their noise (shared/pageClean): badges, register banners, link bars to
 * Slack and Telegram, community notes, learner stories, sponsors, tracking pixels, "Back to top"
 * and Previous/Next go; every word of the lesson, its code, maths, diagrams and links to its
 * materials stay. Read on real pages (test/fixtures/pageClean, see its README).
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { cleanPage, describeHidden, segmentsText, splitBlocks, type CleanOptions } from '../src/shared/pageClean'
import { catalogueCourse } from '../src/shared/courseCatalogue'

const DIR = join(__dirname, 'fixtures', 'pageClean')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')
const ZOOMCAMP: CleanOptions = { repo: 'Example/example-zoomcamp', rules: catalogueCourse('ml-zoomcamp')!.clean }

/** Every line of the lesson's own text (prose, code, maths, pictures) is still there, word for word */
function keepsAll(original: string, cleaned: string, lines: string[]) {
  for (const l of lines) {
    expect(original).toContain(l)
    expect(cleaned).toContain(l)
  }
}

describe('a Zoomcamp lesson (the shape of DataTalksClub’s)', () => {
  it('is left exactly as written: nothing in a lesson is noise', () => {
    const md = read('zoomcamp-lesson.md')
    const r = cleanPage(md, ZOOMCAMP)
    expect(r.cleaning).toBeNull()
    expect(r.markdown).toBe(md)
  })

  it('keeps a sign-up the lesson asks for (an account to run its notebook), its video, slides and notebook', () => {
    const r = cleanPage(read('zoomcamp-lesson.md'), ZOOMCAMP)
    expect(r.markdown).toContain('If you sign up for a free Kaggle account')
    expect(r.markdown).toContain('images/thumbnail-1-1.jpg')
    expect(r.markdown).toContain('[Slides](https://www.slideshare.net/example/ml-intro)')
  })
})

describe('a Zoomcamp module page', () => {
  const md = read('zoomcamp-module.md')
  const r = cleanPage(md, ZOOMCAMP)

  it('hides the community notes and the Previous | Next bar', () => {
    expect(r.cleaning).not.toBeNull()
    expect(r.markdown).not.toContain('Community notes')
    expect(r.markdown).not.toContain('Add your notes here')
    expect(r.markdown).not.toContain('Back to the course')
    // The bar is at the foot of the community notes: it goes with them, one item
    expect(r.cleaning!.hidden.map((h) => h.kind)).toEqual(['community'])
  })

  it('keeps the lessons, the homework and the Open in Colab badge (a way into the notebook)', () => {
    keepsAll(md, r.markdown, ['- 1.1 [What machine learning is](01-what-is-ml.md)', '- 1.4 [Setting up the environment](04-environment.md)', 'colab-badge.svg', '## Homework', 'homework.md'])
  })
})

describe('a Zoomcamp README', () => {
  const md = read('zoomcamp-readme.md')
  const r = cleanPage(md, ZOOMCAMP)
  const out = r.markdown

  it('hides the register banner, the link bar, badges, the star call-out and the tracking pixel', () => {
    expect(out).not.toContain('register-button.png')
    expect(out).not.toContain('Course Slack Channel')
    expect(out).not.toContain('img.shields.io')
    expect(out).not.toContain('Star this repo')
    expect(out).not.toContain('google-analytics')
  })

  it('hides the sections that are noise as a whole', () => {
    for (const h of ['## Quick Links', '## Certificate', '## Learner Stories', '## Community and Support', '### Getting Help on Slack', '## Sponsors', '## About DataTalks.Club']) expect(out).not.toContain(h)
    expect(out).not.toContain('sponsor-logo.png')
  })

  it('takes the registration row out of a table and keeps the rest of it', () => {
    expect(out).toContain('| Homework | Graded | Available, not scored |')
    expect(out).not.toContain('| Registration |')
  })

  it('keeps the course: what it is, how to take it, its syllabus, code, diagrams and FAQ', () => {
    keepsAll(md, out, [
      'Example Zoomcamp: A Free Course on Building Models',
      '## About the Course',
      '![From a notebook to a deployed service](images/course-overview.png)',
      '2. Watch the lectures in the [YouTube playlist](https://www.youtube.com/playlist?list=PL000).',
      '3. Ask questions in [Slack](https://datatalks.club/slack.html).',
      '### [Module 2: Regression](02-regression/)',
      'model = LinearRegression().fit(X_train, y_train)',
      '## FAQ',
      'Yes. The videos, materials and homework are free.'
    ])
  })

  it('counts what it hid and says what it was', () => {
    const kinds = new Set(r.cleaning!.hidden.map((h) => h.kind))
    for (const k of ['sign-up', 'community', 'badges', 'promotion', 'sponsors', 'tracking'] as const) expect(kinds.has(k)).toBe(true)
    expect(describeHidden(r.cleaning!.hidden)).toMatch(/\d+ badges?/)
  })

  it('loses nothing: the segments put back together are the page as it was', () => {
    expect(segmentsText(r.cleaning!.segments, true)).toBe(md)
    expect(segmentsText(r.cleaning!.segments, false).trim()).toBe(out.trim())
  })
})

describe('Machine Learning for Beginners (real pages, MIT)', () => {
  it('hides its badges, language bar, community banner and other-courses list from the README', () => {
    const md = read('mlfb-readme.md')
    const r = cleanPage(md, { repo: 'microsoft/ML-For-Beginners' })
    expect(r.markdown).not.toContain('img.shields.io/github/watchers')
    expect(r.markdown).not.toContain('Multi-Language Support')
    expect(r.markdown).not.toContain('translations/ar/README.md')
    expect(r.markdown).not.toContain('Other Courses')
    expect(r.markdown).not.toContain('LangChain4j for Beginners')
    expect(r.markdown).toContain('# Machine Learning for Beginners - A Curriculum')
    expect(r.markdown).toContain('Cloud Advocates at Microsoft are pleased to offer a 12-week, 26-lesson curriculum')
    expect(segmentsText(r.cleaning!.segments, true)).toBe(md)
  })

  it('leaves a lesson, with its quizzes, videos, steps and code, exactly as it is', () => {
    const md = read('mlfb-regression-tools.md')
    const r = cleanPage(md, { repo: 'microsoft/ML-For-Beginners' })
    expect(r.cleaning).toBeNull()
    expect(r.markdown).toBe(md)
  })
})

describe('rules, one at a time', () => {
  const clean = (md: string, o: CleanOptions = {}) => cleanPage(md, o)

  it('never touches code, even code that talks about signing up', () => {
    const md = 'Run this:\n\n```bash\n# Join our Slack: https://datatalks.club/slack.html\ncurl https://example.com/register\n```\n'
    expect(clean(md).cleaning).toBeNull()
  })

  it('hides a "Back to top" line and an Edit this page link', () => {
    const md = 'Text of the lesson.\n\n**[⬆ Back to Top](#contents)**\n\n[Edit this page](https://github.com/a/b/edit/main/x.md)\n\nMore of the lesson.\n'
    const r = clean(md)
    expect(r.markdown).toBe('Text of the lesson.\n\nMore of the lesson.\n')
    expect(r.cleaning!.hidden.map((h) => h.kind)).toEqual(['navigation', 'navigation'])
  })

  it('strips a badge from a line of prose and keeps the prose', () => {
    const r = clean('Install the package ![PyPI](https://img.shields.io/pypi/v/numpy) with pip, then import it.\n')
    expect(r.markdown).toBe('Install the package  with pip, then import it.\n')
    expect(r.cleaning!.segments[0].clean).toBeDefined()
  })

  it('hides contributor avatars and the all-contributors table', () => {
    const md = 'Lesson.\n\n<!-- ALL-CONTRIBUTORS-LIST:START -->\n<table><tr><td><img src="https://avatars.githubusercontent.com/u/1?v=4" width="100px;"/></td></tr></table>\n<!-- ALL-CONTRIBUTORS-LIST:END -->\n\n<a href="https://github.com/a/b/graphs/contributors"><img src="https://contrib.rocks/image?repo=a/b" /></a>\n'
    const r = clean(md)
    expect(r.markdown.trim()).toBe('Lesson.')
    expect(r.cleaning!.hidden.every((h) => h.kind === 'repo')).toBe(true)
  })

  it('a course’s keep rule wins over the built-in ones, and its drop rule hides what they wouldn’t', () => {
    const md = '## Sponsors\n\nThe sponsors of this lesson’s dataset.\n\n## Exercises\n\nDo these.\n\n## Changelog\n\nv2\n'
    const r = clean(md, { rules: { keep: ['^sponsors$'], drop: ['^changelog$'] } })
    expect(r.markdown).toContain('## Sponsors')
    expect(r.markdown).not.toContain('Changelog')
    expect(r.markdown).toContain('## Exercises')
  })

  it('a heading whose whole section went goes too', () => {
    const md = '## Lesson\n\nText.\n\n## Links\n\n[Slack](https://datatalks.club/slack.html) | [Telegram](https://t.me/x) | [Twitter](https://twitter.com/x)\n'
    const r = clean(md)
    expect(r.markdown.trim()).toBe('## Lesson\n\nText.')
  })

  it('keeps a list of people with their profiles (instructors), which is not a community bar', () => {
    const md = '## Instructors\n\n- [Ada Lovelace](https://www.linkedin.com/in/ada)\n- [Alan Turing](https://www.linkedin.com/in/alan)\n'
    expect(clean(md).cleaning).toBeNull()
  })

  it('keeps a diagram, and a link bar to the lesson’s own video, slides and notebook', () => {
    const md = '![The training loop](images/loop.png)\n\n[Video](https://youtu.be/abcdefghijk) | [Slides](slides.pdf) | [Notebook](notebook.ipynb)\n'
    expect(clean(md).cleaning).toBeNull()
  })

  it('in an article: the ebook pitch and the "Get started" footer go, an aside that says "get started" stays', () => {
    const md = [
      'Linear regression fits a line through the points.',
      '## Get your FREE Algorithms Mind Map',
      '![Mind map](https://example.com/mindmap.png)',
      'Also get exclusive access to the email mini-course.',
      '## Many Names of Linear Regression',
      "It's quick to get started with and has great docs.",
      'Learn to code for free. Our curriculum has helped people get jobs. [Get started](https://example.com/learn)'
    ].join('\n\n')
    const r = clean(md, { mode: 'article' })
    expect(r.markdown).not.toContain('Mind Map')
    expect(r.markdown).not.toContain('Learn to code for free')
    expect(r.markdown).toContain("It's quick to get started with")
    expect(r.markdown).toContain('## Many Names of Linear Regression')
  })

  it('in an article: pictures and links the filter lists block are taken out as ads', () => {
    const md = 'The lesson.\n\n[![Buy now](https://ads.example.net/banner.png)](https://ads.example.net/click?id=1)\n\nMore.\n'
    const r = clean(md, { mode: 'article', blocked: (u) => u.includes('ads.example.net') })
    expect(r.markdown).toBe('The lesson.\n\nMore.\n')
    expect(r.cleaning!.hidden[0].kind).toBe('ads')
  })

  it('splits a page into blocks that put back together are the page', () => {
    const md = read('zoomcamp-readme.md')
    expect(splitBlocks(md).map((b) => b.raw).join('')).toBe(md)
  })
})

// The real Zoomcamp pages, when they are on this Mac (they can't be kept in this public repository)
const REAL = process.env.TIDE_CLEAN_REAL
describe.skipIf(!REAL || !existsSync(REAL))('the real DataTalksClub pages on this Mac', () => {
  const files = REAL && existsSync(REAL) ? readdirSync(REAL).filter((f) => /^(mlz|dez|mlops|llm)-.*\.md$/.test(f)) : []
  it.each(files)('%s: never hides a lesson, and the original comes back whole', (f) => {
    const md = readFileSync(join(REAL!, f), 'utf8')
    const r = cleanPage(md, { repo: 'DataTalksClub/x', rules: catalogueCourse('ml-zoomcamp')!.clean })
    if (r.cleaning) expect(segmentsText(r.cleaning.segments, true)).toBe(md)
    // A lesson unit (front matter with its video) is never touched
    if (/^---\nvideo_url:/.test(md)) expect(r.cleaning).toBeNull()
    // Code survives everywhere
    for (const fence of md.match(/```[\s\S]*?```/g) ?? []) expect(r.markdown).toContain(fence)
  })
})
