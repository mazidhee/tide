/**
 * Which kind of knowledge a subject is, read off its name in code: a curated map of subjects
 * (sciences, engineering, computing, humanities, social sciences, professions, arts, physical
 * skills), each with the phrases that name it. src/shared/subjects.ts turns a match into a profile
 * and a teaching toolkit; a topic nothing here names is "unclear", and only then is a model asked.
 *
 * To add a subject: one line in SUBJECTS, and a line in test/subjects.test.ts saying what a topic
 * in it should be profiled as. Phrases are regular-expression fragments matched whole-word and
 * case-blind; the longest phrase that matches decides between subjects, so put the specific one
 * ("history of mathematics") as well as the general one ("history").
 */
import type { SimKind } from './sims'

export type SubjectKind = 'build' | 'quant' | 'interpret' | 'narrative' | 'domain' | 'creative' | 'physical'
export const SUBJECT_KINDS: SubjectKind[] = ['build', 'quant', 'interpret', 'narrative', 'domain', 'creative', 'physical']

/** Something a subject needs that an app on a Mac may not have (see shared/capability) */
export type Need =
  | 'wet-lab' // a chemistry or biology bench
  | 'body' // a physical skill: the body does the learning
  | 'instrument' // playing or singing
  | 'live-data' // live prices or feeds
  | 'hardware' // a board, a circuit, a robot
  | 'engine' // a game engine's editor
  | 'gpu' // a CUDA or Metal GPU programme
  | 'clinic' // patients: medicine is taught, never practised on a case
  | `lang:${string}` // a language whose toolchain may be missing

export interface SubjectEntry {
  name: string
  kinds: SubjectKind[]
  /** Regex fragments naming it */
  phrases: string[]
  /** Teach it hands-on with code and SQL (the HANDS_ON rules), whatever its kinds */
  hands?: boolean
  /** Data work in the SQL lab suits it */
  lab?: boolean
  /** Simulation kinds that suit it beyond what its topic names */
  sims?: SimKind[]
  needs?: Need[]
  /** Trusted-source areas (shared/trustedSources) beyond its kinds' own */
  areas?: string[]
}

const B: SubjectKind = 'build'
const Q: SubjectKind = 'quant'
const I: SubjectKind = 'interpret'
const N: SubjectKind = 'narrative'
const D: SubjectKind = 'domain'
const C: SubjectKind = 'creative'
const P: SubjectKind = 'physical'

/** Splits "a|b(c|d)|e" at the top level only: a phrase may hold its own alternatives */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\') {
      cur += ch + (s[++i] ?? '')
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === '|' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((p) => p.trim()).filter(Boolean)
}

const e = (name: string, kinds: SubjectKind[], phrases: string, more: Omit<SubjectEntry, 'name' | 'kinds' | 'phrases'> = {}): SubjectEntry => ({ name, kinds, phrases: splitTop(phrases), ...more })

export const SUBJECTS: SubjectEntry[] = [
  // ---------- Computing: learnt by building ----------
  e('programming', [B], 'programming|coding|search engines?|information retrieval|software engineering|software development|data structures?|algorithms?|leetcode|object[- ]oriented|functional programming|design patterns|refactoring|unit test(s|ing)?|test[- ]driven|hash (tables?|maps?)|linked lists?|binary search|sorting algorithms?|heaps?|dynamic programming|recursion|tries|graph algorithms?', { hands: true }),
  e('python', [B], 'python|pandas|numpy|django|flask|fastapi', { hands: true }),
  e('javascript and typescript', [B], 'javascript|typescript|node\\.?js|react|vue|svelte|next\\.?js|deno', { hands: true }),
  e('web development', [B], 'web development|web dev|html and css|html|css|front[- ]?end|back[- ]?end|full[- ]?stack|rest apis?|graphql|http servers?', { hands: true, areas: ['The web'] }),
  e('c and c++', [B], 'c\\+\\+|cpp|c programming|the c language|in c|pointers|memory management|undefined behaviou?r|raii|templates in c\\+\\+|move semantics', { hands: true }),
  e('rust', [B], 'rust|borrow checker|ownership and borrowing|cargo', { hands: true, needs: ['lang:rust'] }),
  e('go', [B], 'golang|go language|goroutines?|go programming', { hands: true, needs: ['lang:go'] }),
  e('swift', [B], 'swift|swift programming|swiftui|ios development|ios apps?', { hands: true, needs: ['lang:swift'] }),
  e('java and kotlin', [B], 'java|jvm|spring boot|kotlin|android development', { hands: true, needs: ['lang:java'] }),
  e('ruby', [B], 'ruby|rails', { hands: true, needs: ['lang:ruby'] }),
  e('haskell and functional languages', [B], 'haskell|ocaml|elixir|erlang|clojure|scala|f#|lisp|scheme', { hands: true, needs: ['lang:other'] }),
  e('other languages', [B], 'c#|\\.net|php|lua|zig|julia|perl|dart|flutter', { hands: true, needs: ['lang:other'] }),
  e('shell and tools', [B], 'bash|zsh|shell scripting|command line|unix tools|git|vim|tmux|make(files)?', { hands: true }),
  e('databases', [B], 'databases?|sql|postgres(ql)?|mysql|sqlite|query optimi[sz]ation|indexes|indexing|transactions|acid|mvcc|storage engines?|b-?trees?|lsm[- ]trees?|write[- ]ahead log|build (my|your|a) own database|database internals', { hands: true, lab: true }),
  e('data engineering', [B], 'data engineering|etl|elt|data pipelines?|data warehous\\w*|airflow|dbt|spark|kafka|stream processing|data lakes?|bigquery|snowflake', { hands: true, lab: true }),
  e('distributed systems', [B], 'distributed systems?|consensus|raft|paxos|replication|sharding|partitioning|consistency models?|cap theorem|two[- ]phase commit|crdts?|leader election|vector clocks?', { hands: true }),
  e('operating systems', [B], 'operating systems?|kernels?|processes and threads|scheduling|virtual memory|paging|file systems?|system calls?|syscalls?|concurrency|mutex(es)?|deadlocks?|ostep', { hands: true }),
  e('computer architecture', [B], 'computer architecture|cpu design|instruction sets?|assembly( language)?|caches|cache locality|pipelining|how computers work|computer organi[sz]ation|x86|arm64|risc-?v', { hands: true }),
  e('compilers and interpreters', [B], 'compilers?|interpreters?|parsers?|parsing|lexers?|lexing|tokeni[sz]ers?|abstract syntax trees?|ast|code generation|type checkers?|llvm|programming language design|crafting interpreters', { hands: true }),
  e('computer networks', [B], 'computer networks?|networking|tcp|udp|tcp/ip|dns|routing|sockets|http/2|http/3|quic|tls|the internet works', { hands: true }),
  e('security', [B], 'security|cryptography|encryption|hashing|authentication|oauth|penetration testing|web security|xss|sql injection|threat model\\w*', { hands: true }),
  e('cloud and devops', [B], 'devops|docker|kubernetes|containers?|terraform|ci/cd|cloud computing|aws|gcp|azure|infrastructure as code|observability|site reliability', { hands: true }),
  e('systems design', [B], 'system design|systems design|software architecture|microservices|scalab\\w*|load balanc\\w*|caching strategies', { hands: true }),
  e('blockchain engineering', [B, D], 'blockchains?|smart contracts?|solidity|ethereum|bitcoin|web3|defi|stablecoins?|zero[- ]knowledge|rollups?', { hands: true }),
  e('game development', [B], 'game dev(elopment)?|game programming|game engines?|godot|unity|unreal|game loops?|physics in games|game physics|collision detection|entity component systems?|ecs|sprites?|tilemaps?|pathfinding in games', { hands: true, needs: ['engine'], areas: ['Game development and graphics', 'The web'] }),
  e('computer graphics', [B, Q], '3-?d graphics|computer graphics|rendering|shaders?|opengl|webgl|webgpu|vulkan|metal api|rasteri[sz]ation|ray tracing|transformation matrices|homogeneous coordinates|quaternions', { hands: true, sims: ['plot'], needs: ['gpu'], areas: ['Game development and graphics'] }),
  e('gpu programming', [B], 'cuda|gpu programming|gpu kernels?|triton kernels?|simd', { hands: true, needs: ['gpu'] }),
  e('embedded and electronics', [B], 'embedded systems?|microcontrollers?|arduino|raspberry pi|firmware|fpga|verilog|vhdl|electronics|circuits? design|pcb|robotics', { hands: true, needs: ['hardware'] }),
  e('mobile and apps', [B], 'mobile apps?|app development|electron apps?|desktop apps?', { hands: true }),
  e('agentic engineering', [B], 'llm apps?|agents?|agentic|prompt engineering|rag|retrieval[- ]augmented|tool calling|mcp servers?|fine[- ]tuning|lora', { hands: true }),

  // ---------- Quantitative: concepts plus calculation ----------
  e('machine learning', [Q, B], 'machine learning|deep learning|neural networks?|backpropagation|gradient descent|transformers?|attention|reinforcement learning|ml theory|statistical learning|computer vision|natural language processing|nlp|llms?|large language models?', { hands: true, areas: ['Machine learning'] }),
  e('mathematics', [Q], 'math(s|ematics)?|algebra|pre-?calculus|calculus|differential equations?|odes?|pdes?|real analysis|complex analysis|mathematical analysis|topology|number theory|abstract algebra|group theory|combinatorics|discrete math(s|ematics)?|graph theory|geometry|trigonometry|proofs?|set theory|logarithms?|derivatives?|integrals?|integration|limits|series|sequences|vectors?|matrices|matrix|eigen\\w*|fourier|optimi[sz]ation|numerical methods|category theory'),
  e('linear algebra', [Q], 'linear algebra|vector spaces?|linear transformations?|determinants?|rank and null space|svd|singular value'),
  e('probability and statistics', [Q], 'probability|statistics|statistical|bayes\\w*|hypothesis test\\w*|p-?values?|confidence intervals?|regression|anova|distributions?|random variables?|stochastic|markov chains?|monte carlo|a/b test\\w*|experiment design|causal inference', { lab: true }),
  e('data analysis', [Q, B], 'data analysis|data analytics|data science|exploratory data|business intelligence|dashboards|tableau|metabase|power bi|looker', { hands: true, lab: true }),
  e('classical mechanics', [Q], 'physics|mechanics|classical mechanics|newton\\w*|kinematics|dynamics|projectile motion|forces?|momentum|torque|rotational motion|angular momentum|work and energy|conservation of energy|oscillations?|simple harmonic|harmonic oscillators?|lagrangian|hamiltonian|orbital mechanics|gravitation|fluid mechanics|statics', { sims: ['plot'], needs: ['wet-lab'], areas: ['Physics'] }),
  e('electromagnetism', [Q], 'electromagnetism|electricity and magnetism|electric fields?|magnetic fields?|maxwell\\w*|coulomb\\w*|gauss\\w* law|faraday\\w*|electromagnetic induction|electrostatics|circuits?|ohm\\w* law|kirchhoff\\w*|capacitors?|inductors?|rc circuits?', { sims: ['plot'], needs: ['wet-lab'], areas: ['Physics'] }),
  e('modern physics', [Q], 'quantum( mechanics| physics| basics| computing)?|schr[oö]dinger|wave functions?|uncertainty principle|relativity|special relativity|general relativity|particle physics|nuclear physics|atomic physics|optics|waves|thermodynamics|entropy|statistical mechanics|heat engines?|astrophysics|cosmology|astronomy', { sims: ['plot'], areas: ['Physics'] }),
  e('chemistry', [Q], 'chemistry|chemical (reactions?|bonding|equilibrium|kinetics)|stoichiometry|moles?|acids? and bases?|ph|titrations?|redox|electrochemistry|thermochemistry|periodic table|organic chemistry|inorganic chemistry|physical chemistry|reaction mechanisms?|sn1|sn2|nucleophil\\w*|electrophil\\w*|functional groups?|covalent bonds?|ionic bonds?|hydrogen bonds?|stereochemistry|chirality|spectroscopy|nmr|biochemistry|enzymes?', { needs: ['wet-lab'], areas: ['Chemistry'] }),
  e('economics', [Q], 'economics|microeconomics|macroeconomics|supply and demand|elasticity|game theory|monetary policy|fiscal policy|inflation|gdp|interest rates?|unemployment|is-lm|exchange rates?|international trade|labou?r economics|econometrics|behavioral economics|behavioural economics|keynes\\w*|phillips curve|market structures?|monopoly|oligopoly', { lab: true, areas: ['Economics'] }),
  e('corporate finance and investing', [Q, D], 'corporate finance|finance|valuation|discounted cash flows?|dcf|npv|net present value|irr|wacc|cost of capital|capital structure|portfolio theory|capm|options pricing|black-?scholes|derivatives pricing|fixed income|bonds?|yield curves?|quantitative finance|quant research|algorithmic trading|trading strategies|investing|stock market|financial markets', { lab: true, needs: ['live-data'], areas: ['Finance, payments and blockchains', 'Economics'] }),
  e('epidemiology', [Q, D], 'epidemiology|biostatistics|incidence|prevalence|relative risk|odds ratios?|cohort studies|case[- ]control|clinical trials?|sir models?|r0|public health', { lab: true, sims: ['plot'], areas: ['Biology and medicine'] }),
  e('engineering', [Q], 'engineering mechanics|structural engineering|civil engineering|mechanical engineering|electrical engineering|control theory|control systems|signal processing|signals and systems|dsp|materials science|aerodynamics|heat transfer|chemical engineering', { sims: ['plot'], needs: ['wet-lab'], areas: ['Physics'] }),
  e('information theory', [Q], 'information theory|shannon|shannon entropy|coding theory|error[- ]correcting codes?|compression algorithms?'),
  e('theory of computation', [Q, B], 'theory of computation|automata|turing machines?|computability|complexity theory|p vs np|big[- ]o|asymptotic analysis|formal languages|regular expressions theory'),
  e('logic', [Q, I], 'formal logic|propositional logic|predicate logic|first[- ]order logic|modal logic|logic'),
  e('operations research', [Q], 'operations research|linear programming|queueing theory|queuing theory|scheduling theory|supply chain optimi[sz]ation'),

  // ---------- Life sciences and medicine ----------
  e('biology', [Q, D], 'biology|cell biology|cells?|genetics|genes?|dna|rna|mendel\\w*|inheritance|punnett|alleles?|evolution|natural selection|molecular biology|microbiology|ecology|physiology|anatomy|neuroscience|immunology|protein (folding|synthesis)|photosynthesis|cellular respiration|mitosis|meiosis|crispr|bioinformatics', { needs: ['wet-lab'], areas: ['Biology and medicine'] }),
  e('medicine', [D], 'medicine|medical|clinical medicine|pharmacology|pathology|diagnosis|cardiology|nursing|first aid|nutrition|psychiatry|drugs and doses', { needs: ['clinic'], areas: ['Biology and medicine'] }),
  e('psychology', [N, Q], 'psychology|cognitive psychology|developmental psychology|social psychology|cognitive science|behaviou?rism|memory research|learning science', { lab: true, areas: ['Biology and medicine'] }),

  // ---------- Professions: standards and practice ----------
  e('core banking', [D, B], 'core banking|banking systems?|ledgers?|general ledger|double[- ]entry|accounts? (and|&) balances|posting|clearing|settlement|clearing and settlement|real[- ]time gross settlement|rtgs|nostro|vostro|correspondent banking|iso ?20022|swift (messages?|network|gpi|codes?)|swift mt\\d+|sepa|ach|faster payments|payment rails|payments?|card schemes?|interchange|reconciliation|kyc|aml|anti[- ]money laundering|basel( iii)?|capital requirements|liquidity (coverage|risk)|deposits? and loans|interest accrual|treasury management', { areas: ['Finance, payments and blockchains'] }),
  e('accounting', [D, Q], 'accounting|bookkeeping|financial statements?|balance sheets?|income statements?|cash flow statements?|journal entries|trial balance|accruals?|depreciation|amorti[sz]ation|ifrs|gaap|us gaap|revenue recognition|ifrs ?(9|15|16)|audit(ing)?|management accounting|cost accounting|tax(ation)?', { areas: ['Accounting'] }),
  e('law', [D, I], 'law|legal|contract law|contracts?|offer and acceptance|consideration|tort law|torts?|negligence|criminal law|constitutional law|property law|company law|corporate law|employment law|intellectual property|copyright|patents?|trademarks?|gdpr|data protection law|jurisprudence|legal reasoning|case law|statutory interpretation|judicial review', { areas: ['Law'] }),
  e('product and business', [D], 'product management|product strategy|business strategy|marketing|growth|go[- ]to[- ]market|startups?|entrepreneurship|management|leadership|negotiation|sales|operations management|project management|agile|scrum|okrs?|business models?', {}),
  e('product analytics', [D, Q], 'product analytics|mixpanel|amplitude|funnels?|retention|cohorts?|north star metrics?|kpis?|metrics design|event tracking', { hands: true, lab: true }),
  e('insurance and risk', [D, Q], 'insurance|actuarial|underwriting|risk management|credit risk|market risk|operational risk|value at risk|var model', { lab: true, areas: ['Finance, payments and blockchains'] }),
  e('real estate and property', [D], 'real estate|property investing|mortgages?|conveyancing'),
  e('teaching and education', [D], 'pedagogy|teaching methods|instructional design|curriculum design|education theory'),
  e('journalism and research methods', [D, I], 'journalism|research methods|qualitative research|fact[- ]checking|osint'),
  e('aviation and maritime', [D, P], 'aviation|pilot training|flying|private pilot|air traffic|sailing|navigation|seamanship', { needs: ['body'] }),

  // ---------- Humanities: texts and arguments ----------
  e('philosophy', [I], 'philosophy|philosophical|ethics|moral philosophy|metaethics|metaphysics|epistemology|philosophy of mind|consciousness|free will|stoic(ism|s)?|existentialism|phenomenology|utilitarianism|deontology|kant\\w*|plato|aristotle|socrat\\w*|nietzsche|hume|descartes|wittgenstein|political philosophy|aesthetics|philosophy of science|philosophy of language', { areas: ['General reference'] }),
  e('literature', [I], 'literature|literary|novels?|poetry|poems?|shakespeare|hamlet|macbeth|king lear|dickens|austen|tolstoy|dostoevsky|homer|iliad|odyssey|dante|milton|close reading|literary criticism|literary theory|drama|plays of|the canon|short stories', { areas: ['History, texts and languages'] }),
  e('theology and religion', [I, N], 'theology|religion|religious studies|bible|biblical|scripture|quran|qur.an|torah|talmud|gospels?|church history|patristics|systematic theology|apologetics|buddhism|hinduism|islam|christianity|judaism', { areas: ['History, texts and languages'] }),
  e('classics', [I, N], 'classics|ancient greek|latin|greek tragedy|roman literature|classical civili[sz]ation', { areas: ['History, texts and languages'] }),
  e('political theory', [I], 'political theory|political thought|social contract|hobbes|locke|rousseau|marx\\w*|liberalism|conservatism|democracy theory|justice theory|rawls'),
  e('linguistics', [I, Q], 'linguistics|phonetics|phonology|morphology|syntax|semantics|pragmatics|sociolinguistics|historical linguistics|language acquisition|ipa|grammar of', { areas: ['History, texts and languages'] }),
  e('languages', [D], 'learn (spanish|french|german|italian|portuguese|japanese|mandarin|chinese|korean|arabic|russian|hindi|swahili|yoruba|igbo|dutch|greek|latin)|(spanish|french|german|italian|portuguese|japanese|mandarin|chinese|korean|arabic|russian|hindi|swahili|yoruba|igbo|dutch) (language|grammar|vocabulary|verbs?|conjugation|pronunciation|for beginners|reading|listening|conversation)|language learning|second language acquisition|conjugation'),
  e('art history', [I, N], 'art history|history of art|renaissance art|impressionism|modern art|art criticism|iconography', { areas: ['History, texts and languages'] }),

  // ---------- History and social science: facts, causes, chronology ----------
  e('history', [N], 'history|historical|world history|ancient history|medieval|middle ages|renaissance|reformation|enlightenment|industrial revolution|french revolution|american revolution|civil war|world war (i|ii|one|two|1|2)|first world war|second world war|cold war|colonialism|decoloni[sz]ation|empires?|roman empire|byzantine|ottoman|mughal|british empire|slave trade|holocaust|history of', { areas: ['History, texts and languages'] }),
  e('history of science and technology', [N], 'history of (science|mathematics|computing|technology|medicine|physics|economics)', { areas: ['History, texts and languages'] }),
  e('geopolitics and international relations', [N, I], 'geopolitics|international relations|foreign policy|diplomacy|wars? in|armed conflicts?|nato|united nations|the eu|european union|middle east|global order|security studies'),
  e('biography', [N], 'biography|biographies|lives of'),
  e('politics and government', [N, I], 'politics|government|political science|elections?|parliament|congress|constitution|public policy|comparative politics'),
  e('sociology and anthropology', [N, I], 'sociology|anthropology|ethnography|social theory|culture studies|cultural studies|demography'),
  e('geography and earth science', [N, Q], 'geography|geology|earth science|plate tectonics|climate( change| science)?|meteorology|oceanography|human geography|urban studies', { sims: ['plot'], areas: ['Physics'] }),
  e('archaeology', [N], 'archaeology|prehistory|stone age|bronze age|iron age'),

  // ---------- Arts and craft: judgement ----------
  e('game design', [C], 'game design|level design|game mechanics|game feel|narrative design|systems design for games|puzzle design|playtesting'),
  e('writing', [C], 'writing|write a novel|writing a novel|creative writing|fiction writing|screenwriting|copywriting|technical writing|essay writing|storytelling|prose style|editing prose|non-fiction writing|blogging'),
  e('music theory', [C, Q], 'music theory|harmony|counterpoint|chords?|chord progressions?|scales|modes|intervals|voice leading|cadences?|key signatures?|rhythm|meter|ear training|orchestration|music(al)? composition|composing music|songwriting|music production|mixing|sound design|daw', { areas: ['Music and design'] }),
  e('ui and ux design', [C, D], 'ui design|ux design|user interface|user experience|interaction design|design critique|ui critique|visual design|typography|colou?r theory|layout|design systems?|figma|accessibility|wcag|usability|information architecture|product design', { areas: ['Music and design'] }),
  e('visual arts', [C, P], 'drawing|painting|sketching|illustration|figure drawing|watercolou?r|oil painting|perspective drawing|photography|film-?making|cinematography|character animation|2-?d animation|animation principles|sculpture|calligraphy|graphic design', { needs: ['body'] }),
  e('architecture', [C, D], 'architecture of buildings|architectural design|urban design|interior design|landscape architecture'),
  e('film and media', [I, C], 'film studies|cinema|film theory|media studies'),

  // ---------- Physical skills ----------
  e('music performance', [P, C], '(play|playing|learn) (the )?(piano|guitar|violin|cello|drums|bass|saxophone|trumpet|flute|ukulele)|piano|guitar|violin|cello|drums|singing|vocals?|vocal technique', { needs: ['instrument', 'body'], areas: ['Music and design'] }),
  e('sport and fitness', [P], 'fitness|strength training|weightlifting|powerlifting|running (technique|training|form)|marathon|couch to 5k|swimming|cycling|yoga|pilates|calisthenics|stretching|mobility|martial arts|boxing|brazilian jiu[- ]jitsu|bjj|karate|judo|football|soccer|basketball|tennis|golf|climbing|skateboarding|surfing|skiing|dance|dancing', { needs: ['body'] }),
  e('crafts and trades', [P, C], 'woodworking|carpentry|cooking|baking|knitting|sewing|pottery|welding|plumbing|car repair|mechanics of cars|gardening|bartending', { needs: ['body'] }),
  e('driving', [P, D], 'driving|learn to drive|driving test', { needs: ['body'] }),
  e('speaking', [P, C], 'public speaking|presentation skills|accent reduction|debating', { needs: ['body'] }),
  e('chess and games of skill', [Q, C], 'chess|go \\(game\\)|poker|bridge|backgammon|openings|endgames')
]

/** How many named subjects the map covers: each subject entry names several (a field and its parts) */
export const subjectCount = () => SUBJECTS.reduce((n, s) => n + s.phrases.length, 0)
