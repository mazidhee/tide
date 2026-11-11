import { describe, expect, it } from 'vitest'
import { EXPLAINERS, UNCHECKED_EXPLAINERS, explainerForUrl, explainerToolResult, findExplainers, topicWords } from '../src/shared/explainers'

const ids = (topic: string, from = EXPLAINERS) => findExplainers(topic, 3, from).map((e) => e.id)
const EVERY = [...EXPLAINERS, ...UNCHECKED_EXPLAINERS]

describe('the list of explainers', () => {
  it('is well formed: unique ids and pages, https, lower-case topics, one plain sentence each', () => {
    expect(EXPLAINERS.length).toBeGreaterThanOrEqual(30)
    expect(EXPLAINERS.length).toBeLessThanOrEqual(45)
    expect(new Set(EVERY.map((e) => e.id)).size).toBe(EVERY.length)
    expect(new Set(EVERY.map((e) => e.url)).size).toBe(EVERY.length)
    for (const e of EVERY) {
      expect(e.url, e.id).toMatch(/^https:\/\/[a-z0-9.-]+\//)
      expect(e.title.trim(), e.id).not.toBe('')
      expect(e.by.trim(), e.id).not.toBe('')
      expect(e.topics.length, e.id).toBeGreaterThan(2)
      for (const t of e.topics) expect(t, e.id).toBe(t.toLowerCase().trim())
      expect(e.what, e.id).toMatch(/^[A-Z].{30,170}\.$/)
      // One sentence, and none of the words Tide doesn't use
      expect(e.what.slice(0, -1), e.id).not.toMatch(/[.!?] [A-Z]/)
      expect(e.what, e.id).not.toMatch(/amazing|awesome|beautiful|stunning|powerful|ultimate|best|!/i)
    }
  })

  it('offers nothing that could not be checked', () => {
    const offered = new Set(EXPLAINERS.map((e) => e.url))
    for (const e of UNCHECKED_EXPLAINERS) {
      expect(offered.has(e.url)).toBe(false)
      expect(explainerForUrl(e.url)).toBeNull()
    }
  })
})

describe('findExplainers', () => {
  it('reads a topic as its words: singular, no stop words, C++ and A* kept', () => {
    expect(topicWords('How do B-Trees work in databases?')).toEqual(['b', 'tree', 'work', 'database'])
    expect(topicWords('pointers in C')).toEqual(['pointer', 'c'])
    expect(topicWords('C++ templates vs. the A* algorithm')).toEqual(['cpp', 'template', 'astar', 'algorithm'])
    expect(topicWords('queries, indexes, classes, HTTPS')).toEqual(['query', 'index', 'class', 'https'])
  })

  it('finds the obviously right ones', () => {
    expect(ids('transformer architecture')[0]).toBe('llm-visualization')
    expect(ids('how does attention work')).toEqual(expect.arrayContaining(['llm-visualization', 'distill-attention']))
    expect(ids('b-trees')).toEqual(['usfca-btree', 'planetscale-btrees', 'usfca-bplustree'])
    expect(ids('B+ tree')[0]).toMatch(/planetscale-btrees|usfca-bplustree/)
    expect(ids('pointers in C')[0]).toBe('c-tutor')
    expect(ids('C++ templates')[0]).toBe('cpp-insights')
    expect(ids('What does this loop compile to in assembly?')[0]).toBe('compiler-explorer')
    expect(ids('Dijkstra’s algorithm')).toEqual(expect.arrayContaining(['visualgo-sssp', 'redblob-astar']))
    expect(ids('quicksort')).toEqual(['visualgo-sorting'])
    expect(ids('SQL joins')).toEqual(expect.arrayContaining(['sqlbolt', 'sql-murder-mystery']))
    expect(ids('the TLS handshake')[0]).toBe('illustrated-tls13')
    expect(ids('how SHA-256 works')[0]).toBe('sha256-algorithm')
    expect(ids('proof of work')).toEqual(['blockchain-demo'])
    expect(ids('EVM opcodes and gas')[0]).toBe('evm-codes')
    expect(ids('eigenvectors')).toEqual(expect.arrayContaining(['3b1b-linear-algebra', 'immersive-linear-algebra']))
    expect(ids('conditional probability')).toEqual(['seeing-theory'])
    expect(ids('bloom filters')).toEqual(['samwho-bloom-filters'])
    expect(ids('load balancers')).toEqual(['samwho-load-balancing'])
    expect(ids('Kafka consumer groups')[0]).toBe('kafka-visualisation')
    expect(ids('memory allocation with malloc')[0]).toBe('samwho-memory-allocation')
    expect(ids('IEEE 754 floating point')).toEqual(['float-exposed'])
    expect(ids('git rebase')).toEqual(['learn-git-branching'])
  })

  it('ranks the pages that could not be checked correctly too, for when they can be', () => {
    expect(ids('raft consensus', EVERY).slice(0, 2).sort()).toEqual(['raft-secret-lives', 'raft-site'])
    expect(ids('transformer architecture', EVERY)).toEqual(['llm-visualization', 'transformer-explainer', 'illustrated-transformer'])
    expect(ids('convolutional neural networks', EVERY)[0]).toBe('cnn-explainer')
    expect(ids('markov chains', EVERY)).toEqual(expect.arrayContaining(['explained-visually', 'ev-markov-chains']))
  })

  it('returns nothing for a topic none of them is about', () => {
    for (const topic of ['the French Revolution', 'photosynthesis', 'vitamin C', 'how to negotiate a salary', 'conservation of momentum', 'React hooks', 'data mining', 'the Linux kernel', 'attack vectors', 'index funds', 'AWS Lambda pricing', '', '   ', 'the of and'])
      expect(ids(topic), topic).toEqual([])
  })

  it('keeps to the limit, best first', () => {
    expect(findExplainers('sorting algorithms and hash tables and b-trees', 2)).toHaveLength(2)
    expect(findExplainers('linear algebra', 1).map((e) => e.id)).toEqual(['3b1b-linear-algebra'])
    expect(findExplainers('data structures', 10).length).toBeLessThanOrEqual(10)
  })
})

describe('what find_explainer tells the tutor', () => {
  it('gives up to three Markdown links, each with its sentence and maker, and says how to pass one on', () => {
    const out = explainerToolResult('b-trees')
    const lines = out.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('- [B-Trees](https://www.cs.usfca.edu/~galles/visualization/BTree.html): Insert, delete and find keys in a B-tree of the degree you choose and watch its nodes split and merge. By David Galles, University of San Francisco.')
    for (const line of lines) {
      const url = line.match(/\]\((https:[^)]+)\)/)![1]
      expect(explainerForUrl(url)).not.toBeNull()
    }
    expect(out).toMatch(/After you have taught the idea/)
    expect(out).toMatch(/line of its own/)
  })

  it('says plainly when there is none, and never offers an unchecked page', () => {
    expect(explainerToolResult('the French Revolution')).toMatch(/^No interactive explainer/)
    expect(explainerToolResult('raft consensus')).toMatch(/^No interactive explainer/)
    expect(explainerToolResult('raft consensus')).not.toContain('http')
  })
})

describe('recognising an explainer by its address', () => {
  it('knows its own pages however the address is written', () => {
    expect(explainerForUrl('https://bbycroft.net/llm')?.id).toBe('llm-visualization')
    expect(explainerForUrl('https://bbycroft.net/llm/')?.id).toBe('llm-visualization')
    expect(explainerForUrl('http://www.bbycroft.net/llm#intro')?.id).toBe('llm-visualization')
    expect(explainerForUrl('https://godbolt.org')?.id).toBe('compiler-explorer')
    expect(explainerForUrl('https://immersivemath.com/ila/')?.id).toBe('immersive-linear-algebra')
    expect(explainerForUrl('https://evm.codes/?fork=cancun')?.id).toBe('evm-codes')
    for (const e of EXPLAINERS) expect(explainerForUrl(e.url)?.id).toBe(e.id)
  })

  it('does not claim other pages, even on the same site', () => {
    expect(explainerForUrl('https://pythontutor.com/c.html')?.id).toBe('c-tutor')
    expect(explainerForUrl('https://pythontutor.com/')?.id).toBe('python-tutor')
    for (const url of ['https://bbycroft.net/', 'https://distill.pub/', 'https://distill.pub/2017/feature-visualization/', 'https://godbolt.org/z/abc123', 'https://evil.example/?u=https://godbolt.org/', 'https://godbolt.org.evil.example/', 'javascript:alert(1)', 'not a url', ''])
      expect(explainerForUrl(url), url).toBeNull()
  })
})
