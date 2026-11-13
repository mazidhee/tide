/**
 * A coding lesson's files, on the lesson's side (shared/lessonCode, main/ide/lesson). The answer
 * editor is a file of the lesson's folder: what's typed is saved to it (so the tutor's tools read
 * and run what the learner sees), a file the tutor opens or plants a bug in is loaded into it, and
 * the tutor's proposals and review comments arrive here for the lesson to show.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LessonCodeEvent, ProblemReport, Proposal, ReviewComment, Workspace } from '@shared/ide'

interface Options {
  on: boolean
  labId: string
  topic: string
  /** A linked project's folder */
  linkedRoot?: string
  /** The current code question's own file (exercise-N) */
  exercise: string | null
  code: string
  setCode(text: string): void
  /** A turn is being written: a file the tutor opens now is the one the next question is answered in */
  busy: boolean
}

export interface LessonCode {
  ws: Workspace | null
  /** The file the editor shows */
  file: string | null
  proposals: Proposal[]
  comments: ReviewComment[]
  reveal: { line: number; nonce: number } | null
  dismissComment(id: string): void
  /** The text the proposal's file has now (the editor's, when it's the file on screen) */
  currentOf(p: Proposal): string | null
  resolve(p: Proposal, text: string | null): Promise<void>
  /** A new code question: false when the tutor opened a file for it, which the editor keeps */
  newExercise(): boolean
  /** Back to the current question's own file */
  backToExercise(): void
  problems(list: ProblemReport[]): void
  /** Saved now (before a message is sent, or the IDE opens it) */
  flush(): Promise<void>
}

const WRITE_MS = 350

export function useLessonCode(o: Options): LessonCode {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const file = o.on ? (opened ?? o.exercise) : null
  const root = ws?.root ?? null
  const ref = useRef(o)
  ref.current = o
  // The file the tutor worked on while writing (opened, planted, commented on, proposed for): the
  // question it then asks is answered in it, so the learner's code and the comments stay on screen
  const turnFile = useRef<string | null>(null)
  useEffect(() => {
    if (o.busy) turnFile.current = null
  }, [o.busy])
  // The file whose text on disk has been read into the editor: only then is the editor saved over it
  const loaded = useRef<string | null>(null)

  useEffect(() => {
    if (!o.on) return
    let live = true
    window.tide.ide.lesson
      .open(o.labId, o.topic, o.linkedRoot)
      .then((w) => live && setWs(w))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [o.on, o.labId, o.topic, o.linkedRoot])

  // The file on screen: what's on disk is read in (a lesson picked up again, a file the tutor opened)
  useEffect(() => {
    if (!root || !file) return
    let live = true
    loaded.current = null
    window.tide.ide
      .read(root, file)
      .then((r) => {
        if (!live) return
        loaded.current = file
        if (!r.binary && !r.tooLarge && r.text && r.text !== ref.current.code) ref.current.setCode(r.text)
        else if (!r.text && ref.current.code) save(root, file)
      })
      .catch(() => {
        if (!live) return
        // Not written yet: a new question's starter is saved as its file
        loaded.current = file
        if (ref.current.code) save(root, file)
      })
    return () => {
      live = false
    }
  }, [root, file])

  // What's typed is saved to the file, a moment after
  const pending = useRef<{ root: string; file: string; text: string } | null>(null)
  const write = useCallback(async () => {
    const p = pending.current
    pending.current = null
    if (p) await window.tide.ide.write(p.root, p.file, p.text).catch(() => {})
  }, [])
  const save = (r: string, f: string) => {
    pending.current = { root: r, file: f, text: ref.current.code }
    void write()
  }
  useEffect(() => {
    // Another file on screen: the last one's typing is saved first
    if (pending.current && pending.current.file !== file) void write()
    if (!root || !file || loaded.current !== file) return
    // An empty editor on a file never written isn't worth a file
    if (!o.code && !texts[file]) return
    pending.current = { root, file, text: o.code }
    setTexts((t) => (t[file] === o.code ? t : { ...t, [file]: o.code }))
    const t = setTimeout(() => void write(), WRITE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.code, root, file])

  // The tutor's tools
  useEffect(() => {
    if (!o.on) return
    return window.tide.ide.lesson.onEvent((e: LessonCodeEvent) => {
      if (e.labId !== ref.current.labId) return
      const path = e.type === 'proposal' ? e.proposal.path : e.type === 'comment' ? e.comment.path : e.type === 'opened' ? e.path : null
      if (path && ref.current.busy) turnFile.current = path
      if (e.type === 'proposal') setProposals((ps) => [...ps.filter((x) => x.id !== e.proposal.id), e.proposal])
      else if (e.type === 'comment') setComments((cs) => [...cs, e.comment])
      else if (e.type === 'opened') {
        setOpened(e.path === ref.current.exercise ? null : e.path)
        if (e.planted && e.path === fileRef.current) {
          // The same file, changed under the editor: read it again
          void window.tide.ide.read(e.root, e.path).then((r) => !r.binary && ref.current.setCode(r.text)).catch(() => {})
        }
        if (e.line) setReveal({ line: e.line, nonce: Date.now() })
      } else if (e.type === 'applied' && e.path === fileRef.current) {
        void window.tide.ide.read(e.root, e.path).then((r) => !r.binary && ref.current.setCode(r.text)).catch(() => {})
      }
    })
  }, [o.on])
  const fileRef = useRef(file)
  fileRef.current = file

  const flush = useCallback(async () => {
    const f = fileRef.current
    if (root && f && loaded.current === f) pending.current = { root, file: f, text: ref.current.code }
    await write()
  }, [root, write])

  const resolve = useCallback(
    async (p: Proposal, text: string | null) => {
      if (text !== null) {
        await window.tide.ide.write(p.root, p.path, text)
        if (p.path === fileRef.current) ref.current.setCode(text)
      }
      await window.tide.ide.pair.resolve(p.id, text).catch(() => {})
      setProposals((ps) => ps.filter((x) => x.id !== p.id))
      // A comment on a line the kept change moved no longer points at it
      if (text !== null) setComments((cs) => cs.filter((c) => c.path !== p.path))
    },
    []
  )

  const report = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const problems = useCallback(
    (list: ProblemReport[]) => {
      const f = fileRef.current
      if (!root || !f) return
      clearTimeout(report.current)
      report.current = setTimeout(() => window.tide.ide.pair.problems(root, list.map((p) => ({ ...p, path: f }))), 300)
    },
    [root]
  )

  return {
    ws,
    file,
    proposals: root ? proposals.filter((p) => p.root === root) : [],
    comments: root && file ? comments.filter((c) => c.root === root && c.path === file) : [],
    reveal,
    dismissComment: (id) => setComments((cs) => cs.filter((c) => c.id !== id)),
    currentOf: (p) => (p.path === file ? o.code : (texts[p.path] ?? null)),
    resolve,
    newExercise: () => {
      const keep = turnFile.current
      turnFile.current = null
      if (keep && keep !== o.exercise) {
        setOpened(keep)
        return false
      }
      setOpened(null)
      return true
    },
    backToExercise: () => setOpened(null),
    problems,
    flush
  }
}
