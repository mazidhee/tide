/**
 * The icon for a notebook or area of study, chosen from its name. A subject is recognised by its
 * icon wherever it appears in the new design (the rail, Home, the map of what you know, a
 * lesson, the library), so the choice has to be the same every time: it is made from the name
 * alone, by the first rule below that matches, with nothing random in it.
 *
 * The icons themselves are drawn in the app's own set (renderer/components/Icon.tsx), under
 * these names.
 */
export type SubjectIcon =
  | 'subNotebook' | 'subFinance' | 'subAccounting' | 'subEconomics' | 'subPayments' | 'subMaths' | 'subStatistics'
  | 'subCode' | 'subBraces' | 'subAlgorithms' | 'subSystems' | 'subNetworking' | 'subDatabase' | 'subPipeline'
  | 'subLearning' | 'subAgents' | 'subDistributed' | 'subSecurity' | 'subBlockchain' | 'subInterview' | 'subCareer'
  | 'subRoadmap' | 'subPhysics' | 'subChemistry' | 'subBiology' | 'subAstronomy' | 'subLanguages' | 'subWriting'
  | 'subHistory' | 'subDesign' | 'subMusic' | 'subHealth' | 'subLaw' | 'subBusiness' | 'subResearch' | 'subCloud' | 'subWorld'

export const FALLBACK_SUBJECT_ICON: SubjectIcon = 'subNotebook'

/**
 * Rules, most specific first. A keyword matches at the start of a word, so plurals and endings
 * come free ("market" matches "Markets", "cryptograph" matches "Cryptography"); one ending in
 * "=" must be the whole word ("ai=" matches "AI" but not "aims").
 */
const RULES: [SubjectIcon, string[]][] = [
  ['subInterview', ['interview']],
  ['subRoadmap', ['roadmap', 'road map', 'curriculum', 'syllabus', 'study plan', 'plan=', 'plans=', 'planning', 'pathway']],
  ['subBlockchain', ['blockchain', 'crypto=', 'cryptocurrenc', 'bitcoin', 'ethereum', 'solana', 'web3', 'defi=', 'smart contract', 'ledger']],
  ['subSecurity', ['security', 'cryptograph', 'infosec', 'cyber', 'pentest', 'hacking', 'authentication', 'privacy']],
  ['subAgents', ['agent', 'agentic', 'robot', 'automation']],
  ['subLearning', ['machine learning', 'deep learning', 'ml=', 'ai=', 'artificial intelligence', 'neural', 'llm', 'nlp=', 'transformer', 'reinforcement learning', 'computer vision']],
  ['subDistributed', ['distributed', 'consensus', 'raft=', 'paxos', 'replication', 'microservice', 'scalab']],
  ['subPipeline', ['data engineering', 'pipeline', 'etl=', 'elt=', 'warehouse', 'analytics', 'spark=', 'dbt=', 'airflow', 'streaming', 'kafka']],
  ['subDatabase', ['database', 'sql', 'postgres', 'mysql', 'storage', 'data model']],
  ['subStatistics', ['statistic', 'stats=', 'probabilit', 'bayes', 'data science', 'econometric', 'stochastic']],
  ['subCloud', ['cloud', 'devops', 'kubernetes', 'docker', 'infrastructure', 'aws=', 'gcp=', 'azure', 'sre=', 'deployment']],
  ['subNetworking', ['network', 'tcp', 'http', 'internet', 'protocol', 'dns=']],
  ['subAlgorithms', ['algorithm', 'data structure', 'leetcode', 'dsa=', 'complexity', 'competitive programming']],
  ['subSystems', ['computer system', 'operating system', 'system', 'hardware', 'computer architecture', 'os=', 'kernel', 'embedded', 'electronic', 'linux', 'compiler', 'cpu=', 'low level', 'low-level']],
  ['subBraces', ['c++', 'cpp=', 'c#', 'rust=', 'python', 'java', 'typescript', 'golang', 'go=', 'kotlin', 'swift=', 'haskell', 'programming language']],
  ['subCode', ['software', 'programming', 'coding', 'code', 'engineering', 'developer', 'development', 'dev=', 'web=', 'frontend', 'front-end', 'backend', 'back-end', 'swe=', 'computer science', 'cs=']],
  ['subPayments', ['payment', 'fintech', 'banking', 'bank=', 'card']],
  ['subAccounting', ['accounting', 'accountanc', 'bookkeeping', 'tax', 'audit']],
  ['subEconomics', ['economic', 'econ=', 'microeconomic', 'macroeconomic', 'game theory']],
  ['subFinance', ['finance', 'financial', 'market', 'trading', 'invest', 'quant', 'stock', 'portfolio', 'derivative', 'valuation', 'money']],
  ['subMaths', ['math', 'algebra', 'calculus', 'geometry', 'arithmetic', 'number theory', 'trigonometry', 'analysis=', 'topology', 'discrete', 'logic=']],
  ['subPhysics', ['physics', 'mechanics', 'quantum', 'relativity', 'thermodynamic', 'electromagnet']],
  ['subChemistry', ['chemistry', 'chemical', 'biochem']],
  ['subBiology', ['biology', 'bio=', 'genetic', 'ecology', 'botany', 'neuroscience', 'evolution']],
  ['subAstronomy', ['astronom', 'astrophysic', 'cosmolog', 'space=', 'planet']],
  ['subCareer', ['career', 'job', 'cv=', 'resume', 'résumé', 'work=', 'hiring']],
  ['subLaw', ['law=', 'laws=', 'legal', 'compliance', 'regulation', 'policy', 'contract']],
  ['subHealth', ['health', 'fitness', 'medicine', 'medical', 'nutrition', 'anatomy', 'psycholog', 'wellbeing', 'sleep']],
  ['subMusic', ['music', 'piano', 'guitar', 'harmony', 'composition']],
  ['subDesign', ['design', 'art=', 'arts=', 'ui=', 'ux=', 'drawing', 'typography', 'illustration', 'photography']],
  ['subHistory', ['history', 'histories', 'classics', 'philosoph', 'politic', 'civilisation', 'civilization', 'ancient']],
  ['subLanguages', ['language', 'linguistic', 'english', 'french', 'spanish', 'german', 'italian', 'portuguese', 'japanese', 'chinese', 'mandarin', 'korean', 'arabic', 'yoruba', 'igbo', 'latin=', 'vocabulary', 'grammar']],
  ['subWriting', ['writing', 'essay', 'journal', 'literature', 'poetry', 'blog', 'fiction', 'rhetoric']],
  ['subBusiness', ['business', 'product', 'management', 'startup', 'marketing', 'strategy', 'leadership', 'sales', 'operations', 'entrepreneur']],
  ['subResearch', ['research', 'paper', 'reading', 'thesis', 'dissertation', 'article', 'science']],
  ['subWorld', ['geograph', 'travel', 'world', 'culture', 'climate', 'earth']]
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Letters and digits either side count as part of a word; "+" and "#" do too, so "C++" and "C#" are words */
const WORD = 'a-z0-9à-ÿ'
const COMPILED: [SubjectIcon, RegExp][] = RULES.map(([icon, words]) => [
  icon,
  new RegExp(
    words
      .map((w) => {
        const whole = w.endsWith('=')
        const body = escape(whole ? w.slice(0, -1) : w).replace(/[ -]/g, '[ -]?')
        return `(?<![${WORD}])${body}${whole ? `(?![${WORD}+#])` : ''}`
      })
      .join('|')
  )
])

/** The icon for a notebook or area, from its name (a path gives its top folder's) */
export function subjectIcon(name: string | null | undefined): SubjectIcon {
  const text = (name ?? '').split('/')[0].toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return FALLBACK_SUBJECT_ICON
  for (const [icon, re] of COMPILED) if (re.test(text)) return icon
  return FALLBACK_SUBJECT_ICON
}

/** Every icon a subject can be given, for the icon set to be checked against */
export const SUBJECT_ICONS: SubjectIcon[] = [...new Set<SubjectIcon>([FALLBACK_SUBJECT_ICON, ...RULES.map(([icon]) => icon)])]
