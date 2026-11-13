import type { View } from '../state'

const base = (p: string) => (p.split('/').filter(Boolean).pop() ?? p).replace(/\.(md|pdf|epub)$/i, '')

const NAMES: Partial<Record<View['kind'], string>> = {
  home: 'Home',
  library: 'Library',
  reading: 'Reading',
  graph: 'What you know',
  study: 'Flashcards',
  daily: 'Daily practice',
  lessons: 'Past lessons',
  learn: 'Learn',
  practice: 'Practice',
  workshop: 'Projects',
  'new-topic': 'New topic',
  courses: 'Courses',
  chat: 'Chat',
  lab: 'Lab',
  coach: 'Your week',
  learner: 'Your profile',
  wrapup: 'Wrap-up',
  weekly: 'Your week',
  drill: 'Drill',
  maths: 'Mental maths',
  workout: 'Workout',
  design: 'System design',
  code: 'Code',
  help: 'Guide',
  exam: 'Exam',
  settings: 'Settings',
  mock: 'Mock'
}

/**
 * Where the learner is, as the bug line says it: the view, and the lesson, notebook, note or
 * book it's on ("Lesson: Bayes’ theorem", "Notebook: Payments", "Settings › Backups").
 */
export function viewLabel(view: View, settingsLabel?: (section: string) => string | undefined): string {
  switch (view.kind) {
    case 'session': {
      const kind = view.mode === 'quiz' ? 'Quiz' : view.mode === 'interview' ? 'Interview' : 'Lesson'
      return view.topic ? `${kind}: ${view.topic}` : kind
    }
    case 'file':
      return `Note: ${base(view.path)}`
    case 'notebook':
      return `Notebook: ${base(view.path)}`
    case 'reader':
      return `Reader: ${base(view.path)}`
    case 'exam':
      return view.topic ? `Exam: ${view.topic}` : 'Exam'
    case 'code':
      return view.root || view.path ? `Code: ${base(view.root ?? view.path ?? '')}` : 'Code'
    case 'courses':
      return view.id ? `Course: ${view.id}${view.lesson ? ` › ${base(view.lesson)}` : ''}` : 'Courses'
    case 'workshop':
      return view.id ? `Project: ${view.id}` : 'Projects'
    case 'settings': {
      const label = view.section ? settingsLabel?.(view.section) : undefined
      return label ? `Settings › ${label}` : 'Settings'
    }
    case 'mock':
      return view.mode === 'exam' ? 'Mock exam' : 'Mock interview'
    case 'design':
      return view.topic ? `System design: ${view.topic}` : 'System design'
    default:
      return NAMES[view.kind] ?? view.kind
  }
}
