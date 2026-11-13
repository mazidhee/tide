/**
 * Open courses on GitHub that Tide can import and teach from (shared/courses has the parsing, main/courses
 * the fetching). Only what is written here ships with the app: names, links, licences and what each
 * one covers. A course's own text is fetched onto this Mac when you import it, read there for your
 * own study (like a web page you open), and shown in lessons with its source and licence; it is
 * never bundled into Tide.
 *
 * Each licence was read in the repository itself (its LICENSE file, or its README where there is no
 * file) on 11 Nov 2026. `tier` says what that licence allows:
 *   open      a licence that allows copying with attribution (MIT, Apache-2.0, BSD, CC BY, CC BY-SA, CC0)
 *   personal  no licence, a non-commercial or no-derivatives licence, or prose kept out of the
 *             licence: fetched and read on your own Mac for personal study, never redistributed
 *
 * To add a course: one entry below, then `npx vitest run test/courses.test.ts` (it checks ids,
 * areas, licences and options). Layout options are described on `CatalogueCourse`.
 */

import { WEB_COURSES } from './courseCatalogueWeb'
import type { CleanRules } from './pageClean'

export type CourseArea = 'payments' | 'blockchain' | 'quant' | 'econ' | 'data' | 'mlops' | 'ml' | 'dl' | 'cs' | 'systems' | 'swe' | 'design' | 'algo' | 'maths' | 'physics'

export const AREAS: { id: CourseArea; label: string; blurb: string }[] = [
  { id: 'payments', label: 'Payments and banking', blurb: 'Payment rails, messaging, core and open banking, ledgers' },
  { id: 'blockchain', label: 'Blockchain and stablecoins', blurb: 'Bitcoin, Ethereum, cryptography and digital money' },
  { id: 'quant', label: 'Quantitative finance and risk', blurb: 'Asset pricing, derivatives, risk and financial markets' },
  { id: 'econ', label: 'Economics', blurb: 'Micro, macro, game theory and computational economics' },
  { id: 'data', label: 'Data engineering', blurb: 'Pipelines, warehouses, orchestration, streaming' },
  { id: 'mlops', label: 'ML engineering', blurb: 'Shipping, serving and running models' },
  { id: 'ml', label: 'Machine learning', blurb: 'Models, statistics and data science' },
  { id: 'dl', label: 'Deep learning and LLMs', blurb: 'Neural networks from scratch to transformers' },
  { id: 'cs', label: 'Computer science', blurb: 'Whole curricula and the tools of the trade' },
  { id: 'systems', label: 'Systems and databases', blurb: 'Operating systems, databases, distributed systems' },
  { id: 'swe', label: 'Software engineering', blurb: 'Languages and the craft of writing code' },
  { id: 'design', label: 'System design', blurb: 'Building for scale' },
  { id: 'algo', label: 'Algorithms and interviews', blurb: 'Data structures, algorithms, interview prep' },
  { id: 'maths', label: 'Maths', blurb: 'Linear algebra, numerical methods, probability' },
  { id: 'physics', label: 'Physics and simulation', blurb: 'Fluids, filters, quantum computing' }
]

export type LicenceTier = 'open' | 'personal'

/**
 * Where a course comes from, and so which adapter reads it (main/sources):
 *   github       a repository (the original kind), its Markdown and notebooks
 *   ocw          an MIT OpenCourseWare course: lectures with their videos, captions and notes, problem sets
 *   yale         an Open Yale Courses course: sessions with video, transcript and readings, exams
 *   jupyterbook  a Jupyter Book: its _toc.yml order, its notebooks runnable (QuantEcon)
 *   site         a free online book with an open table of contents (mdBook, Jupyter Book, Sphinx, Quarto, bookdown)
 *   youtube      a YouTube playlist of a lecture series: each video a lesson, with its transcript
 *   docs         official guides and docs read in a set order (pages listed, HTML or PDF)
 */
export type SourceKind = 'github' | 'ocw' | 'yale' | 'jupyterbook' | 'site' | 'youtube' | 'docs'

export const SOURCES: Record<SourceKind, { label: string; site: string }> = {
  github: { label: 'GitHub', site: 'github.com' },
  ocw: { label: 'MIT OpenCourseWare', site: 'ocw.mit.edu' },
  yale: { label: 'Open Yale Courses', site: 'oyc.yale.edu' },
  jupyterbook: { label: 'Jupyter Book', site: '' },
  site: { label: 'Online book', site: '' },
  youtube: { label: 'YouTube lectures', site: 'youtube.com' },
  docs: { label: 'Official guide', site: '' }
}

/** A page of a guide read as a course, in order */
export interface GuidePage {
  title: string
  url: string
  /** The module it starts or belongs to (pages without one join the module before them) */
  module?: string
}

export interface CatalogueCourse {
  /** Stable: progress and the copy on disk are kept under it */
  id: string
  /** Where it comes from (GitHub when unset) */
  source?: SourceKind
  /** owner/name on GitHub (a github or jupyterbook course) */
  repo?: string
  branch?: string
  /** Its home on the web: the course page, the book's contents page, the guide's start (anything not on GitHub) */
  url?: string
  /** A YouTube playlist's id (a youtube course) */
  playlist?: string
  /** A book site's table of contents, when Tide can't find it by itself: a CSS selector */
  toc?: string
  /** A Jupyter Book's _toc.yml, as a URL, when the repository read is not the one that holds it (a .notebooks repository) */
  jbToc?: string
  /** A guide's pages, in order (a docs course) */
  pages?: GuidePage[]
  /** What it is mostly made of, for the filters (worked out from the source when unset) */
  media?: 'video' | 'text' | 'mixed'
  /** At most this many pages are fetched (a big book is cut short, politely) */
  maxPages?: number
  title: string
  /** Who wrote it, as they name themselves */
  by: string
  area: CourseArea
  /** The licence as the repository states it (SPDX where there is one) */
  licence: string
  tier: LicenceTier
  /** What the licence covers when it is not the whole repository, or where it was found */
  licenceNote?: string
  /** One line: what it teaches */
  covers: string
  kind: 'course' | 'book' | 'notes' | 'projects' | 'guide'
  level: 'beginner' | 'intermediate' | 'advanced'
  /** Phrases that name what it teaches (lower case), for suggesting it when you say what you want to learn */
  topics: string[]
  /** Where its lessons are in the repository (the root when unset) */
  root?: string
  /** Only the top-level folders (under root) whose names match this are modules */
  modules?: string
  /** Paths (under the repository) left out: a prefix, or a /regex/ */
  skip?: string[]
  /** A single long file read as the course: its ## headings are modules, ### lessons */
  split?: string
  /** Homework kept apart, per cohort: dir/<latest cohort>/<module folder>/homework.md is that module's homework */
  homework?: { dir: string }
  /** Each lesson exists in two languages, the English one named name.en.md */
  english?: 'suffix'
  /** Names for module folders that aren't in English */
  moduleTitles?: Record<string, string>
  /** For a flat course whose file names don't give the order: the files, in order (others follow) */
  order?: string[]
  /**
   * Its own rules for what in its pages is noise, beside the ones every course gets (shared/pageClean):
   * regular expressions (case-insensitive) matched against a section's heading or a block's text.
   * `keep` is never hidden, `drop` always is.
   */
  clean?: CleanRules
}

const PERSONAL = 'No licence is stated: fetched to this Mac for your own study only, never redistributed'

/** DataTalksClub's Zoomcamps: the README's cohort logistics (certificates, the quick-links table) aren't lessons */
const ZOOMCAMP_CLEAN: CleanRules = { drop: ['^certificates?$', '^quick links$', '^certification$'] }

const GITHUB_COURSES: CatalogueCourse[] = [
  // ---------- Data engineering ----------
  {
    id: 'de-zoomcamp',
    repo: 'DataTalksClub/data-engineering-zoomcamp',
    branch: 'main',
    title: 'Data Engineering Zoomcamp',
    by: 'DataTalksClub',
    area: 'data',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'Docker, Terraform, workflow orchestration, BigQuery, dbt, Spark batch and Kafka streaming, with weekly homework',
    kind: 'course',
    level: 'intermediate',
    topics: ['data engineering', 'data pipeline', 'docker', 'terraform', 'workflow orchestration', 'kestra', 'data warehouse', 'bigquery', 'dbt', 'analytics engineering', 'spark', 'batch processing', 'kafka', 'stream processing', 'streaming'],
    modules: '^\\d\\d-',
    homework: { dir: 'cohorts' },
    clean: ZOOMCAMP_CLEAN
  },
  {
    id: 'de-handbook',
    repo: 'DataExpert-io/data-engineer-handbook',
    branch: 'main',
    title: 'Data Engineer Handbook',
    by: 'Zach Wilson and DataExpert.io',
    area: 'data',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'Free bootcamp material on dimensional modelling, fact data, Spark, streaming and data quality, plus a reading list',
    kind: 'course',
    level: 'intermediate',
    topics: ['data engineering', 'dimensional modeling', 'dimensional modelling', 'fact tables', 'slowly changing dimensions', 'spark', 'flink', 'data quality', 'data modeling', 'data modelling'],
    modules: 'bootcamp'
  },
  {
    id: 'de-cookbook',
    repo: 'andkret/Cookbook',
    branch: 'master',
    title: 'The Data Engineering Cookbook',
    by: 'Andreas Kretz',
    area: 'data',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'The basics of data engineering: platform architecture, ingestion, storage, processing and case studies',
    kind: 'book',
    level: 'beginner',
    topics: ['data engineering', 'data platform', 'data lake', 'etl', 'elt', 'hadoop', 'lambda architecture', 'data ingestion'],
    root: 'sections'
  },

  // ---------- ML engineering ----------
  {
    id: 'mlops-zoomcamp',
    repo: 'DataTalksClub/mlops-zoomcamp',
    branch: 'main',
    title: 'MLOps Zoomcamp',
    by: 'DataTalksClub',
    area: 'mlops',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'Experiment tracking with MLflow, orchestration, deployment as a web service, batch and streaming, monitoring and best practices',
    kind: 'course',
    level: 'intermediate',
    topics: ['mlops', 'ml engineering', 'machine learning engineering', 'mlflow', 'experiment tracking', 'model registry', 'model deployment', 'model monitoring', 'evidently', 'ml pipelines'],
    modules: '^\\d\\d-',
    homework: { dir: 'cohorts' },
    clean: ZOOMCAMP_CLEAN
  },
  {
    id: 'made-with-ml',
    repo: 'GokuMohandas/Made-With-ML',
    branch: 'main',
    title: 'Made With ML',
    by: 'Goku Mohandas',
    area: 'mlops',
    licence: 'MIT',
    tier: 'open',
    covers: 'Design, develop, deploy and iterate on a production ML system: data, training, tuning, evaluation, serving and testing',
    kind: 'course',
    level: 'intermediate',
    topics: ['mlops', 'ml engineering', 'machine learning engineering', 'ml system design', 'model serving', 'ray', 'testing ml', 'production machine learning'],
    split: 'notebooks/madewithml.ipynb'
  },
  {
    id: 'ml-systems-design',
    repo: 'chiphuyen/machine-learning-systems-design',
    branch: 'master',
    title: 'Machine Learning Systems Design',
    by: 'Chip Huyen',
    area: 'mlops',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'The booklet on designing ML systems: the project flow, data, modelling, serving, with case studies and 27 exercises',
    kind: 'book',
    level: 'intermediate',
    topics: ['ml system design', 'machine learning systems design', 'ml systems', 'ml interviews'],
    root: 'content'
  },
  {
    id: 'ml-engineering',
    repo: 'stas00/ml-engineering',
    branch: 'master',
    title: 'Machine Learning Engineering Open Book',
    by: 'Stas Bekman',
    area: 'mlops',
    licence: 'CC-BY-SA-4.0',
    tier: 'open',
    licenceNote: 'Text under CC BY-SA 4.0; code under Apache-2.0',
    covers: 'Training large models in practice: compute, storage, networks, orchestration, parallelism, debugging and stability',
    kind: 'book',
    level: 'advanced',
    topics: ['llm training', 'distributed training', 'model parallelism', 'gpu', 'slurm', 'inference', 'nccl', 'large language model training'],
    skip: ['build', 'resources']
  },
  {
    id: 'fsdl-labs',
    repo: 'the-full-stack/fsdl-text-recognizer-2022-labs',
    branch: 'main',
    title: 'Full Stack Deep Learning labs',
    by: 'Full Stack Deep Learning',
    area: 'mlops',
    licence: 'MIT',
    tier: 'open',
    covers: 'Build a handwriting recogniser end to end: PyTorch Lightning, experiment management, testing, deployment and monitoring',
    kind: 'projects',
    level: 'advanced',
    topics: ['full stack deep learning', 'pytorch lightning', 'ml deployment', 'ml testing', 'text recognition'],
    modules: '^lab\\d'
  },
  {
    id: 'llm-zoomcamp',
    repo: 'DataTalksClub/llm-zoomcamp',
    branch: 'main',
    title: 'LLM Zoomcamp',
    by: 'DataTalksClub',
    area: 'mlops',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'Agentic RAG, vector search, evaluation and monitoring of LLM applications',
    kind: 'course',
    level: 'intermediate',
    topics: ['rag', 'retrieval augmented generation', 'vector search', 'llm applications', 'llm evaluation', 'agents', 'embeddings'],
    modules: '^\\d\\d-',
    homework: { dir: 'cohorts' },
    clean: ZOOMCAMP_CLEAN
  },

  // ---------- Machine learning ----------
  {
    id: 'ml-zoomcamp',
    repo: 'DataTalksClub/machine-learning-zoomcamp',
    branch: 'main',
    title: 'Machine Learning Zoomcamp',
    by: 'DataTalksClub',
    area: 'ml',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'Regression, classification, evaluation, deployment, trees, deep learning, serverless and Kubernetes',
    kind: 'course',
    level: 'beginner',
    topics: ['machine learning', 'regression', 'linear regression', 'logistic regression', 'classification', 'model evaluation', 'decision trees', 'xgboost', 'kubernetes', 'serverless'],
    modules: '^\\d\\d-',
    homework: { dir: 'cohorts' },
    clean: ZOOMCAMP_CLEAN
  },
  {
    id: 'ml-for-beginners',
    repo: 'microsoft/ML-For-Beginners',
    branch: 'main',
    title: 'Machine Learning for Beginners',
    by: 'Microsoft',
    area: 'ml',
    licence: 'MIT',
    tier: 'open',
    covers: 'Twelve weeks of classic machine learning with scikit-learn: regression, classification, clustering, NLP, time series, reinforcement learning',
    kind: 'course',
    level: 'beginner',
    topics: ['machine learning', 'scikit-learn', 'sklearn', 'regression', 'classification', 'clustering', 'time series', 'reinforcement learning', 'nlp'],
    modules: '^\\d-',
    skip: ['/solution/', '/translations?/']
  },
  {
    id: 'ds-for-beginners',
    repo: 'microsoft/Data-Science-For-Beginners',
    branch: 'main',
    title: 'Data Science for Beginners',
    by: 'Microsoft',
    area: 'ml',
    licence: 'MIT',
    tier: 'open',
    covers: 'Ten weeks of data science: ethics, working with data, visualisation, the data science lifecycle and the cloud',
    kind: 'course',
    level: 'beginner',
    topics: ['data science', 'pandas', 'data visualization', 'data visualisation', 'statistics', 'data cleaning'],
    modules: '^\\d-',
    skip: ['/solution/', '/translations?/']
  },
  {
    id: 'python-ds-handbook',
    repo: 'jakevdp/PythonDataScienceHandbook',
    branch: 'master',
    title: 'Python Data Science Handbook',
    by: 'Jake VanderPlas',
    area: 'ml',
    licence: 'CC-BY-NC-ND-3.0 (text), MIT (code)',
    tier: 'personal',
    licenceNote: 'The text is CC BY-NC-ND 3.0: read on this Mac for personal study; the code is MIT',
    covers: 'IPython, NumPy, Pandas, Matplotlib and scikit-learn, as runnable notebooks',
    kind: 'book',
    level: 'beginner',
    topics: ['numpy', 'pandas', 'matplotlib', 'scikit-learn', 'data science', 'python for data'],
    root: 'notebooks'
  },
  {
    id: 'handson-ml3',
    repo: 'ageron/handson-ml3',
    branch: 'main',
    title: 'Hands-On Machine Learning notebooks',
    by: 'Aurélien Géron',
    area: 'ml',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'The notebooks of the book: from end-to-end projects and classic models to deep learning with Keras',
    kind: 'book',
    level: 'intermediate',
    topics: ['machine learning', 'scikit-learn', 'keras', 'tensorflow', 'deep learning', 'support vector machines', 'decision trees', 'ensemble learning'],
    skip: ['/^tools_/', '/^math_/', '/^extra_/', 'index.ipynb']
  },
  {
    id: 'bayesian-hackers',
    repo: 'CamDavidsonPilon/Probabilistic-Programming-and-Bayesian-Methods-for-Hackers',
    branch: 'master',
    title: 'Bayesian Methods for Hackers',
    by: 'Cameron Davidson-Pilon',
    area: 'ml',
    licence: 'MIT',
    tier: 'open',
    covers: 'Bayesian inference through computation: PyMC, MCMC, the law of large numbers, loss functions and priors',
    kind: 'book',
    level: 'intermediate',
    topics: ['bayesian', 'bayesian inference', 'bayesian statistics', 'pymc', 'mcmc', 'probabilistic programming'],
    modules: '^Chapter'
  },
  {
    id: 'rl-dennybritz',
    repo: 'dennybritz/reinforcement-learning',
    branch: 'master',
    title: 'Reinforcement Learning exercises',
    by: 'Denny Britz',
    area: 'ml',
    licence: 'MIT',
    tier: 'open',
    covers: 'Sutton and Barto and David Silver’s course as exercises: MDPs, dynamic programming, Monte Carlo, TD, function approximation, DQN, policy gradients',
    kind: 'projects',
    level: 'intermediate',
    topics: ['reinforcement learning', 'q-learning', 'dqn', 'policy gradient', 'markov decision process', 'temporal difference'],
    order: ['Introduction', 'MDP', 'DP', 'MC', 'TD', 'FA', 'DQN', 'PolicyGradient']
  },

  // ---------- Deep learning and LLMs ----------
  {
    id: 'nn-zero-to-hero',
    repo: 'karpathy/nn-zero-to-hero',
    branch: 'master',
    title: 'Neural Networks: Zero to Hero',
    by: 'Andrej Karpathy',
    area: 'dl',
    licence: 'MIT',
    tier: 'open',
    covers: 'Backpropagation from scratch (micrograd), language models (makemore), up to building GPT, as notebooks',
    kind: 'course',
    level: 'intermediate',
    topics: ['neural networks', 'backpropagation', 'micrograd', 'makemore', 'language model', 'gpt', 'deep learning from scratch', 'batchnorm'],
    root: 'lectures'
  },
  {
    id: 'd2l',
    repo: 'd2l-ai/d2l-en',
    branch: 'master',
    title: 'Dive into Deep Learning',
    by: 'Aston Zhang, Zachary Lipton, Mu Li and Alexander Smola',
    area: 'dl',
    licence: 'CC-BY-SA-4.0',
    tier: 'open',
    licenceNote: 'Text under CC BY-SA 4.0 (LICENSE); sample code under MIT-0 (LICENSE-SAMPLECODE)',
    covers: 'The interactive deep learning book: linear networks, MLPs, CNNs, RNNs, attention and transformers, optimisation, vision and NLP',
    kind: 'book',
    level: 'intermediate',
    topics: ['deep learning', 'neural networks', 'convolutional neural networks', 'cnn', 'recurrent neural networks', 'rnn', 'attention', 'transformers', 'optimization', 'pytorch'],
    modules: '^chapter_'
  },
  {
    id: 'cs231n',
    repo: 'cs231n/cs231n.github.io',
    branch: 'master',
    title: 'CS231n course notes',
    by: 'Stanford CS231n (Andrej Karpathy and others)',
    area: 'dl',
    licence: 'MIT',
    tier: 'open',
    covers: 'Stanford’s notes on image classification, linear classifiers, optimisation, backprop, neural networks and convolutional networks',
    kind: 'notes',
    level: 'intermediate',
    topics: ['convolutional neural networks', 'cnn', 'computer vision', 'image classification', 'backpropagation', 'neural networks', 'linear classifier', 'softmax'],
    skip: ['assignments', 'Readme.md', '/^poster/', 'aws-tutorial', 'terminal-tutorial', 'jupyter-colab-tutorial', 'setup.md', 'choose-project', 'overview.md'],
    order: ['python-numpy-tutorial.md', 'classification.md', 'linear-classify.md', 'optimization-1.md', 'optimization-2.md', 'neural-networks-1.md', 'neural-networks-2.md', 'neural-networks-3.md', 'neural-networks-case-study.md', 'convolutional-networks.md', 'understanding-cnn.md', 'transfer-learning.md', 'convnet-tips.md', 'rnn.md', 'attention.md', 'transformers.md']
  },
  {
    id: 'llm-course',
    repo: 'mlabonne/llm-course',
    branch: 'main',
    title: 'The LLM course',
    by: 'Maxime Labonne',
    area: 'dl',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'A roadmap with notes on LLM fundamentals, the LLM scientist (training, fine-tuning, alignment) and the LLM engineer (RAG, agents, deployment)',
    kind: 'guide',
    level: 'intermediate',
    topics: ['llm', 'large language models', 'fine-tuning', 'fine tuning', 'quantization', 'rlhf', 'rag', 'llm engineering', 'agents'],
    split: 'README.md'
  },
  {
    id: 'llms-from-scratch',
    repo: 'rasbt/LLMs-from-scratch',
    branch: 'main',
    title: 'Build a Large Language Model (From Scratch)',
    by: 'Sebastian Raschka',
    area: 'dl',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'The code of the book as notebooks: tokenising, attention, a GPT model, pretraining and fine-tuning',
    kind: 'book',
    level: 'intermediate',
    topics: ['llm from scratch', 'gpt', 'attention', 'self-attention', 'tokenizer', 'tokenization', 'pretraining', 'fine-tuning', 'transformer'],
    modules: '^(ch\\d|appendix)',
    skip: ['/bonus/i', '/0[2-9]_/', '/exercise-solutions/']
  },
  {
    id: 'annotated-papers',
    repo: 'labmlai/annotated_deep_learning_paper_implementations',
    branch: 'master',
    title: 'Annotated deep learning paper implementations',
    by: 'labml.ai',
    area: 'dl',
    licence: 'MIT',
    tier: 'open',
    covers: 'Transformers, diffusion, GANs, RL and optimisers, each with a short explanation beside its code',
    kind: 'notes',
    level: 'advanced',
    topics: ['transformer', 'diffusion', 'gan', 'attention', 'lora', 'paper implementations'],
    root: 'labml_nn'
  },
  {
    id: 'ai-for-beginners',
    repo: 'microsoft/AI-For-Beginners',
    branch: 'main',
    title: 'AI for Beginners',
    by: 'Microsoft',
    area: 'dl',
    licence: 'MIT',
    tier: 'open',
    covers: 'Twelve weeks of AI: symbolic AI, neural networks, computer vision, NLP, genetic algorithms and multi-agent systems',
    kind: 'course',
    level: 'beginner',
    topics: ['artificial intelligence', 'neural networks', 'computer vision', 'nlp', 'genetic algorithms', 'perceptron'],
    root: 'lessons',
    skip: ['/translations?/', '/solution/']
  },
  {
    id: 'genai-for-beginners',
    repo: 'microsoft/generative-ai-for-beginners',
    branch: 'main',
    title: 'Generative AI for Beginners',
    by: 'Microsoft',
    area: 'dl',
    licence: 'MIT',
    tier: 'open',
    covers: 'Twenty-one lessons on building with LLMs: prompting, chat and search apps, RAG, function calling, agents and fine-tuning',
    kind: 'course',
    level: 'beginner',
    topics: ['generative ai', 'prompt engineering', 'llm applications', 'rag', 'function calling', 'ai agents', 'embeddings'],
    modules: '^\\d\\d-',
    skip: ['/translations?/']
  },
  {
    id: 'fastbook',
    repo: 'fastai/fastbook',
    branch: 'master',
    title: 'Deep Learning for Coders (fastbook)',
    by: 'Jeremy Howard and Sylvain Gugger',
    area: 'dl',
    licence: 'GPL-3.0 (code); prose not licensed for redistribution',
    tier: 'personal',
    licenceNote: 'The authors allow copies for your own private use only: read on this Mac, never redistributed',
    covers: 'The fastai book as notebooks: training models from the first lesson, then how they work underneath',
    kind: 'book',
    level: 'beginner',
    topics: ['deep learning', 'fastai', 'pytorch', 'neural networks', 'computer vision', 'collaborative filtering', 'nlp'],
    skip: ['clean', 'translations', 'app_', '/^\\d+_.*\\.md$/']
  },

  // ---------- Computer science ----------
  {
    id: 'ossu-cs',
    repo: 'ossu/computer-science',
    branch: 'master',
    title: 'OSSU Computer Science',
    by: 'Open Source Society University',
    area: 'cs',
    licence: 'MIT',
    tier: 'open',
    covers: 'A complete computer science degree from free courses: the curriculum, with what to take and in which order',
    kind: 'guide',
    level: 'beginner',
    topics: ['computer science', 'cs degree', 'cs curriculum', 'self-taught computer science'],
    split: 'README.md'
  },
  {
    id: 'cs-self-learning',
    repo: 'PKUFlyingPig/cs-self-learning',
    branch: 'master',
    title: 'CS Self-Learning Guide',
    by: 'Yinmin Zhong (PKUFlyingPig) and contributors',
    area: 'cs',
    licence: 'MIT',
    tier: 'open',
    covers: 'A guide to the best open CS courses in the world, subject by subject, with notes on each',
    kind: 'guide',
    level: 'beginner',
    topics: ['computer science', 'cs courses', 'self-taught computer science', 'cs curriculum'],
    root: 'docs',
    english: 'suffix',
    moduleTitles: {
      必学工具: 'Productivity toolkit',
      数学基础: 'Fundamental mathematics',
      数学进阶: 'Advanced mathematics',
      编程入门: 'Fundamental programming',
      电子基础: 'Fundamental electronics',
      数据结构与算法: 'Data structures and algorithms',
      软件工程: 'Software engineering',
      计算机系统基础: 'Computer systems principles',
      体系结构: 'Computer architecture',
      操作系统: 'Operating systems',
      并行与分布式系统: 'Distributed systems',
      系统安全: 'Computer security',
      计算机网络: 'Computer networking',
      数据库系统: 'Database systems',
      编译原理: 'Compilers',
      编程语言设计与分析: 'Programming language design and analysis',
      计算机图形学: 'Computer graphics',
      Web开发: 'Web development',
      数据科学: 'Data science',
      人工智能: 'Artificial intelligence',
      机器学习: 'Machine learning',
      机器学习系统: 'Machine learning systems',
      机器学习进阶: 'Advanced machine learning',
      深度学习: 'Deep learning',
      深度生成模型: 'Deep generative models'
    },
    skip: ['images']
  },
  {
    id: 'missing-semester',
    repo: 'missing-semester/missing-semester',
    branch: 'master',
    title: 'The Missing Semester of Your CS Education',
    by: 'Anish Athalye, Jon Gjengset and Jose Javier Gonzalez Ortiz (MIT)',
    area: 'cs',
    licence: 'CC-BY-NC-SA-4.0',
    tier: 'personal',
    licenceNote: 'CC BY-NC-SA 4.0: non-commercial, so read on this Mac for personal study',
    covers: 'The shell, shell tools and scripting, editors, data wrangling, the command-line environment, git, debugging and profiling, security',
    kind: 'course',
    level: 'beginner',
    topics: ['shell', 'bash', 'command line', 'vim', 'git', 'version control', 'debugging', 'profiling', 'data wrangling', 'regex', 'regular expressions', 'tmux', 'dotfiles'],
    root: '_2020',
    skip: ['_2020/index.md', '_2020/qa.md']
  },
  {
    id: 'coding-interview-university',
    repo: 'jwasham/coding-interview-university',
    branch: 'main',
    title: 'Coding Interview University',
    by: 'John Washam',
    area: 'algo',
    licence: 'CC-BY-SA-4.0',
    tier: 'open',
    covers: 'A multi-month plan for the computer science behind software engineering interviews, topic by topic',
    kind: 'guide',
    level: 'beginner',
    topics: ['coding interview', 'data structures', 'algorithms', 'big o', 'interview preparation', 'software engineering interview'],
    split: 'README.md'
  },
  {
    id: 'tech-interview-handbook',
    repo: 'yangshun/tech-interview-handbook',
    branch: 'main',
    title: 'Tech Interview Handbook',
    by: 'Yangshun Tay',
    area: 'algo',
    licence: 'MIT',
    tier: 'open',
    covers: 'Algorithm cheatsheets for every data structure, the coding interview process, behavioural rounds and negotiation',
    kind: 'guide',
    level: 'intermediate',
    topics: ['coding interview', 'algorithms', 'data structures', 'behavioral interview', 'behavioural interview', 'leetcode', 'interview preparation'],
    root: 'apps/website/contents',
    skip: ['/_/', '/snippets/']
  },
  {
    id: 'thealgorithms-python',
    repo: 'TheAlgorithms/Python',
    branch: 'master',
    title: 'The Algorithms: Python',
    by: 'TheAlgorithms',
    area: 'algo',
    licence: 'MIT',
    tier: 'open',
    covers: 'Hundreds of algorithms implemented in Python for learning: sorting, searching, graphs, dynamic programming, maths and more',
    kind: 'projects',
    level: 'beginner',
    topics: ['algorithms', 'sorting', 'searching', 'graph algorithms', 'dynamic programming', 'data structures in python'],
    skip: ['/^\\.', 'scripts', 'DIRECTORY.md', 'CONTRIBUTING.md']
  },
  {
    id: 'js-algorithms',
    repo: 'trekhleb/javascript-algorithms',
    branch: 'master',
    title: 'JavaScript Algorithms and Data Structures',
    by: 'Oleksii Trekhleb',
    area: 'algo',
    licence: 'MIT',
    tier: 'open',
    covers: 'Data structures and algorithms in JavaScript, each with an explanation and links to further reading',
    kind: 'notes',
    level: 'beginner',
    topics: ['algorithms', 'data structures', 'linked list', 'hash table', 'heap', 'trie', 'graph', 'sorting', 'javascript algorithms'],
    root: 'src',
    skip: ['/README\\.(?!md)/', '/__test__/']
  },

  // ---------- Systems and databases ----------
  {
    id: 'db-tutorial',
    repo: 'cstack/db_tutorial',
    branch: 'master',
    title: 'Let’s Build a Simple Database',
    by: 'Connor Stack',
    area: 'systems',
    licence: 'MIT',
    tier: 'open',
    covers: 'Write a SQLite clone in C from scratch: a REPL, a B-tree, a pager, cursors and splitting nodes',
    kind: 'course',
    level: 'intermediate',
    topics: ['database internals', 'b-tree', 'btree', 'sqlite', 'build a database', 'storage engine', 'pager'],
    root: '_parts'
  },
  {
    id: 'bustub',
    repo: 'cmu-db/bustub',
    branch: 'master',
    title: 'BusTub (CMU 15-445 projects)',
    by: 'CMU Database Group',
    area: 'systems',
    licence: 'MIT',
    tier: 'open',
    covers: 'The relational database CMU 15-445/645 students build: buffer pool, B+ tree index, query execution, concurrency control',
    kind: 'projects',
    level: 'advanced',
    topics: ['database internals', 'buffer pool', 'b+ tree', 'query execution', 'concurrency control', 'database systems', 'cmu 15-445'],
    skip: ['third_party', 'test', 'tools', 'build_support', '.github']
  },
  {
    id: 'os-tutorial',
    repo: 'cfenollosa/os-tutorial',
    branch: 'master',
    title: 'How to create an OS from scratch',
    by: 'Carlos Fenollosa',
    area: 'systems',
    licence: 'BSD-3-Clause',
    tier: 'open',
    covers: 'From a boot sector to a kernel in C: real mode, the GDT, 32-bit protected mode, video, interrupts and a shell',
    kind: 'course',
    level: 'intermediate',
    topics: ['operating systems', 'os development', 'boot sector', 'kernel', 'assembly', 'x86', 'interrupts'],
    modules: '^\\d\\d-'
  },
  {
    id: 'ostep-projects',
    repo: 'remzi-arpacidusseau/ostep-projects',
    branch: 'master',
    title: 'OSTEP projects',
    by: 'Remzi and Andrea Arpaci-Dusseau',
    area: 'systems',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'The projects for Operating Systems: Three Easy Pieces: Unix utilities, a shell, xv6 scheduling and virtual memory, concurrency, file systems',
    kind: 'projects',
    level: 'intermediate',
    topics: ['operating systems', 'ostep', 'xv6', 'shell', 'concurrency', 'file systems', 'scheduling'],
    order: ['initial-utilities', 'initial-reverse', 'initial-kv', 'initial-memcached', 'initial-xv6', 'initial-xv6-tracer', 'processes-shell', 'scheduling-xv6-lottery', 'vm-xv6-intro', 'concurrency-xv6-threads', 'concurrency-pzip', 'concurrency-sort', 'concurrency-mapreduce', 'concurrency-webserver', 'filesystems-checker', 'filesystems-distributed', 'filesystems-distributed-ufs'],
    skip: ['tester']
  },
  {
    id: 'distsys-class',
    repo: 'aphyr/distsys-class',
    branch: 'master',
    title: 'An Introduction to Distributed Systems',
    by: 'Kyle Kingsbury (Jepsen)',
    area: 'systems',
    licence: 'Copyright Kyle Kingsbury & Jepsen, LLC',
    tier: 'personal',
    licenceNote: 'All rights reserved: read on this Mac for personal study only',
    covers: 'The outline of a 16 to 32 hour class: nodes and networks, time and order, availability, consistency models, consensus, and patterns in production',
    kind: 'notes',
    level: 'intermediate',
    topics: ['distributed systems', 'consistency models', 'consensus', 'cap theorem', 'linearizability', 'raft', 'paxos', 'replication'],
    split: 'README.markdown'
  },

  // ---------- Software engineering ----------
  {
    id: 'rust-book',
    repo: 'rust-lang/book',
    branch: 'main',
    title: 'The Rust Programming Language',
    by: 'Steve Klabnik, Carol Nichols and Chris Krycho',
    area: 'swe',
    licence: 'MIT OR Apache-2.0',
    tier: 'open',
    covers: 'The official book: ownership, structs and enums, error handling, generics and traits, lifetimes, closures, concurrency',
    kind: 'book',
    level: 'beginner',
    topics: ['rust', 'rust programming', 'ownership', 'borrow checker', 'lifetimes', 'traits'],
    root: 'src'
  },
  {
    id: 'comprehensive-rust',
    repo: 'google/comprehensive-rust',
    branch: 'main',
    title: 'Comprehensive Rust',
    by: 'Google Android team',
    area: 'swe',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'Google’s multi-day Rust course: fundamentals, the standard library, memory management, concurrency, with exercises',
    kind: 'course',
    level: 'beginner',
    topics: ['rust', 'rust programming', 'concurrency in rust', 'async rust'],
    root: 'src',
    skip: ['/(android|chromium|bare-metal|exercises\\/bare-metal|idiomatic|unsafe-deep-dive)/']
  },
  {
    id: 'realpython-materials',
    repo: 'realpython/materials',
    branch: 'master',
    title: 'Real Python materials',
    by: 'Real Python',
    area: 'swe',
    licence: 'MIT',
    tier: 'open',
    covers: 'The example code behind Real Python’s tutorials, one folder a tutorial, each with a short guide',
    kind: 'projects',
    level: 'beginner',
    topics: ['python', 'python tutorials', 'python projects', 'flask', 'django', 'asyncio'],
    skip: ['/^\\.']
  },
  {
    id: 'web-dev-for-beginners',
    repo: 'microsoft/Web-Dev-For-Beginners',
    branch: 'main',
    title: 'Web Development for Beginners',
    by: 'Microsoft',
    area: 'swe',
    licence: 'MIT',
    tier: 'open',
    covers: 'Twenty-four lessons of HTML, CSS and JavaScript, building a terrarium, a typing game, a browser extension, a space game and a bank app',
    kind: 'course',
    level: 'beginner',
    topics: ['web development', 'html', 'css', 'javascript', 'dom', 'browser extension'],
    modules: '^\\d+-',
    skip: ['/translations?/', '/solution/']
  },
  {
    id: 'eng-practices',
    repo: 'google/eng-practices',
    branch: 'master',
    title: 'Google Engineering Practices',
    by: 'Google',
    area: 'swe',
    licence: 'CC-BY-3.0',
    tier: 'open',
    covers: 'How Google does code review, for reviewers and for authors of changes',
    kind: 'guide',
    level: 'intermediate',
    topics: ['code review', 'engineering practices', 'pull requests'],
    root: 'review'
  },

  // ---------- System design ----------
  {
    id: 'system-design-primer',
    repo: 'donnemartin/system-design-primer',
    branch: 'master',
    title: 'The System Design Primer',
    by: 'Donne Martin',
    area: 'design',
    licence: 'CC-BY-4.0',
    tier: 'open',
    covers: 'Scalability, the CAP theorem, consistency and availability patterns, DNS, CDNs, load balancers, caches, databases and async work',
    kind: 'guide',
    level: 'intermediate',
    topics: ['system design', 'scalability', 'cap theorem', 'load balancer', 'caching', 'database sharding', 'cdn', 'system design interview', 'replication'],
    split: 'README.md'
  },

  // ---------- Maths ----------
  {
    id: 'ossu-math',
    repo: 'ossu/math',
    branch: 'master',
    title: 'OSSU Mathematics',
    by: 'Open Source Society University',
    area: 'maths',
    licence: 'MIT',
    tier: 'open',
    covers: 'An undergraduate maths curriculum from free courses: calculus, linear algebra, proofs, analysis, algebra and more',
    kind: 'guide',
    level: 'beginner',
    topics: ['mathematics', 'maths curriculum', 'calculus', 'linear algebra', 'real analysis', 'abstract algebra', 'proofs'],
    split: 'README.md'
  },
  {
    id: 'numerical-linear-algebra',
    repo: 'fastai/numerical-linear-algebra',
    branch: 'master',
    title: 'Computational Linear Algebra',
    by: 'Rachel Thomas (fast.ai)',
    area: 'maths',
    licence: 'None stated',
    tier: 'personal',
    licenceNote: PERSONAL,
    covers: 'Linear algebra as it is computed: SVD, NMF, randomised methods, PCA, compressed sensing, QR, PageRank, as notebooks',
    kind: 'course',
    level: 'intermediate',
    topics: ['linear algebra', 'numerical linear algebra', 'svd', 'singular value decomposition', 'pca', 'qr decomposition', 'eigenvalues', 'pagerank'],
    root: 'nbs'
  },
  {
    id: 'intro-numerical-methods',
    repo: 'mandli/intro-numerical-methods',
    branch: 'master',
    title: 'Introduction to Numerical Methods',
    by: 'Kyle Mandli',
    area: 'maths',
    licence: 'CC-BY-4.0',
    tier: 'open',
    covers: 'Error, root finding, interpolation, numerical differentiation and integration, linear systems and ODEs, as notebooks',
    kind: 'course',
    level: 'intermediate',
    topics: ['numerical methods', 'root finding', 'interpolation', 'numerical integration', 'numerical differentiation', 'ode', 'floating point'],
    skip: ['extras', 'README.md']
  },
  {
    id: 'math-as-code',
    repo: 'Experience-Monks/math-as-code',
    branch: 'master',
    title: 'Math as Code',
    by: 'Matt DesLauriers (Jam3)',
    area: 'maths',
    licence: 'MIT',
    tier: 'open',
    covers: 'Mathematical notation read as code: sigma, capital pi, vectors, matrices, functions, sets and logic',
    kind: 'notes',
    level: 'beginner',
    topics: ['mathematical notation', 'math notation', 'summation', 'vectors', 'matrices'],
    split: 'README.md'
  },
  {
    id: 'numpy-100',
    repo: 'rougier/numpy-100',
    branch: 'master',
    title: '100 NumPy exercises',
    by: 'Nicolas Rougier',
    area: 'maths',
    licence: 'MIT',
    tier: 'open',
    covers: 'A hundred NumPy exercises, from creating arrays to vectorised tricks, with hints',
    kind: 'projects',
    level: 'beginner',
    topics: ['numpy', 'arrays', 'vectorization', 'vectorisation'],
    order: ['100_Numpy_exercises.md', '100_Numpy_exercises_with_hints.md'],
    skip: ['README.md', '/_with_solutions/', '/_with_hints_with_solutions/', '/\\.ipynb$/']
  },

  // ---------- Physics and simulation ----------
  {
    id: 'cfd-python',
    repo: 'barbagroup/CFDPython',
    branch: 'master',
    title: '12 steps to Navier–Stokes',
    by: 'Lorena A. Barba and Gilbert F. Forsyth',
    area: 'physics',
    licence: 'CC-BY-3.0 (text), BSD-3-Clause (code)',
    tier: 'open',
    covers: 'Computational fluid dynamics in Python, one step at a time: convection, diffusion, Burgers’ equation, Laplace and Poisson, cavity and channel flow',
    kind: 'course',
    level: 'intermediate',
    topics: ['computational fluid dynamics', 'cfd', 'navier-stokes', 'navier stokes', 'finite differences', 'partial differential equations', 'pde', 'fluid dynamics'],
    root: 'lessons'
  },
  {
    id: 'kalman-filters',
    repo: 'rlabbe/Kalman-and-Bayesian-Filters-in-Python',
    branch: 'master',
    title: 'Kalman and Bayesian Filters in Python',
    by: 'Roger R. Labbe',
    area: 'physics',
    licence: 'CC-BY-4.0',
    tier: 'open',
    covers: 'Filtering from intuition to practice: the g-h filter, discrete Bayes, Gaussians, the Kalman filter, the EKF and UKF, particle filters',
    kind: 'book',
    level: 'intermediate',
    topics: ['kalman filter', 'bayesian filter', 'particle filter', 'state estimation', 'sensor fusion', 'extended kalman filter'],
    skip: ['Supporting_Notebooks', 'animations', 'experiments', 'pdf', 'README.md', 'Appendix']
  },
  {
    id: 'qiskit-textbook',
    repo: 'qiskit-community/qiskit-textbook',
    branch: 'main',
    title: 'Learn Quantum Computation using Qiskit',
    by: 'IBM and the Qiskit community',
    area: 'physics',
    licence: 'Apache-2.0',
    tier: 'open',
    covers: 'Qubits, gates, entanglement, quantum algorithms (Deutsch–Jozsa, Grover, Shor), error correction and hardware, as notebooks',
    kind: 'book',
    level: 'intermediate',
    topics: ['quantum computing', 'qiskit', 'qubits', 'quantum algorithms', 'grover', 'shor', 'entanglement'],
    root: 'content',
    skip: ['/i18n/']
  },
  {
    id: 'scientific-python-lectures',
    repo: 'jrjohansson/scientific-python-lectures',
    branch: 'master',
    title: 'Lectures on scientific computing with Python',
    by: 'J.R. Johansson',
    area: 'physics',
    licence: 'CC-BY-3.0',
    tier: 'open',
    licenceNote: 'CC BY 3.0, as its README states (there is no LICENSE file)',
    covers: 'NumPy, SciPy, matplotlib, SymPy, Cython and parallel computing for scientists, as notebooks',
    kind: 'course',
    level: 'beginner',
    topics: ['scientific computing', 'scipy', 'sympy', 'numpy', 'matplotlib', 'scientific python'],
    skip: ['README.md']
  }
]

/** Every course Tide ships with: GitHub's, then those from the open web (courseCatalogueWeb) */
export const CATALOGUE: CatalogueCourse[] = [...GITHUB_COURSES, ...WEB_COURSES]

// ---------- Courses beyond the built-in list ----------

/**
 * Courses Tide found for you (main/courseFresh: suggestions, and suggestions you imported), added
 * at run time beside the built-in list. Main registers them as it loads them; the window registers
 * the ones it is shown.
 */
const extra = new Map<string, CatalogueCourse>()
export function registerCourses(list: CatalogueCourse[]): void {
  for (const c of list) if (!CATALOGUE.some((b) => b.id === c.id)) extra.set(c.id, c)
}
export const unregisterCourse = (id: string) => void extra.delete(id)
/** The built-in catalogue and the courses found for you */
export const allCourses = (): CatalogueCourse[] => [...CATALOGUE, ...extra.values()]

export const catalogueCourse = (id: string) => CATALOGUE.find((c) => c.id === id) ?? extra.get(id)
export const areaLabel = (a: CourseArea) => AREAS.find((x) => x.id === a)?.label ?? a
export const sourceOf = (c: Pick<CatalogueCourse, 'source'>): SourceKind => c.source ?? 'github'
/** Read with git from GitHub (its own repository): a github course or a Jupyter Book kept on GitHub */
export const fromRepo = (c: Pick<CatalogueCourse, 'source' | 'repo'>) => !!c.repo && (sourceOf(c) === 'github' || sourceOf(c) === 'jupyterbook')
/** Where the course lives: its repository on GitHub, else its page on the web */
export const homeUrl = (c: Pick<CatalogueCourse, 'source' | 'repo' | 'url' | 'playlist'>) =>
  c.url ?? (c.playlist ? `https://www.youtube.com/playlist?list=${c.playlist}` : c.repo ? `https://github.com/${c.repo}` : '')
export const repoUrl = (c: Pick<CatalogueCourse, 'repo' | 'source' | 'url' | 'playlist'>) => homeUrl(c)
/** The host a course is read from, as shown on its card */
export function sourceSite(c: Pick<CatalogueCourse, 'source' | 'repo' | 'url' | 'playlist'>): string {
  const s = SOURCES[sourceOf(c)]
  if (s.site) return s.site
  try {
    return new URL(homeUrl(c)).hostname.replace(/^www\./, '')
  } catch {
    return s.label
  }
}
/** What it is mostly made of */
export function mediaOf(c: Pick<CatalogueCourse, 'source' | 'media'>): 'video' | 'text' | 'mixed' {
  if (c.media) return c.media
  const s = sourceOf(c)
  return s === 'youtube' ? 'video' : s === 'ocw' || s === 'yale' ? 'mixed' : 'text'
}
