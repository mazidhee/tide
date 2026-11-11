/**
 * The sites a source-led lesson trusts to teach from (shared/sourceLed, main/sourceLed).
 *
 * A short, explicit list: a site is here because it is the primary source for its subject (the
 * project's own documentation, the standard, the paper) or a free text that is widely taught from
 * (an open textbook, a university's course notes). Nothing here needs a login to read.
 *
 * To add one: add a line to TRUSTED under its area. `host` matches the host and its subdomains
 * (and, when it has a path, only pages under that path). `kind` sets how much it is trusted (see
 * AUTHORITY): 'official' for the maker's own documentation, 'primary' for standards and papers,
 * 'book' for a free textbook, 'course' for a university's notes, 'reference' for a well-edited
 * reference that is not the maker's. Give `licence` only when the site states one for its text:
 * it is shown under the reading as written here, and an open licence counts for the source in
 * ranking. Leave it out when unsure; never guess one.
 *
 * A site that is not listed can still be used (web search finds it), but it ranks low and has to
 * cover the step much better than a listed one to be chosen.
 */

export type TrustKind = 'official' | 'primary' | 'book' | 'course' | 'reference'

export interface TrustedSite {
  host: string
  /** Only pages under this path, when the host holds other things too */
  path?: string
  /** Who to credit when the page names no author */
  by: string
  kind: TrustKind
  /** As the site states it for its text */
  licence?: string
}

/** How much each kind counts, 0 to 1 (an unlisted site counts UNLISTED) */
export const AUTHORITY: Record<TrustKind, number> = { official: 1, primary: 1, book: 0.9, course: 0.9, reference: 0.75 }
export const UNLISTED = 0.3

const site = (host: string, by: string, kind: TrustKind, licence?: string, path?: string): TrustedSite => ({ host, by, kind, ...(licence ? { licence } : {}), ...(path ? { path } : {}) })

export const TRUSTED: Record<string, TrustedSite[]> = {
  'Programming languages': [
    site('docs.python.org', 'Python documentation', 'official', 'PSF License'),
    site('peps.python.org', 'Python Enhancement Proposals', 'primary'),
    site('doc.rust-lang.org', 'The Rust documentation and The Rust Book', 'official', 'MIT or Apache 2.0'),
    site('en.cppreference.com', 'cppreference', 'reference', 'CC BY-SA 3.0'),
    site('isocpp.org', 'Standard C++ Foundation', 'official'),
    site('go.dev', 'The Go documentation', 'official', 'CC BY 4.0'),
    site('typescriptlang.org', 'TypeScript documentation', 'official'),
    site('nodejs.org', 'Node.js documentation', 'official'),
    site('docs.oracle.com', 'Oracle Java documentation', 'official'),
    site('kotlinlang.org', 'Kotlin documentation', 'official'),
    site('learn.microsoft.com', 'Microsoft Learn', 'official'),
    site('greenteapress.com', 'Allen Downey (Think Python, Think Stats, Think Bayes)', 'book'),
    site('allendowney.github.io', 'Allen Downey (Think Python, Think Stats, Think Bayes)', 'book'),
    site('automatetheboringstuff.com', 'Al Sweigart, Automate the Boring Stuff with Python', 'book'),
    site('eloquentjavascript.net', 'Marijn Haverbeke, Eloquent JavaScript', 'book', 'CC BY-NC 3.0'),
    site('craftinginterpreters.com', 'Robert Nystrom, Crafting Interpreters', 'book')
  ],
  'The web': [
    site('developer.mozilla.org', 'MDN Web Docs', 'official', 'CC BY-SA 2.5'),
    site('html.spec.whatwg.org', 'WHATWG HTML Standard', 'primary', 'CC BY 4.0'),
    site('w3.org', 'W3C', 'primary'),
    site('tc39.es', 'ECMAScript specification', 'primary'),
    site('react.dev', 'React documentation', 'official', 'CC BY 4.0'),
    site('web.dev', 'web.dev (Google)', 'official', 'CC BY 4.0')
  ],
  'Systems and networking': [
    site('kernel.org', 'The Linux kernel documentation', 'official', 'GPL-2.0'),
    site('man7.org', 'Linux man-pages', 'reference'),
    site('pages.cs.wisc.edu', 'Remzi and Andrea Arpaci-Dusseau, Operating Systems: Three Easy Pieces', 'book', undefined, '/~remzi'),
    site('ostep.org', 'Remzi and Andrea Arpaci-Dusseau, Operating Systems: Three Easy Pieces', 'book'),
    site('rfc-editor.org', 'RFC Editor', 'primary'),
    site('datatracker.ietf.org', 'IETF', 'primary'),
    site('gcc.gnu.org', 'GCC documentation', 'official'),
    site('llvm.org', 'LLVM documentation', 'official'),
    site('beej.us', "Beej's Guides", 'book'),
    site('book.systemsapproach.org', 'Peterson and Davie, Computer Networks: A Systems Approach', 'book', 'CC BY 4.0')
  ],
  'Databases and data engineering': [
    site('postgresql.org', 'PostgreSQL documentation', 'official', 'PostgreSQL Licence'),
    site('sqlite.org', 'SQLite documentation', 'official'),
    site('dev.mysql.com', 'MySQL documentation', 'official'),
    site('redis.io', 'Redis documentation', 'official'),
    site('kafka.apache.org', 'Apache Kafka documentation', 'official', 'Apache 2.0'),
    site('spark.apache.org', 'Apache Spark documentation', 'official', 'Apache 2.0'),
    site('duckdb.org', 'DuckDB documentation', 'official'),
    site('docs.getdbt.com', 'dbt documentation', 'official'),
    site('cloud.google.com', 'Google Cloud documentation', 'official'),
    site('docs.snowflake.com', 'Snowflake documentation', 'official'),
    site('use-the-index-luke.com', 'Markus Winand, Use The Index, Luke', 'book')
  ],
  'Distributed systems': [
    site('raft.github.io', 'Ongaro and Ousterhout, the Raft paper and site', 'primary'),
    site('lamport.azurewebsites.net', 'Leslie Lamport', 'primary'),
    site('jepsen.io', 'Jepsen', 'reference'),
    site('pdos.csail.mit.edu', 'MIT PDOS (6.824 / 6.5840)', 'course'),
    site('usenix.org', 'USENIX', 'primary'),
    site('research.google', 'Google Research', 'primary'),
    site('dl.acm.org', 'ACM Digital Library', 'primary'),
    site('etcd.io', 'etcd documentation', 'official'),
    site('kubernetes.io', 'Kubernetes documentation', 'official', 'CC BY 4.0'),
    site('docs.docker.com', 'Docker documentation', 'official', 'Apache 2.0')
  ],
  'Machine learning': [
    site('d2l.ai', 'Zhang, Lipton, Li and Smola, Dive into Deep Learning', 'book', 'CC BY-SA 4.0'),
    site('pytorch.org', 'PyTorch documentation', 'official'),
    site('docs.pytorch.org', 'PyTorch documentation', 'official'),
    site('scikit-learn.org', 'scikit-learn documentation', 'official', 'BSD 3-Clause'),
    site('numpy.org', 'NumPy documentation', 'official', 'BSD 3-Clause'),
    site('pandas.pydata.org', 'pandas documentation', 'official', 'BSD 3-Clause'),
    site('tensorflow.org', 'TensorFlow documentation', 'official', 'CC BY 4.0'),
    site('huggingface.co', 'Hugging Face documentation', 'official', undefined, '/docs'),
    site('deeplearningbook.org', 'Goodfellow, Bengio and Courville, Deep Learning', 'book'),
    site('arxiv.org', 'arXiv', 'primary'),
    site('distill.pub', 'Distill', 'primary', 'CC BY 4.0'),
    site('cs231n.github.io', 'Stanford CS231n notes', 'course'),
    site('web.stanford.edu', 'Stanford course notes', 'course', undefined, '/class'),
    site('neuralnetworksanddeeplearning.com', 'Michael Nielsen, Neural Networks and Deep Learning', 'book', 'CC BY-NC 3.0')
  ],
  'Mathematics and statistics': [
    site('openstax.org', 'OpenStax', 'book'),
    site('ocw.mit.edu', 'MIT OpenCourseWare', 'course', 'CC BY-NC-SA 4.0'),
    site('tutorial.math.lamar.edu', "Paul's Online Math Notes", 'course'),
    site('math.libretexts.org', 'LibreTexts Mathematics', 'book'),
    site('stats.libretexts.org', 'LibreTexts Statistics', 'book'),
    site('probabilitycourse.com', 'Hossein Pishro-Nik, Introduction to Probability, Statistics and Random Processes', 'book'),
    site('openintro.org', 'OpenIntro Statistics', 'book', 'CC BY-SA 3.0'),
    site('linear.axler.net', 'Sheldon Axler, Linear Algebra Done Right', 'book', 'CC BY-NC 4.0'),
    site('mathworld.wolfram.com', 'Wolfram MathWorld', 'reference'),
    site('docs.sympy.org', 'SymPy documentation', 'official', 'BSD 3-Clause')
  ],
  'Finance, payments and blockchains': [
    site('docs.stripe.com', 'Stripe documentation', 'official'),
    site('stripe.com', 'Stripe documentation', 'official', undefined, '/docs'),
    site('bis.org', 'Bank for International Settlements', 'primary'),
    site('federalreserve.gov', 'US Federal Reserve', 'primary'),
    site('bankofengland.co.uk', 'Bank of England', 'primary'),
    site('iso20022.org', 'ISO 20022', 'primary'),
    site('ethereum.org', 'ethereum.org', 'official', 'MIT'),
    site('eips.ethereum.org', 'Ethereum Improvement Proposals', 'primary', 'CC0'),
    site('bitcoin.org', 'bitcoin.org and the Bitcoin paper', 'primary', 'MIT'),
    site('developer.bitcoin.org', 'Bitcoin developer documentation', 'official'),
    site('docs.soliditylang.org', 'Solidity documentation', 'official'),
    site('solana.com', 'Solana documentation', 'official', undefined, '/docs'),
    // Banking standards and regulators' published texts (any-subject build, checked 11 November 2026)
    site('ecb.europa.eu', 'European Central Bank', 'primary'),
    site('fsb.org', 'Financial Stability Board', 'primary'),
    site('fdic.gov', 'US Federal Deposit Insurance Corporation', 'primary'),
    site('eba.europa.eu', 'European Banking Authority', 'primary'),
    site('handbook.fca.org.uk', 'FCA Handbook (UK Financial Conduct Authority)', 'primary'),
    site('investor.gov', 'US SEC, Investor.gov', 'official')
  ],
  'Products and analytics tools': [
    site('docs.mixpanel.com', 'Mixpanel documentation', 'official'),
    site('help.tableau.com', 'Tableau Help', 'official'),
    site('metabase.com', 'Metabase documentation', 'official', undefined, '/docs'),
    site('docs.aws.amazon.com', 'AWS documentation', 'official'),
    site('git-scm.com', 'Git documentation and Pro Git', 'official'),
    site('docs.github.com', 'GitHub documentation', 'official', 'CC BY 4.0'),
    site('grafana.com', 'Grafana documentation', 'official', undefined, '/docs'),
    site('prometheus.io', 'Prometheus documentation', 'official', 'CC BY 4.0'),
    site('docs.anthropic.com', 'Anthropic documentation', 'official'),
    site('platform.openai.com', 'OpenAI documentation', 'official', undefined, '/docs')
  ],
  // The humanities: primary texts first, then scholarly references and university courses. Every
  // address here answered 200 to `curl -sIL -m 15` on 2026-11-11; those that refused are in
  // UNVERIFIED_TRUSTED below
  Philosophy: [
    site('iep.utm.edu', 'Internet Encyclopedia of Philosophy', 'reference'),
    // Greek and Latin texts with translations; the primary texts of classical philosophy and history
    site('perseus.tufts.edu', 'Perseus Digital Library (Tufts University)', 'primary')
  ],
  // Primary texts and scholarly references, not devotional or polemical sites. Each tradition is read
  // in its own texts; a site run by one tradition (New Advent, the Vatican) is a primary source for
  // that tradition's own documents, not a neutral account of others
  'Theology and religious studies': [
    site('ccel.org', 'Christian Classics Ethereal Library (Calvin University)', 'primary'),
    site('newadvent.org', 'New Advent: the Church Fathers in translation', 'primary', undefined, '/fathers'),
    site('vatican.va', 'The Holy See: documents of the Catholic Church', 'primary', undefined, '/archive'),
    site('sefaria.org', 'Sefaria: Jewish texts in Hebrew and translation', 'primary'),
    site('accesstoinsight.org', 'Access to Insight: translations from the Pali Canon', 'primary'),
    // An archive of old public-domain translations: sound for the texts themselves, dated as scholarship
    site('sacred-texts.com', 'Internet Sacred Text Archive (public-domain translations)', 'primary')
  ],
  History: [
    site('avalon.law.yale.edu', 'The Avalon Project: documents in law, history and diplomacy (Yale Law School)', 'primary'),
    site('sourcebooks.fordham.edu', 'Internet History Sourcebooks Project (Fordham University)', 'primary'),
    site('history.state.gov', 'Office of the Historian, US Department of State', 'primary'),
    // The whole site, not only /education: the records themselves are primary sources too
    site('nationalarchives.gov.uk', 'The National Archives (UK)', 'primary'),
    site('oyc.yale.edu', 'Open Yale Courses', 'course', 'CC BY-NC-SA 3.0')
  ],
  Literature: [
    site('gutenberg.org', 'Project Gutenberg', 'book', 'Public domain in the USA'),
    site('standardebooks.org', 'Standard Ebooks', 'book', 'Public domain in the USA; CC0 1.0 for the edition')
  ],
  // The areas below were added for teaching any subject (src/shared/subjects.ts maps each kind of
  // subject to its areas). Every host answered `curl -sIL -m 15` with 200 on 11 November 2026, except
  // m3.material.io, which refuses HEAD (405) and answered a GET with 200. Hosts the network refused
  // are in UNCHECKED_TRUSTED, apart, until they can be checked.
  Physics: [
    site('phys.libretexts.org', 'LibreTexts Physics', 'book'),
    site('hyperphysics.phy-astr.gsu.edu', 'HyperPhysics (Georgia State University)', 'reference'),
    site('physics.nist.gov', 'NIST Physical Measurement Laboratory (constants and units)', 'primary'),
    site('nasa.gov', 'NASA', 'reference')
  ],
  Chemistry: [
    site('chem.libretexts.org', 'LibreTexts Chemistry', 'book'),
    site('pubchem.ncbi.nlm.nih.gov', 'PubChem (US National Library of Medicine)', 'reference'),
    site('webbook.nist.gov', 'NIST Chemistry WebBook', 'primary')
  ],
  'Biology and medicine': [
    site('bio.libretexts.org', 'LibreTexts Biology', 'book'),
    site('ncbi.nlm.nih.gov', 'NCBI Bookshelf (US National Library of Medicine)', 'book', undefined, '/books'),
    site('pubmed.ncbi.nlm.nih.gov', 'PubMed', 'primary'),
    site('medlineplus.gov', 'MedlinePlus (US National Library of Medicine)', 'reference'),
    site('nlm.nih.gov', 'US National Library of Medicine', 'official'),
    site('genome.gov', 'National Human Genome Research Institute', 'official'),
    site('ebi.ac.uk', 'EMBL-EBI', 'official'),
    site('rcsb.org', 'RCSB Protein Data Bank', 'primary'),
    site('who.int', 'World Health Organization', 'primary'),
    site('cdc.gov', 'US Centers for Disease Control and Prevention', 'primary')
  ],
  Economics: [
    site('core-econ.org', 'CORE Econ, The Economy', 'book'),
    site('fred.stlouisfed.org', 'FRED (Federal Reserve Bank of St. Louis)', 'primary'),
    site('imf.org', 'International Monetary Fund', 'primary'),
    site('data.worldbank.org', 'World Bank Open Data', 'primary'),
    site('nber.org', 'National Bureau of Economic Research', 'primary'),
    site('ourworldindata.org', 'Our World in Data', 'reference', 'CC BY 4.0')
  ],
  Accounting: [
    site('ifrs.org', 'IFRS Foundation (IASB standards)', 'primary'),
    site('iasplus.com', 'Deloitte IAS Plus', 'reference'),
    site('frc.org.uk', 'UK Financial Reporting Council', 'primary')
  ],
  Law: [
    site('legislation.gov.uk', 'legislation.gov.uk (The National Archives)', 'primary'),
    site('law.cornell.edu', 'Legal Information Institute, Cornell Law School', 'reference'),
    site('supremecourt.gov', 'Supreme Court of the United States', 'primary'),
    site('supremecourt.uk', 'The Supreme Court of the United Kingdom', 'primary'),
    site('bailii.org', 'BAILII (British and Irish Legal Information Institute)', 'primary'),
    site('ecfr.gov', 'Electronic Code of Federal Regulations', 'primary')
  ],
  'Game development and graphics': [
    site('docs.godotengine.org', 'Godot Engine documentation', 'official'),
    site('learnopengl.com', 'Joey de Vries, LearnOpenGL', 'book'),
    site('gameprogrammingpatterns.com', 'Robert Nystrom, Game Programming Patterns', 'book'),
    site('docs.unity3d.com', 'Unity documentation', 'official'),
    site('dev.epicgames.com', 'Unreal Engine documentation', 'official', undefined, '/documentation'),
    site('khronos.org', 'Khronos Group (OpenGL, Vulkan, WebGL)', 'primary'),
    site('gafferongames.com', 'Glenn Fiedler, Gaffer On Games', 'reference'),
    site('redblobgames.com', 'Amit Patel, Red Blob Games', 'reference')
  ],
  'Music and design': [
    site('musictheory.pugetsound.edu', 'Robert Hutchinson, Music Theory for the 21st-Century Classroom', 'book'),
    site('musictheory.net', 'musictheory.net', 'reference'),
    site('developer.apple.com', 'Apple Human Interface Guidelines', 'official', undefined, '/design'),
    site('developer.android.com', 'Android design guidance', 'official', undefined, '/design'),
    site('m3.material.io', 'Material Design 3', 'official'),
    site('designsystem.digital.gov', 'US Web Design System', 'official'),
    site('nngroup.com', 'Nielsen Norman Group', 'reference', undefined, '/articles'),
    site('lawsofux.com', 'Jon Yablonski, Laws of UX', 'reference'),
    site('practicaltypography.com', 'Matthew Butterick, Practical Typography', 'book')
  ],
  // Gutenberg, Avalon, Fordham, Perseus and the UK National Archives are in the humanities areas
  // above (Literature, History, Philosophy), which the interpret and narrative kinds also read from
  'History, texts and languages': [
    site('archives.gov', 'US National Archives', 'primary'),
    site('loc.gov', 'Library of Congress', 'primary'),
    site('wals.info', 'World Atlas of Language Structures', 'reference', 'CC BY 4.0')
  ],
  'General reference': [
    site('en.wikipedia.org', 'Wikipedia', 'reference', 'CC BY-SA 4.0'),
    site('plato.stanford.edu', 'Stanford Encyclopedia of Philosophy', 'reference')
  ]
}

/**
 * Good sources for the new areas that could not be checked when they were added (11 November 2026):
 * each refused `curl -sIL -m 15` from the Mac it was checked on (403, a bot challenge, or no
 * connection). They are not trusted in ranking until checked again; move one into TRUSTED once
 * `curl -sIL -m 15 https://<host>/` answers 200 from the learner's network.
 */
export const UNCHECKED_TRUSTED: Record<string, TrustedSite[]> = {
  Physics: [site('feynmanlectures.caltech.edu', 'The Feynman Lectures on Physics (Caltech)', 'book')],
  Chemistry: [site('goldbook.iupac.org', 'IUPAC Gold Book', 'primary')],
  Economics: [site('oecd.org', 'OECD', 'primary')],
  'Finance, payments and blockchains': [
    site('swift.com', 'SWIFT standards (public pages)', 'primary', undefined, '/standards'),
    site('europeanpaymentscouncil.eu', 'European Payments Council (SEPA rulebooks)', 'primary'),
    site('fatf-gafi.org', 'Financial Action Task Force', 'primary'),
    site('sec.gov', 'US Securities and Exchange Commission', 'primary')
  ],
  Accounting: [site('fasb.org', 'Financial Accounting Standards Board', 'primary')],
  Law: [site('eur-lex.europa.eu', 'EUR-Lex (EU law)', 'primary'), site('congress.gov', 'Congress.gov', 'primary'), site('courtlistener.com', 'CourtListener (Free Law Project)', 'primary')],
  'Game development and graphics': [
    site('raytracing.github.io', 'Peter Shirley, Ray Tracing in One Weekend', 'book'),
    site('gpuweb.github.io', 'W3C WebGPU specification', 'primary'),
    site('realtimerendering.com', 'Real-Time Rendering resources', 'reference')
  ],
  'Music and design': [site('viva.pressbooks.pub', 'Open Music Theory', 'book', undefined, '/openmusictheory'), site('openmusictheory.github.io', 'Open Music Theory (first edition)', 'book')]
}

/**
 * Sites that belong in the list but could not be checked when it was made: each refused the plain
 * request (`curl -sIL -m 15`) from the owner's network. They are offered as trusted all the same;
 * check them again before relying on them, and move each up into TRUSTED once it answers. (Unlike
 * UNCHECKED_TRUSTED above, which waits to be checked before it counts, these two count now.)
 *   philpapers.org: 403. Only its openly readable entries would count (PhilArchive's free papers).
 *   earlychristianwritings.com: 406 to a plain request (it answers a browser). A useful index of
 *     early Christian texts in translation, run by one person: a finding aid, not a scholarly edition.
 */
export const UNVERIFIED_TRUSTED: Record<string, TrustedSite[]> = {
  Philosophy: [site('philpapers.org', 'PhilPapers (openly readable entries only)', 'reference')],
  'Theology and religious studies': [site('earlychristianwritings.com', 'Early Christian Writings', 'reference')]
}

const ALL: TrustedSite[] = [...Object.values(TRUSTED), ...Object.values(UNVERIFIED_TRUSTED)].flat()

export const trustedCount = () => ALL.length

/** The listed site a page belongs to, if any: by host (or a subdomain of it) and, where given, path */
export function trustedSite(url: string): TrustedSite | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  let best: TrustedSite | null = null
  for (const s of ALL) {
    if (host !== s.host && !host.endsWith(`.${s.host}`)) continue
    if (s.path && !u.pathname.startsWith(s.path)) continue
    // The most specific entry wins (a host with a path over the bare host)
    if (!best || s.host.length + (s.path?.length ?? 0) > best.host.length + (best.path?.length ?? 0)) best = s
  }
  return best
}

/** University sites not listed by name: course notes are usually sound, but nobody has looked at this one */
export const academicHost = (url: string) => {
  try {
    return /\.(edu|ac\.[a-z]{2})$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

const OPEN = /\b(CC0|CC BY(?!-ND)|Creative Commons|Public domain|MIT|Apache|BSD|GPL|GFDL|PSF License|PostgreSQL Licence)\b/i

/** A licence that lets the text be quoted and passed on (not "no derivatives", not all rights reserved) */
export const openLicence = (licence?: string) => !!licence && OPEN.test(licence) && !/\bND\b|NoDerivatives/i.test(licence)

/** A licence a page states for itself, read from its text: only the common, unambiguous forms */
export function statedLicence(text: string): string | undefined {
  const tail = text.length > 6000 ? `${text.slice(0, 2000)}\n${text.slice(-4000)}` : text
  const cc = tail.match(/\b(?:CC|Creative Commons)[ -](BY(?:-(?:NC|SA|ND)){0,2})(?:[ -](\d\.\d))?/i)
  if (cc) return `CC ${cc[1].toUpperCase()}${cc[2] ? ` ${cc[2]}` : ''}`
  const long = tail.match(/Creative Commons (Attribution(?:[- ](?:NonCommercial|ShareAlike|NoDerivatives|NoDerivs))*)(?: (\d\.\d))?/i)
  if (long) {
    const parts = long[1].replace(/Attribution/i, 'BY').replace(/NonCommercial/i, 'NC').replace(/ShareAlike/i, 'SA').replace(/NoDeriv(ative)?s/i, 'ND').split(/[- ]/).filter(Boolean)
    return `CC ${parts.join('-')}${long[2] ? ` ${long[2]}` : ''}`
  }
  if (/\b(released into|in) the public domain\b|\bCC0\b/i.test(tail)) return 'Public domain'
  return undefined
}
