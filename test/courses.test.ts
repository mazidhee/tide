import { describe, expect, it } from 'vitest'
import {
  AREAS,
  CATALOGUE,
  absolutise,
  buildOutline,
  courseReading,
  courseRules,
  inCourse,
  lessonSections,
  moduleProgress,
  natural,
  nextLesson,
  notebookMarkdown,
  sectionFor,
  splitOutline,
  suggestCourses,
  titleOf,
  type CatalogueCourse,
  type RepoFile
} from '@shared/courses'
import { faithful, parseReading, readingBlock, authorityOf, licenceScore } from '@shared/sourceLed'
import { sessionInstructions, strategyChoice } from '@shared/session'

const words = (n: number, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(' ')

const base: CatalogueCourse = {
  id: 'test',
  repo: 'someone/course',
  branch: 'main',
  title: 'Test course',
  by: 'Someone',
  area: 'data',
  licence: 'MIT',
  tier: 'open',
  covers: 'things',
  kind: 'course',
  level: 'beginner',
  topics: ['data engineering', 'docker']
}

describe('the catalogue', () => {
  it('has unique ids, known areas and a licence on every course', () => {
    const ids = CATALOGUE.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(40)
    for (const c of CATALOGUE) {
      expect(AREAS.some((a) => a.id === c.area), c.id).toBe(true)
      expect(c.licence.length, c.id).toBeGreaterThan(2)
      expect(c.repo, c.id).toMatch(/^[\w.-]+\/[\w.-]+$/)
      expect(c.topics.length, c.id).toBeGreaterThan(0)
      // Anything without an open licence says why it is personal study only
      if (c.tier === 'personal') expect(c.licenceNote, c.id).toBeTruthy()
      if (/None stated|-NC|-ND|BY-NC|All rights|all rights|not licensed/.test(`${c.licence} ${c.licenceNote ?? ''}`)) expect(c.tier, c.id).toBe('personal')
      if (c.modules) expect(() => new RegExp(c.modules!)).not.toThrow()
    }
  })
  it('covers every area', () => {
    for (const a of AREAS) expect(CATALOGUE.some((c) => c.area === a.id), a.id).toBe(true)
  })
})

describe('reading a repository as a course', () => {
  const files: RepoFile[] = [
    { path: 'README.md', text: `# The course\n\n${words(80)}\n\n- [Module 2: Warehouses](02-warehouse/)\n- [Module 1: Docker](01-docker/)\n` },
    { path: 'LICENSE' },
    { path: 'CONTRIBUTING.md', text: words(200) },
    { path: '01-docker/README.md', text: `# Docker\n\n${words(90)}` },
    { path: '01-docker/02-compose.md', text: `# Compose\n\n${words(120)}` },
    { path: '01-docker/01-intro.md', text: `---\ntitle: Why Docker\n---\n\n${words(120)}` },
    { path: '01-docker/ingest.py' },
    { path: '01-docker/translations/es/01-intro.md', text: words(200) },
    { path: '02-warehouse/01-bq.md', text: `# BigQuery\n\n${words(120)}` },
    { path: '02-warehouse/notebook.ipynb', text: `# Partitions\n\n${words(60)}\n\n\`\`\`python\nprint(1)\n\`\`\`` },
    { path: 'cohorts/2025/01-docker/homework.md', text: `# Homework\n\n${words(60)}` },
    { path: 'cohorts/2026/01-docker/homework.md', text: `# Homework\n\n${words(60)}` },
    { path: '.tmp/notes.md', text: words(300) }
  ]
  const o = buildOutline({ ...base, modules: '^\\d\\d-', homework: { dir: 'cohorts' } }, files)

  it('orders modules as the README links them, with its names', () => {
    expect(o.modules.map((m) => m.title)).toEqual(['Introduction', 'Module 2: Warehouses', 'Module 1: Docker'])
  })
  it('opens a module with its README, then lessons in natural order, then the latest homework', () => {
    const docker = o.modules[2]
    expect(docker.lessons.map((l) => l.path)).toEqual(['01-docker/README.md', '01-docker/01-intro.md', '01-docker/02-compose.md', 'cohorts/2026/01-docker/homework.md'])
    expect(docker.lessons[1].title).toBe('Why Docker')
    expect(docker.lessons[3].kind).toBe('homework')
    expect(docker.code).toEqual(['01-docker/ingest.py'])
  })
  it('tells notebooks apart and leaves out translations, hidden folders and meta files', () => {
    const all = o.modules.flatMap((m) => m.lessons.map((l) => l.path))
    expect(o.modules[1].lessons.find((l) => l.path.endsWith('.ipynb'))?.kind).toBe('notebook')
    expect(all.some((p) => p.includes('translations') || p.startsWith('.tmp') || p === 'CONTRIBUTING.md')).toBe(false)
    expect(o.lessons).toBe(all.length)
  })
  it('reads an mdBook in its SUMMARY.md order', () => {
    const book = buildOutline({ ...base, root: 'src' }, [
      { path: 'src/SUMMARY.md', text: '# Book\n\n- [Getting started](ch01.md)\n  - [Install](ch01-01.md)\n- [Ownership](ch02.md)\n' },
      { path: 'src/ch02.md', text: `# Ownership\n\n${words(100)}` },
      { path: 'src/ch01.md', text: `# Getting started\n\n${words(100)}` },
      { path: 'src/ch01-01.md', text: `# Installation\n\n${words(100)}` }
    ])
    expect(book.modules.map((m) => [m.title, m.lessons.map((l) => l.title)])).toEqual([
      ['Getting started', ['Getting started', 'Install']],
      ['Ownership', ['Ownership']]
    ])
  })
  it('groups a flat course in sets of up to eight, in natural order', () => {
    const flat = buildOutline({ ...base }, Array.from({ length: 11 }, (_, i) => ({ path: `part${i + 1}.md`, text: `# Part ${i + 1}\n\n${words(60)}` })))
    expect(flat.modules.map((m) => m.lessons.length)).toEqual([6, 5])
    expect(flat.modules[0].lessons[1].path).toBe('part2.md')
    expect(['part2', 'part10'].sort(natural)).toEqual(['part2', 'part10'])
  })
  it('honours skip rules by prefix, name and pattern', () => {
    const c = { ...base, root: 'docs', skip: ['docs/old', 'setup', '/^poster/'] }
    expect(inCourse(c, 'docs/a.md')).toBe(true)
    expect(inCourse(c, 'docs/old/a.md')).toBe(false)
    expect(inCourse(c, 'docs/setup.md')).toBe(false)
    expect(inCourse(c, 'docs/poster-2018.md')).toBe(false)
    expect(inCourse(c, 'other/a.md')).toBe(false)
  })
})

describe('a course in one long file', () => {
  const md = `# Primer\n\nintro\n\n## Contents\n\n- a\n\n## Caching\n\n${words(80)}\n\n### Client caching\n\n${words(20)}\n\n## Databases\n\n${words(500)}\n\n### Replication\n\n${words(400)}\n\n### Sharding\n\n${words(400)}\n\n### Tiny\n\n${words(10)}\n\n## License\n\n${words(100)}\n`
  const o = splitOutline(md, 'README.md')
  it('makes modules of the top headings, cuts long ones into lessons, and keeps each lesson’s place', () => {
    expect(o.modules.map((m) => m.title)).toEqual(['Caching', 'Databases'])
    expect(o.modules[0].lessons.map((l) => l.title)).toEqual(['Caching'])
    expect(o.modules[1].lessons.map((l) => l.title)).toEqual(['Databases', 'Replication', 'Sharding'])
    const sharding = o.modules[1].lessons[2]
    const text = md.slice(sharding.range![0], sharding.range![1])
    expect(text.startsWith('### Sharding')).toBe(true)
    // A small heading stays inside the lesson before it
    expect(text).toContain('### Tiny')
    expect(text).not.toContain('## License')
  })
})

describe('a lesson’s sections', () => {
  it('cuts at headings, leaves out signposts, and every section is a slice of the text', () => {
    const md = `---\ntitle: X\n---\n# Running Postgres\n\n${words(60)}\n\n## In a container\n\n${words(120)}\n\n## Connecting\n\n${words(90)}\n\n## Resources\n\n- [a](b)\n`
    const secs = lessonSections(md, 'Running Postgres')
    expect(secs.map((s) => s.title)).toEqual(['Running Postgres', 'In a container', 'Connecting'])
    for (const s of secs) expect(faithful(md.slice(s.start, s.end), md)).toBe(true)
    expect(md.slice(secs[1].start, secs[1].end).startsWith('## In a container')).toBe(true)
  })
  it('cuts a long section into parts at paragraphs, never inside code', () => {
    const para = words(150)
    const md = `## Long\n\n${para}\n\n${para}\n\n\`\`\`python\n${'x = 1\n\n'.repeat(40)}\`\`\`\n\n${para}\n\n${para}\n\n${para}\n`
    const secs = lessonSections(md, 'L')
    expect(secs.length).toBeGreaterThan(1)
    expect(secs[0].title).toBe('Long (part 1)')
    for (const s of secs) expect((md.slice(s.start, s.end).match(/```/g) ?? []).length % 2).toBe(0)
  })
  it('keeps at most ten steps, with unique names', () => {
    const md = Array.from({ length: 14 }, (_, i) => `## Step ${i % 3}\n\n${words(40)}`).join('\n\n')
    const secs = lessonSections(md, 'L')
    expect(secs.length).toBeLessThanOrEqual(10)
    expect(new Set(secs.map((s) => s.title)).size).toBe(secs.length)
  })
  it('finds the section a plan step names, by name, by its words, or by its place', () => {
    const secs = [
      { title: 'Why Docker?', start: 0, end: 1, words: 1 },
      { title: 'Volumes and bind mounts', start: 1, end: 2, words: 1 },
      { title: 'Cleanup', start: 2, end: 3, words: 1 }
    ]
    expect(sectionFor(secs, 'why docker', 2)?.title).toBe('Why Docker?')
    expect(sectionFor(secs, 'Bind mounts versus volumes', 0)?.title).toBe('Volumes and bind mounts')
    expect(sectionFor(secs, 'Something else entirely', 2)?.title).toBe('Cleanup')
  })
})

describe('notebooks, links and titles', () => {
  it('reads a notebook as Markdown with runnable code and its text output', () => {
    const nb = JSON.stringify({
      metadata: { language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# Bigrams\n', 'Counting pairs.'] },
        { cell_type: 'code', source: 'print(2 + 2)', outputs: [{ output_type: 'stream', name: 'stdout', text: ['4\n'] }] },
        { cell_type: 'code', source: 'plot()', outputs: [{ output_type: 'display_data', data: { 'image/png': 'xx', 'text/plain': '<Figure>' } }] }
      ]
    })
    const md = notebookMarkdown(nb)!
    expect(md).toContain('# Bigrams\nCounting pairs.')
    expect(md).toContain('```python\nprint(2 + 2)\n```')
    expect(md).toContain('```output\n4\n```')
    expect(md).not.toContain('<Figure>')
    expect(notebookMarkdown('not json')).toBeNull()
    expect(titleOf(md, 'a/makemore_part1.ipynb')).toBe('Bigrams')
  })
  it('points relative links and pictures at GitHub', () => {
    const md = absolutise('![d](images/a.png) [next](../02-x/README.md) [ext](https://x.org) [top](#h) <img src="b.jpg">', base, '01-docker/lesson.md')
    expect(md).toContain('![d](https://raw.githubusercontent.com/someone/course/main/01-docker/images/a.png)')
    expect(md).toContain('[next](https://github.com/someone/course/blob/main/02-x/README.md)')
    expect(md).toContain('[ext](https://x.org)')
    expect(md).toContain('[top](#h)')
    expect(md).toContain('<img src="https://raw.githubusercontent.com/someone/course/main/01-docker/b.jpg">')
  })
})

describe('suggesting and progress', () => {
  it('suggests courses that teach what you want to learn', () => {
    expect(suggestCourses('I want to learn data engineering').map((c) => c.area)).toContain('data')
    expect(suggestCourses('teach me rust').some((c) => c.id === 'rust-book')).toBe(true)
    expect(suggestCourses('mlops and model deployment')[0].area).toBe('mlops')
    expect(suggestCourses('Russian novels')).toEqual([])
  })
  it('counts a module’s progress and finds where to carry on', () => {
    const o = buildOutline({ ...base }, [
      { path: 'a.md', text: `# A\n\n${words(60)}` },
      { path: 'b.md', text: `# B\n\n${words(60)}` },
      { path: 'c.md', text: `# C\n\n${words(60)}` }
    ])
    const p = { 'a.md': { started: 1, updated: 2, done: true, right: 1, partly: 0, wrong: 0 }, 'c.md': { started: 1, updated: 2, done: false, right: 0, partly: 0, wrong: 1 } }
    expect(moduleProgress(o.modules[0], p)).toEqual({ done: 1, started: 1, total: 3 })
    expect(nextLesson(o, p)?.lesson.path).toBe('c.md')
    expect(nextLesson(o, {})?.lesson.path).toBe('a.md')
  })
})

describe('teaching from a course', () => {
  const ref = { id: 'de-zoomcamp', title: 'Data Engineering Zoomcamp', by: 'DataTalksClub', lesson: '01/04.md', lessonTitle: 'Running PostgreSQL with Docker', kind: 'reading' as const, steps: ['Running PostgreSQL in a Container', 'Connecting to PostgreSQL'], url: 'https://github.com/x/y/blob/main/01/04.md', licence: 'None stated' }
  it('tells the tutor to plan in the course’s sections and not to re-teach the reading', () => {
    const t = sessionInstructions({ mode: 'teach', topic: 'Running PostgreSQL with Docker', options: { course: ref } })
    expect(t).toContain('<plan>\n- Running PostgreSQL in a Container\n- Connecting to PostgreSQL\n</plan>')
    expect(t).toContain('never to re-explain')
    expect(t).not.toContain('**Why this matters**')
    expect(courseRules({ ...ref, kind: 'homework' })).toContain('HOMEWORK')
    // Taught in the course's order: the strategy router stays out of it
    expect(strategyChoice({ mode: 'teach', topic: 'x', options: { course: ref } }, { kind: 'none' })).toBeNull()
  })
  it('shows a step’s section word for word, sealed, as a reading from the course', () => {
    const md = `# Running PostgreSQL with Docker\n\n${words(50, 'intro')}\n\n## Running PostgreSQL in a Container\n\n${words(120, 'container')}\n\n## Connecting to PostgreSQL\n\n${words(800, 'connect')}\n`
    const sections = lessonSections(md, 'Running PostgreSQL with Docker')
    const candidate = { kind: 'course' as const, title: 'Running PostgreSQL with Docker', by: 'Data Engineering Zoomcamp · DataTalksClub', url: ref.url, licence: 'None stated', fetchedAt: Date.UTC(2026, 10, 11), text: md, format: 'md' as const }
    const r = courseReading({ candidate, sections }, 0, 'Running PostgreSQL in a Container', 'Postgres')!
    expect(r.kind).toBe('course')
    expect(r.text.startsWith('## Running PostgreSQL in a Container')).toBe(true)
    expect(r.text).toContain('container6')
    expect(faithful(r.text, md)).toBe(true)
    const back = parseReading(readingBlock(r).replace(/^```reading\n|\n```$/g, ''))!
    expect(back.sealed).toBe(true)
    expect(back.reading.kind).toBe('course')
    // A long section is cut to a reading's length, still the source's words
    const long = courseReading({ candidate, sections }, 1, 'Connecting', 'Postgres')!
    expect((long.text.match(/\S+/g) ?? []).length).toBeLessThanOrEqual(620)
    expect(faithful(long.text, md)).toBe(true)
    expect(authorityOf({ kind: 'course' })).toBeGreaterThan(0.8)
    expect(licenceScore({ kind: 'course' })).toBe(1)
  })
})
