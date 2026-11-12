import { describe, expect, it } from 'vitest'
import { canGoBack, canGoForward, codeLanguage, currentPage, emptyHistory, fileKind, goBack, goForward, parseGithub, prefersWebView, pushPage, repoRelative, routeLink, sameTarget, targetUrl, webAllowed, type LinkTarget } from '../src/shared/links'

const courses = [
  { id: 'mlops-zoomcamp', repo: 'DataTalksClub/mlops-zoomcamp', branch: 'main' },
  { id: 'made-with-ml', repo: 'GokuMohandas/Made-With-ML', branch: 'main' }
]
const inLesson = { courses, base: { course: 'mlops-zoomcamp', path: '02-experiment-tracking/README.md' } }

describe('link routing: nothing leaves Tide', () => {
  it('sends a relative link to the file in the same course repository', () => {
    expect(routeLink('mlflow_on_aws.md', inLesson)).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: '02-experiment-tracking/mlflow_on_aws.md' })
    expect(routeLink('../03-orchestration/homework.md#q1', inLesson)).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: '03-orchestration/homework.md', anchor: 'q1' })
    expect(routeLink('images/flow.png', inLesson)).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: '02-experiment-tracking/images/flow.png' })
    expect(routeLink('/README.md', inLesson)).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: 'README.md' })
    // Never above the repository's root
    expect(routeLink('../../../../etc/passwd', inLesson)).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: 'etc/passwd' })
  })

  it('sends a GitHub link into an imported course to the course, and into any other repository to Tide’s reader of it', () => {
    expect(routeLink('https://github.com/DataTalksClub/mlops-zoomcamp/blob/main/04-deployment/README.md', { courses })).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: '04-deployment/README.md' })
    expect(routeLink('https://github.com/datatalksclub/MLOPS-zoomcamp/tree/main/04-deployment', { courses })).toEqual({ kind: 'course-file', course: 'mlops-zoomcamp', path: '04-deployment' })
    expect(routeLink('https://raw.githubusercontent.com/GokuMohandas/Made-With-ML/main/notebooks/madewithml.ipynb', { courses })).toEqual({ kind: 'course-file', course: 'made-with-ml', path: 'notebooks/madewithml.ipynb' })
    expect(routeLink('https://github.com/mlflow/mlflow/blob/master/docs/README.md#build', { courses })).toEqual({ kind: 'github-file', repo: 'mlflow/mlflow', ref: 'master', path: 'docs/README.md', anchor: 'build' })
    expect(routeLink('https://github.com/mlflow/mlflow', { courses })).toEqual({ kind: 'github-file', repo: 'mlflow/mlflow', ref: 'HEAD', path: '' })
    // An issue or a pull request isn't a file: it's a web page
    expect(routeLink('https://github.com/mlflow/mlflow/issues/12', { courses })).toEqual({ kind: 'web', url: 'https://github.com/mlflow/mlflow/issues/12' })
  })

  it('plays YouTube in Tide’s player, at the moment the link names', () => {
    expect(routeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=760s', { courses })).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ', t: 760 })
    expect(routeLink('https://youtu.be/dQw4w9WgXcQ', { courses })).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('opens any other page in the reader view, and never follows javascript:, file: or data: links', () => {
    expect(routeLink('https://mlflow.org/docs/latest/tracking.html', { courses })).toEqual({ kind: 'web', url: 'https://mlflow.org/docs/latest/tracking.html' })
    expect(routeLink('//example.com/a', { courses })).toEqual({ kind: 'web', url: 'https://example.com/a' })
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'vault://x', 'chrome://settings']) expect(routeLink(bad, { courses })).toBeNull()
    expect(routeLink('mailto:a@b.c', { courses })).toEqual({ kind: 'system', url: 'mailto:a@b.c' })
    expect(routeLink('#setup', { courses })).toEqual({ kind: 'anchor', id: 'setup' })
    // A note's own relative links are the note's business
    expect(routeLink('Other note.md', { courses })).toBeNull()
  })

  it('falls back to the web view for apps rather than articles', () => {
    expect(prefersWebView('https://colab.research.google.com/github/x/y/blob/main/a.ipynb')).toBe(true)
    expect(prefersWebView('https://huggingface.co/spaces/abc/demo')).toBe(true)
    expect(prefersWebView('https://huggingface.co/docs/transformers')).toBe(false)
    expect(prefersWebView('https://en.wikipedia.org/wiki/MLOps')).toBe(false)
    expect(webAllowed('https://a.b/c')).toBe(true)
    expect(webAllowed('file:///a')).toBe(false)
    expect(webAllowed('javascript:void(0)')).toBe(false)
  })

  it('reads GitHub addresses and relative paths', () => {
    expect(parseGithub('https://github.com/a/b.git')).toEqual({ repo: 'a/b', path: '' })
    expect(parseGithub('https://github.com/a/b/blob/v1.2/x%20y/z.md')).toEqual({ repo: 'a/b', ref: 'v1.2', path: 'x y/z.md' })
    expect(parseGithub('https://gitlab.com/a/b')).toBeNull()
    expect(repoRelative('a/b/c.md', './d/../e.md?raw=1#top')).toEqual({ path: 'a/b/e.md', anchor: 'top' })
  })

  it('knows what a repository file is', () => {
    expect(['a.md', 'b.ipynb', 'c.py', 'd.png', 'e.pdf', 'f.csv', 'Dockerfile', 'LICENSE', 'g.bin'].map(fileKind)).toEqual(['markdown', 'notebook', 'code', 'image', 'pdf', 'csv', 'code', 'text', 'binary'])
    expect(codeLanguage('x/train.py')).toBe('python')
    expect(codeLanguage('docker-compose.yml')).toBe('yaml')
  })

  it('gives "Open in browser" the page a target is on', () => {
    expect(targetUrl({ kind: 'course-file', course: 'mlops-zoomcamp', path: '01-intro/README.md' }, courses)).toBe('https://github.com/DataTalksClub/mlops-zoomcamp/blob/main/01-intro/README.md')
    expect(targetUrl({ kind: 'youtube', id: 'dQw4w9WgXcQ', t: 12.7 }, courses)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s')
  })
})

describe('back and forward within the course', () => {
  const a: LinkTarget = { kind: 'web', url: 'https://a.example/' }
  const b: LinkTarget = { kind: 'youtube', id: 'dQw4w9WgXcQ' }
  const c: LinkTarget = { kind: 'course-file', course: 'x', path: 'y.md' }
  it('moves like a browser: back to the lesson underneath, forward again, a new page drops what was forward', () => {
    let h = emptyHistory<LinkTarget>()
    expect(canGoBack(h)).toBe(false)
    h = pushPage(h, a, sameTarget)
    h = pushPage(h, b, sameTarget)
    expect(currentPage(h)).toEqual(b)
    h = goBack(h)
    expect(currentPage(h)).toEqual(a)
    expect(canGoForward(h)).toBe(true)
    h = goBack(h)
    expect(currentPage(h)).toBeNull()
    h = goForward(h)
    h = pushPage(h, c, sameTarget)
    expect(h.pages).toEqual([a, c])
    expect(canGoForward(h)).toBe(false)
    // The same page again isn't stacked twice
    h = pushPage(h, { ...c, anchor: 'part-2' } as LinkTarget, sameTarget)
    expect(h.pages.length).toBe(2)
  })
})
