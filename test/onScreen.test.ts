import { describe, expect, it } from 'vitest'
import { describeScreen, screenLabel, transcriptAround } from '../src/shared/onScreen'
import { lineAt, type Line } from '../src/shared/video'

const lines: Line[] = Array.from({ length: 40 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `line ${i}` }))

describe('the transcript beside the player, in sync', () => {
  it('marks the line being spoken at any moment (between lines, at the edges)', () => {
    expect(lineAt(lines, 0)).toBe(0)
    expect(lineAt(lines, 12.4)).toBe(2)
    expect(lineAt(lines, 15)).toBe(3)
    expect(lineAt(lines, 10_000)).toBe(39)
  })

  it('gives the tutor what is said around the moment, the current line marked', () => {
    const around = transcriptAround(lines, 100, 10, 6)
    expect(around.split('\n')).toEqual(['[1:30] line 18', '[1:35] line 19', '[1:40] ▶ line 20', '[1:45] line 21'])
    expect(transcriptAround([], 10)).toBe('')
  })
})

describe('what the tutor sees on screen', () => {
  it('describes the course page, the section in view, the video’s moment and a selection', () => {
    const s = describeScreen({
      kind: 'course-lesson',
      title: 'Experiment tracking',
      course: { id: 'mlops-zoomcamp', title: 'MLOps Zoomcamp', module: 'Module 2', lesson: 'Experiment tracking' },
      path: '02-experiment-tracking/README.md',
      section: 'MLflow',
      excerpt: 'MLflow is an open source platform',
      video: { id: 'dQw4w9WgXcQ', title: 'MLflow intro', at: 760, playing: true, around: '[12:40] ▶ we log params' },
      selection: 'mlflow.log_param'
    })
    expect(s).toContain('The course “MLOps Zoomcamp”, Module 2, lesson “Experiment tracking”')
    expect(s).toContain('the section “MLflow”')
    expect(s).toContain('playing at 12:40')
    expect(s).toContain('[12:40] ▶ we log params')
    expect(s).toContain('They selected:\n"""\nmlflow.log_param')
    // A selection is what they mean: the section's text isn't sent as well
    expect(s).not.toContain('open source platform')
    expect(screenLabel({ kind: 'article', title: 'Tracking', section: 'Runs', video: { id: 'x', at: 61, playing: false } })).toBe('Tracking · Runs · 1:01')
    expect(describeScreen(null)).toBe('')
  })
})
