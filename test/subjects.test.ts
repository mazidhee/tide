import { describe, expect, it } from 'vitest'
import { HANDS_ON, sessionInstructions, WHY_RULES } from '../src/shared/session'
import { SUBJECTS, SUBJECT_KINDS, type SubjectKind } from '../src/shared/subjectMap'
import { kindsFrom, lessonKit, parseModelProfile, phaseWorkLine, preferredAreas, profileSubject, PROFILE_SCHEMA, roadmapGuidance, TOOLKITS, toolkitText, wordCount } from '../src/shared/subjects'
import { TRUSTED, UNCHECKED_TRUSTED, trustedSite } from '../src/shared/trustedSources'
import { phasesForTasks, planFrontmatter } from '../src/shared/plan'

/** A topic in each subject, and the kind it must be profiled as first: over 150 subjects across every field */
const TABLE: [string, SubjectKind][] = [
  ["Python decorators", 'build'],
  ["TypeScript generics", 'build'],
  ["React hooks", 'build'],
  ["HTML and CSS layout", 'build'],
  ["REST APIs with FastAPI", 'build'],
  ["Pointers in C", 'build'],
  ["Move semantics in C++", 'build'],
  ["Rust ownership and borrowing", 'build'],
  ["Goroutines and channels", 'build'],
  ["SwiftUI views", 'build'],
  ["Java generics", 'build'],
  ["Ruby on Rails", 'build'],
  ["Haskell type classes", 'build'],
  ["Bash scripting", 'build'],
  ["Git branching", 'build'],
  ["SQL window functions", 'build'],
  ["Postgres query optimisation", 'build'],
  ["Build my own database", 'build'],
  ["LSM trees", 'build'],
  ["Data pipelines with Airflow", 'build'],
  ["Kafka consumers", 'build'],
  ["Raft consensus", 'build'],
  ["Consistency models", 'build'],
  ["Virtual memory and paging", 'build'],
  ["File systems", 'build'],
  ["Assembly language", 'build'],
  ["CPU caches", 'build'],
  ["Writing a compiler", 'build'],
  ["Parsing and abstract syntax trees", 'build'],
  ["TCP congestion control", 'build'],
  ["DNS resolution", 'build'],
  ["Web security and XSS", 'build'],
  ["Docker and Kubernetes", 'build'],
  ["Terraform", 'build'],
  ["System design: load balancing", 'build'],
  ["Smart contracts in Solidity", 'build'],
  ["Game development with Godot", 'build'],
  ["Collision detection", 'build'],
  ["Entity component systems", 'build'],
  ["Shaders and rasterization", 'build'],
  ["CUDA kernels", 'build'],
  ["Arduino and microcontrollers", 'build'],
  ["Building agents with tool calling", 'build'],
  ["Dynamic programming", 'build'],
  ["Hash tables", 'build'],
  ["Neural networks", 'quant'],
  ["Backpropagation", 'quant'],
  ["Reinforcement learning", 'quant'],
  ["Large language models", 'quant'],
  ["Calculus: derivatives", 'quant'],
  ["Differential equations", 'quant'],
  ["Real analysis", 'quant'],
  ["Group theory", 'quant'],
  ["Number theory", 'quant'],
  ["Combinatorics", 'quant'],
  ["Graph theory", 'quant'],
  ["Trigonometry", 'quant'],
  ["Linear algebra: eigenvalues", 'quant'],
  ["Singular value decomposition", 'quant'],
  ["Bayes' theorem", 'quant'],
  ["Hypothesis testing and p-values", 'quant'],
  ["Linear regression", 'quant'],
  ["Markov chains", 'quant'],
  ["A/B testing", 'quant'],
  ["Causal inference", 'quant'],
  ["Data science with pandas", 'quant'],
  ["Projectile motion", 'quant'],
  ["Newton's laws", 'quant'],
  ["Simple harmonic motion", 'quant'],
  ["Lagrangian mechanics", 'quant'],
  ["Orbital mechanics", 'quant'],
  ["Fluid mechanics", 'quant'],
  ["Electric fields and Gauss's law", 'quant'],
  ["Faraday's law of induction", 'quant'],
  ["RC circuits", 'quant'],
  ["Quantum mechanics basics", 'quant'],
  ["Special relativity", 'quant'],
  ["Thermodynamics and entropy", 'quant'],
  ["Optics", 'quant'],
  ["Cosmology", 'quant'],
  ["Stoichiometry", 'quant'],
  ["Acids and bases", 'quant'],
  ["Organic chemistry: SN1 and SN2 reactions", 'quant'],
  ["Electrochemistry", 'quant'],
  ["Chemical kinetics", 'quant'],
  ["Spectroscopy and NMR", 'quant'],
  ["Microeconomics: elasticity", 'quant'],
  ["Macroeconomics: monetary policy", 'quant'],
  ["Game theory", 'quant'],
  ["Econometrics", 'quant'],
  ["Inflation and interest rates", 'quant'],
  ["Corporate finance: NPV and IRR", 'quant'],
  ["Options pricing with Black-Scholes", 'quant'],
  ["Portfolio theory and CAPM", 'quant'],
  ["Fixed income and yield curves", 'quant'],
  ["Epidemiology: odds ratios", 'quant'],
  ["SIR models", 'quant'],
  ["Control theory", 'quant'],
  ["Signal processing", 'quant'],
  ["Information theory", 'quant'],
  ["Turing machines and computability", 'quant'],
  ["Propositional logic", 'quant'],
  ["Linear programming", 'quant'],
  ["Mendelian genetics", 'quant'],
  ["Cell biology", 'quant'],
  ["Evolution by natural selection", 'quant'],
  ["Neuroscience", 'quant'],
  ["Immunology", 'quant'],
  ["Photosynthesis", 'quant'],
  ["Bioinformatics", 'quant'],
  ["Cognitive psychology", 'narrative'],
  ["Pharmacology", 'domain'],
  ["Cardiology", 'domain'],
  ["Core banking: ledgers", 'domain'],
  ["Clearing and settlement", 'domain'],
  ["ISO 20022 messages", 'domain'],
  ["SEPA payments", 'domain'],
  ["Correspondent banking", 'domain'],
  ["Anti-money laundering and KYC", 'domain'],
  ["Basel III capital requirements", 'domain'],
  ["Reconciliation", 'domain'],
  ["Card schemes and interchange", 'domain'],
  ["Double-entry bookkeeping", 'domain'],
  ["Financial statements", 'domain'],
  ["IFRS 16 leases", 'domain'],
  ["Revenue recognition", 'domain'],
  ["Auditing", 'domain'],
  ["Contract law: offer and acceptance", 'domain'],
  ["Tort law: negligence", 'domain'],
  ["Criminal law", 'domain'],
  ["Constitutional law", 'domain'],
  ["GDPR", 'domain'],
  ["Intellectual property and copyright", 'domain'],
  ["Product management", 'domain'],
  ["Product analytics: funnels", 'domain'],
  ["Retention cohorts in Mixpanel", 'domain'],
  ["Actuarial science", 'domain'],
  ["Credit risk", 'domain'],
  ["Mortgages", 'domain'],
  ["Instructional design", 'domain'],
  ["Research methods", 'domain'],
  ["Learn Spanish", 'domain'],
  ["Japanese vocabulary", 'domain'],
  ["Negotiation", 'domain'],
  ["Kant's categorical imperative", 'interpret'],
  ["Philosophy of mind", 'interpret'],
  ["Epistemology", 'interpret'],
  ["Stoicism", 'interpret'],
  ["Existentialism", 'interpret'],
  ["Utilitarianism", 'interpret'],
  ["Plato's Republic", 'interpret'],
  ["Close reading of Hamlet", 'interpret'],
  ["Poetry", 'interpret'],
  ["Literary theory", 'interpret'],
  ["Dostoevsky", 'interpret'],
  ["Systematic theology", 'interpret'],
  ["The Gospels", 'interpret'],
  ["Political theory: the social contract", 'interpret'],
  ["Rawls's theory of justice", 'interpret'],
  ["Phonology", 'interpret'],
  ["Syntax and semantics", 'interpret'],
  ["Film theory", 'interpret'],
  ["Ancient Greek tragedy", 'interpret'],
  ["Art history: Impressionism", 'interpret'],
  ["World history", 'narrative'],
  ["The causes of the First World War", 'narrative'],
  ["The Cold War", 'narrative'],
  ["The French Revolution", 'narrative'],
  ["The Industrial Revolution", 'narrative'],
  ["The Roman Empire", 'narrative'],
  ["The Ottoman Empire", 'narrative'],
  ["Decolonisation", 'narrative'],
  ["The Atlantic slave trade", 'narrative'],
  ["History of mathematics", 'narrative'],
  ["History of computing", 'narrative'],
  ["Geopolitics of the Middle East", 'narrative'],
  ["International relations", 'narrative'],
  ["Biography of Ada Lovelace", 'narrative'],
  ["Comparative politics", 'narrative'],
  ["Anthropology", 'narrative'],
  ["Plate tectonics", 'narrative'],
  ["Climate change", 'narrative'],
  ["The Bronze Age", 'narrative'],
  ["Game design: level design", 'creative'],
  ["Game feel", 'creative'],
  ["Narrative design", 'creative'],
  ["Creative writing", 'creative'],
  ["Screenwriting", 'creative'],
  ["Technical writing", 'creative'],
  ["Music theory: cadences", 'creative'],
  ["Voice leading and counterpoint", 'creative'],
  ["Chord progressions", 'creative'],
  ["Songwriting", 'creative'],
  ["UI design critique", 'creative'],
  ["Typography", 'creative'],
  ["Colour theory", 'creative'],
  ["Accessibility and WCAG", 'creative'],
  ["Usability", 'creative'],
  ["Interior design", 'creative'],
  ["Chess openings", 'quant'],
  ["Learn the piano", 'physical'],
  ["Guitar", 'physical'],
  ["Singing", 'physical'],
  ["Strength training", 'physical'],
  ["Marathon training", 'physical'],
  ["Swimming", 'physical'],
  ["Yoga", 'physical'],
  ["Brazilian jiu-jitsu", 'physical'],
  ["Tennis", 'physical'],
  ["Rock climbing", 'physical'],
  ["Dance", 'physical'],
  ["Woodworking", 'physical'],
  ["Cooking", 'physical'],
  ["Knitting", 'physical'],
  ["Learn to drive", 'physical'],
  ["Public speaking", 'physical'],
  ["Figure drawing", 'creative'],
  ["Watercolour painting", 'creative'],
  ["Photography", 'creative'],
]

const OTHERS = (...mine: SubjectKind[]) => SUBJECT_KINDS.filter((k) => !mine.includes(k))

describe('profiling a subject in code', () => {
  it('covers over 150 subjects across sciences, engineering, computing, humanities, social sciences, professions and arts', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(150)
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(80)
    for (const kind of SUBJECT_KINDS) expect(TABLE.filter(([, k]) => k === kind).length, kind).toBeGreaterThanOrEqual(10)
  })

  it.each(TABLE)('%s is %s', (topic, kind) => {
    const p = profileSubject(topic)
    expect(p.from).toBe('map')
    expect(p.kinds[0]).toBe(kind)
    expect(p.kinds.length).toBeLessThanOrEqual(2)
  })

  it('combines two kinds where a topic does', () => {
    expect(profileSubject('Game loop and physics in games').kinds).toEqual(['build', 'quant'])
    expect(profileSubject('Contract law: offer and acceptance').kinds).toEqual(['domain', 'interpret'])
    expect(profileSubject('Core banking: ledgers, clearing and settlement').kinds).toEqual(['domain', 'build'])
    expect(profileSubject('Build my own search engine from scratch').kinds).toContain('build')
    expect(profileSubject('Build my own zorblax from scratch').kinds).toEqual(['build'])
  })

  it('tells apart words that name two things', () => {
    expect(profileSubject('Git merge conflicts').kinds[0]).toBe('build')
    expect(profileSubject('SWIFT messages').subjects[0]).toBe('core banking')
    expect(profileSubject('Swift programming').subjects[0]).toBe('swift')
    expect(profileSubject('Running Kafka in production').kinds[0]).toBe('build')
    expect(profileSubject('Covalent bonds').subjects[0]).toBe('chemistry')
    expect(profileSubject('Literary analysis of Hamlet').kinds[0]).toBe('interpret')
    expect(profileSubject('Shannon entropy').subjects[0]).toBe('information theory')
    expect(profileSubject("Ohm's law and resistors in series").subjects[0]).toBe('electromagnetism')
    // "syntax" inside "abstract syntax trees" is not linguistics
    expect(profileSubject('Compilers: parsing expressions into abstract syntax trees').kinds).toEqual(['build'])
    expect(profileSubject('Frame-rate independent movement').kinds).toEqual(['build', 'quant'])
  })

  it('falls back to the roadmap, and is unclear when nothing names it', () => {
    expect(profileSubject('Week 3: the basics', 'Learning/Core banking').kinds[0]).toBe('domain')
    expect(profileSubject('Week 3: the basics', 'Learning/Core banking').from).toBe('notebook')
    const none = profileSubject('Zorblax fundamentals')
    expect(none.from).toBe('unclear')
    expect(none.kinds).toEqual([])
  })
})

describe('the toolkits', () => {
  it("keep each kind's addition to the prompt under about 150 words", () => {
    for (const k of SUBJECT_KINDS) expect(wordCount(TOOLKITS[k].rules), k).toBeLessThanOrEqual(150)
  })

  it('name trusted-source areas that exist, with sites in them', () => {
    for (const k of SUBJECT_KINDS) for (const a of TOOLKITS[k].areas) expect(TRUSTED[a]?.length, `${k}: ${a}`).toBeGreaterThan(0)
    for (const s of SUBJECTS) for (const a of s.areas ?? []) expect(TRUSTED[a]?.length, `${s.name}: ${a}`).toBeGreaterThan(0)
    expect(preferredAreas(profileSubject('Clearing and settlement'))).toContain('Finance, payments and blockchains')
    expect(preferredAreas(profileSubject('Electromagnetic induction'))).toContain('Physics')
    expect(preferredAreas(profileSubject('Contract law'))).toContain('Law')
    expect(preferredAreas(profileSubject('Game loop'))).toContain('Game development and graphics')
  })

  it('give a philosophy lesson the reading rules, and not code, SQL or simulations', () => {
    const s = sessionInstructions({ mode: 'teach', topic: "Kant's categorical imperative" })
    expect(s).toContain(TOOLKITS.interpret.rules)
    expect(s).not.toContain(HANDS_ON)
    expect(s).not.toMatch(/run_sql|A live simulation fits|"kind":/)
    for (const k of OTHERS('interpret')) expect(s).not.toContain(TOOLKITS[k].rules)
  })

  it('give a physics lesson worked problems, exact checks and the physics and plot simulations, and not the reading or code rules', () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'Projectile motion' })
    expect(s).toContain(TOOLKITS.quant.rules)
    expect(s).toMatch(/A live simulation fits this topic \(physics, plot\)/)
    expect(s).toContain('"kind":"physics"')
    expect(s).toContain('"kind":"plot"')
    expect(s).not.toContain(HANDS_ON)
    for (const k of OTHERS('quant')) expect(s).not.toContain(TOOLKITS[k].rules)
  })

  it('give a programming lesson the hands-on rules and the build toolkit only', () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'Pointers in C' })
    expect(s).toContain(HANDS_ON)
    expect(s).toContain(TOOLKITS.build.rules)
    for (const k of OTHERS('build')) expect(s).not.toContain(TOOLKITS[k].rules)
  })

  it('give a history lesson timelines and sources, and drop a simulation its words would match', () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'The French Revolution' })
    expect(s).toContain(TOOLKITS.narrative.rules)
    expect(s).not.toContain(HANDS_ON)
    for (const k of OTHERS('narrative')) expect(s).not.toContain(TOOLKITS[k].rules)
    // "plot" names a simulation; a play's plot is not one
    expect(sessionInstructions({ mode: 'teach', topic: 'The plot of Hamlet' })).not.toMatch(/A live simulation fits/)
  })

  it("give a banking lesson case studies and standards, with both kinds' rules", () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'Clearing and settlement' })
    expect(s).toContain(TOOLKITS.domain.rules)
    expect(s).toContain(TOOLKITS.build.rules)
    for (const k of OTHERS('domain', 'build')) expect(s).not.toContain(TOOLKITS[k].rules)
  })

  it('give craft and physical skills their own rules and no code', () => {
    const design = sessionInstructions({ mode: 'teach', topic: 'Game feel' })
    expect(design).toContain(TOOLKITS.creative.rules)
    expect(design).not.toContain(HANDS_ON)
    const piano = sessionInstructions({ mode: 'teach', topic: 'Learn the piano' })
    expect(piano).toContain(TOOLKITS.physical.rules)
    expect(piano).not.toContain(HANDS_ON)
  })

  it('give statistics the SQL lab in short, without the whole hands-on block', () => {
    const k = lessonKit('Hypothesis testing')
    expect(k.handsOn).toBe(false)
    expect(k.toolkit).toMatch(/run_sql/)
  })

  it('keep what an unclear topic had before: hands-on and its simulations', () => {
    expect(lessonKit('Zorblax fundamentals')).toEqual({ handsOn: true, sims: '', toolkit: '', humanities: '' })
    expect(sessionInstructions({ mode: 'teach', topic: 'Zorblax fundamentals' })).toContain(HANDS_ON)
  })

  it("use a profile decided elsewhere (a roadmap's, or the model's) over the topic's words", () => {
    const s = sessionInstructions({ mode: 'teach', topic: 'Zorblax fundamentals', options: { subject: { kinds: ['narrative'], subjects: [], from: 'model' } } })
    expect(s).toContain(TOOLKITS.narrative.rules)
    expect(s).not.toContain(HANDS_ON)
    expect(toolkitText('Zorblax', { kinds: ['quant'], subjects: [], from: 'model' })).toContain(TOOLKITS.quant.rules)
  })

  it('leave quizzes alone, and keep Why mode', () => {
    expect(sessionInstructions({ mode: 'quiz', topic: 'Stoicism' })).not.toContain(TOOLKITS.interpret.rules)
    expect(sessionInstructions({ mode: 'teach', topic: 'Stoicism', options: { why: true } })).toContain(WHY_RULES)
  })

  it('make a lesson that no longer carries the hands-on rules shorter than before', () => {
    const before = wordCount(sessionInstructions({ mode: 'teach', topic: 'Zorblax fundamentals' }))
    for (const topic of ['Stoicism', 'The Cold War', 'Accounting: accruals', 'Game feel', 'Learn the piano', 'Projectile motion']) expect(wordCount(sessionInstructions({ mode: 'teach', topic })), topic).toBeLessThan(before)
  })
})

describe('roadmaps for any subject', () => {
  it("end phases in the kind's own work", () => {
    expect(roadmapGuidance(profileSubject('Compilers'))).toMatch(/project they build/)
    expect(roadmapGuidance(profileSubject('Classical mechanics'))).toMatch(/problem set/)
    expect(roadmapGuidance(profileSubject('Philosophy of mind'))).toMatch(/essay/)
    expect(roadmapGuidance(profileSubject('Core banking'))).toMatch(/governing standards.*case study/)
    expect(roadmapGuidance(profileSubject('World history'))).toMatch(/primary sources/)
    expect(phaseWorkLine(profileSubject('Classical mechanics'))).toMatch(/^- \[ \] Practice: Problem set, /)
    expect(phaseWorkLine(profileSubject('Stoicism'))).toMatch(/^- \[ \] Practice: Essay, /)
    expect(phaseWorkLine(profileSubject('Accounting'))).toMatch(/^- \[ \] Practice: Case study, /)
    expect(phaseWorkLine(profileSubject('The Cold War'))).toMatch(/^- \[ \] Practice: Primary sources, /)
    expect(phaseWorkLine(profileSubject('Compilers'))).toBe('')
    expect(roadmapGuidance(profileSubject('Zorblax'))).toBe('')
  })

  it("put the kind's work where the roadmap's parser reads a phase's practice", () => {
    const md = `## Phase 1: Kinematics\n### Motion\n- [ ] Velocity\n${phaseWorkLine(profileSubject('Classical mechanics'))}\n- [ ] Project: a projectile simulator\n- [ ] Exam: Kinematics\n`
    const [phase] = phasesForTasks(md, { start: '2026-11-16', hours: 6, weeks: [2] }, (t) => t)
    expect(phase.practice).toEqual(['Problem set, graded problems on this phase, worked examples first'])
    expect(phase.chapters[0].topics).toEqual(['Velocity'])
    expect(phase.project).toBe('a projectile simulator')
  })

  it('keep the kinds in the roadmap file', () => {
    const plan = { scope: 'discipline' as const, weeks: 4, hoursPerWeek: 6, why: '', phases: [{ title: 'A', weeks: 4, outcome: 'x' }], subject: profileSubject('Core banking').kinds }
    expect(planFrontmatter(plan, '2026-11-16')).toContain('subject_kinds: domain, build')
    expect(planFrontmatter({ ...plan, subject: undefined }, '2026-11-16')).not.toContain('subject_kinds')
  })

  it('keep the kinds with the roadmap and read them back', () => {
    expect(kindsFrom('domain, build')).toEqual(['domain', 'build'])
    expect(kindsFrom('[quant]')).toEqual(['quant'])
    expect(kindsFrom('nonsense, quant, interpret, build')).toEqual(['quant', 'interpret'])
  })
})

describe('asking the model when the map cannot tell', () => {
  it('holds its answer to the schema', () => {
    expect(parseModelProfile('{"kinds":["domain"],"lab":false,"needs":[]}')).toEqual({ kinds: ['domain'], subjects: [], from: 'model' })
    expect(parseModelProfile('```json\n{"kinds":["build","quant"],"lab":true,"needs":["gpu"]}\n```')).toMatchObject({ kinds: ['build', 'quant'], lab: true, hands: true, needs: ['gpu'] })
    const bad = [
      '',
      'not json',
      '{"kinds":[]}',
      '{"kinds":["maths"],"lab":false,"needs":[]}',
      '{"kinds":["build","build"],"lab":false,"needs":[]}',
      '{"kinds":["build","quant","domain"],"lab":false,"needs":[]}',
      '{"kinds":["build"],"lab":"yes","needs":[]}',
      '{"kinds":["build"],"lab":false,"needs":["magic"]}',
      '{"kinds":["build"],"lab":false,"needs":[],"extra":1}',
      '[1,2]'
    ]
    for (const b of bad) expect(parseModelProfile(b), b).toBeNull()
    expect(PROFILE_SCHEMA.properties.kinds.items.enum).toEqual(SUBJECT_KINDS)
  })
})

describe('trusted sources for the new subjects', () => {
  it('are listed, and the unchecked ones are kept apart and not trusted', () => {
    for (const area of ['Physics', 'Chemistry', 'Biology and medicine', 'Economics', 'Accounting', 'Law', 'Game development and graphics', 'Music and design', 'History, texts and languages']) expect(TRUSTED[area]?.length, area).toBeGreaterThan(1)
    expect(trustedSite('https://docs.godotengine.org/en/stable/tutorials/physics/index.html')?.kind).toBe('official')
    expect(trustedSite('https://www.legislation.gov.uk/ukpga/1979/54')?.kind).toBe('primary')
    expect(trustedSite('https://www.ncbi.nlm.nih.gov/books/NBK1/')?.kind).toBe('book')
    expect(trustedSite('https://www.ncbi.nlm.nih.gov/gene/')?.by).toBe('US National Library of Medicine')
    expect(trustedSite('https://www.ecb.europa.eu/paym/target/html/index.en.html')?.by).toBe('European Central Bank')
    const unchecked = Object.values(UNCHECKED_TRUSTED).flat()
    expect(unchecked.length).toBeGreaterThan(5)
    for (const s of unchecked) expect(trustedSite(`https://${s.host}${s.path ?? '/'}x`), s.host).toBeNull()
  })
})

describe('a word shared by two subjects', () => {
  it('reads "Byzantine" as distributed systems when it is about faults, and as history when it is about the empire', async () => {
    const { profileSubject: profileTopic } = await import('../src/shared/subjects')
    expect(profileTopic('Fault tolerance: crash and Byzantine failure counts').kinds[0]).toBe('build')
    expect(profileTopic('The Byzantine generals problem').kinds[0]).toBe('build')
    expect(profileTopic('The Byzantine Empire under Justinian').kinds[0]).toBe('narrative')
  })
})
