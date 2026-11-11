/**
 * Interactive explanations on the web that are good enough to hand a learner alongside a lesson:
 * pages where you can change something and watch what happens. The tutor still teaches the idea;
 * these are somewhere to go and explore it afterwards. Tide only links to them, and they open in
 * the browser.
 *
 * Every address in EXPLAINERS answered 200 to `curl -sIL` when it was added. Check again before
 * adding one, and keep the list short: one excellent page per idea beats five fair ones.
 */

export interface Explainer {
  id: string
  title: string
  url: string
  /** Lower-case keywords and phrases a topic or question may contain. Singular; plurals are matched. */
  topics: string[]
  /** One plain sentence on what you can do there */
  what: string
  /** Who made it */
  by: string
}

export const EXPLAINERS: Explainer[] = [
  // ---------- Machine learning ----------
  {
    id: 'llm-visualization',
    title: 'LLM Visualization',
    url: 'https://bbycroft.net/llm',
    topics: ['transformer', 'transformer architecture', 'llm', 'large language model', 'gpt', 'nanogpt', 'attention', 'self-attention', 'language model', 'token embedding', 'layer norm'],
    what: 'Walk through a small GPT in 3D, one step of the computation at a time, from token embeddings to the output probabilities.',
    by: 'Brendan Bycroft'
  },
  {
    id: 'distill-attention',
    title: 'Attention and Augmented Recurrent Neural Networks',
    url: 'https://distill.pub/2016/augmented-rnns/',
    topics: ['attention', 'attention mechanism', 'rnn', 'recurrent neural network', 'neural turing machine', 'seq2seq', 'sequence to sequence'],
    what: 'Hover over diagrams of attention in recurrent networks to see what the network reads and writes at each step.',
    by: 'Chris Olah and Shan Carter, Distill'
  },
  {
    id: 'distill-momentum',
    title: 'Why Momentum Really Works',
    url: 'https://distill.pub/2017/momentum/',
    topics: ['gradient descent', 'momentum method', 'momentum optimiser', 'momentum optimizer', 'nesterov momentum', 'sgd momentum', 'heavy ball', 'optimiser', 'optimizer', 'sgd', 'step size', 'learning rate', 'condition number', 'convergence rate'],
    what: 'Drag the step size and the momentum and watch gradient descent converge, oscillate or diverge.',
    by: 'Gabriel Goh, Distill'
  },
  {
    id: 'distill-tsne',
    title: 'How to Use t-SNE Effectively',
    url: 'https://distill.pub/2016/misread-tsne/',
    topics: ['t-sne', 'tsne', 'dimensionality reduction', 'perplexity', 'embedding visualisation', 'embedding visualization', 'visualising high-dimensional data'],
    what: 'Run t-SNE on small data sets and change the perplexity and step count to see how much the picture depends on them.',
    by: 'Martin Wattenberg, Fernanda Viégas and Ian Johnson, Distill'
  },
  {
    id: 'distill-gnn',
    title: 'A Gentle Introduction to Graph Neural Networks',
    url: 'https://distill.pub/2021/gnn-intro/',
    topics: ['graph neural network', 'gnn', 'message passing', 'graph convolution', 'graph learning'],
    what: 'Build a graph neural network piece by piece and train one in the page with different design choices.',
    by: 'Benjamin Sanchez-Lengeling, Emily Reif, Adam Pearce and Alexander Wiltschko, Distill'
  },
  {
    id: '3b1b-neural-networks',
    title: 'Neural networks',
    url: 'https://www.3blue1brown.com/topics/neural-networks',
    topics: ['neural network', 'backpropagation', 'backprop', 'deep learning', 'gradient descent', 'multilayer perceptron', 'mlp', 'transformer', 'attention', 'gpt'],
    what: 'Watch animated lessons on what a neural network is, how gradient descent and backpropagation train it, and how transformers work.',
    by: 'Grant Sanderson, 3Blue1Brown'
  },

  // ---------- Linear algebra and probability ----------
  {
    id: '3b1b-linear-algebra',
    title: 'Essence of linear algebra',
    url: 'https://www.3blue1brown.com/topics/linear-algebra',
    topics: ['linear algebra', 'vector space', 'matrix', 'matrices', 'matrix multiplication', 'linear transformation', 'determinant', 'eigenvector', 'eigenvalue', 'dot product', 'cross product', 'change of basis', 'null space', 'column space'],
    what: 'Watch vectors, matrices, determinants and eigenvectors shown as movements of space.',
    by: 'Grant Sanderson, 3Blue1Brown'
  },
  {
    id: 'immersive-linear-algebra',
    title: 'Immersive Linear Algebra',
    url: 'https://immersivemath.com/ila/index.html',
    topics: ['linear algebra', 'dot product', 'cross product', 'matrix', 'matrices', 'gaussian elimination', 'determinant', 'matrix rank', 'linear mapping', 'eigenvalue', 'eigenvector'],
    what: 'Read a linear algebra textbook in which every figure can be dragged and rotated.',
    by: 'Jacob Ström, Kalle Åström and Tomas Akenine-Möller'
  },
  {
    id: 'seeing-theory',
    title: 'Seeing Theory',
    url: 'https://seeing-theory.brown.edu/',
    topics: ['probability', 'statistics', 'random variable', 'expectation', 'expected value', 'variance', 'conditional probability', 'probability distribution', 'central limit theorem', 'confidence interval', 'bayes', 'bayesian inference', 'linear regression', 'frequentist'],
    what: 'Flip coins, draw from distributions and watch estimates, confidence intervals and posteriors form as the samples come in.',
    by: 'Daniel Kunin and others, Brown University'
  },

  // ---------- Algorithms and data structures ----------
  {
    id: 'visualgo',
    title: 'VisuAlgo',
    url: 'https://visualgo.net/en',
    topics: ['data structure', 'algorithm visualisation', 'algorithm visualization', 'linked list', 'binary heap', 'min heap', 'max heap', 'priority queue', 'graph traversal', 'bfs', 'dfs', 'union find', 'segment tree', 'minimum spanning tree', 'recursion tree', 'trie', 'suffix array'],
    what: 'Run classic data structures and algorithms step by step on your own input, with the pseudocode highlighted as it goes.',
    by: 'Steven Halim, National University of Singapore'
  },
  {
    id: 'visualgo-sorting',
    title: 'VisuAlgo: Sorting',
    url: 'https://visualgo.net/en/sorting',
    topics: ['sorting', 'sort', 'sorting algorithm', 'quicksort', 'quick sort', 'merge sort', 'mergesort', 'bubble sort', 'insertion sort', 'selection sort', 'counting sort', 'radix sort'],
    what: 'Watch bubble, insertion, merge, quick, counting and radix sort work through an array of your choosing, one comparison at a time.',
    by: 'Steven Halim, National University of Singapore'
  },
  {
    id: 'visualgo-bst',
    title: 'VisuAlgo: Binary search tree and AVL tree',
    url: 'https://visualgo.net/en/bst',
    topics: ['binary search tree', 'bst', 'avl tree', 'avl', 'tree rotation', 'balanced tree', 'self-balancing tree', 'binary tree'],
    what: 'Insert, remove and search keys in a binary search tree, then switch to AVL and watch the rotations keep it balanced.',
    by: 'Steven Halim, National University of Singapore'
  },
  {
    id: 'visualgo-hashtable',
    title: 'VisuAlgo: Hash table',
    url: 'https://visualgo.net/en/hashtable',
    topics: ['hash table', 'hash map', 'hashmap', 'open addressing', 'linear probing', 'quadratic probing', 'separate chaining', 'collision resolution'],
    what: 'Insert keys into a hash table and compare linear probing, quadratic probing, double hashing and separate chaining as collisions happen.',
    by: 'Steven Halim, National University of Singapore'
  },
  {
    id: 'visualgo-sssp',
    title: 'VisuAlgo: Single-source shortest paths',
    url: 'https://visualgo.net/en/sssp',
    topics: ['shortest path', 'dijkstra', 'bellman-ford', 'bellman ford', 'single-source shortest path', 'sssp', 'weighted graph'],
    what: 'Draw a weighted graph and step through Bellman-Ford and Dijkstra as they relax each edge.',
    by: 'Steven Halim, National University of Singapore'
  },
  {
    id: 'usfca-visualizations',
    title: 'Data Structure Visualizations',
    url: 'https://www.cs.usfca.edu/~galles/visualization/Algorithms.html',
    topics: ['data structure', 'algorithm visualisation', 'algorithm visualization', 'red-black tree', 'red black tree', 'splay tree', 'trie', 'heap sort', 'binomial heap', 'fibonacci heap', 'skip list', 'dynamic programming', 'topological sort', 'kmp', 'huffman coding', 'disjoint set'],
    what: 'Pick from several dozen data structures and algorithms and drive each one by hand: insert, delete, find, and watch every pointer move.',
    by: 'David Galles, University of San Francisco'
  },
  {
    id: 'redblob-astar',
    title: 'Introduction to the A* Algorithm',
    url: 'https://www.redblobgames.com/pathfinding/a-star/introduction.html',
    topics: ['a*', 'a-star', 'a star', 'pathfinding', 'path finding', 'heuristic search', 'breadth-first search', 'dijkstra', 'graph search'],
    what: 'Watch breadth-first search, Dijkstra’s algorithm and A* spread across a grid, and move the walls and the goal to see the paths change.',
    by: 'Amit Patel, Red Blob Games'
  },
  {
    id: 'samwho-big-o',
    title: 'Big O',
    url: 'https://samwho.dev/big-o/',
    topics: ['big o', 'big-o', 'time complexity', 'asymptotic complexity', 'complexity analysis', 'algorithmic complexity'],
    what: 'Run small algorithms on growing inputs and watch how the work they do grows.',
    by: 'Sam Rose'
  },
  {
    id: 'samwho-hashing',
    title: 'Hashing',
    url: 'https://samwho.dev/hashing/',
    topics: ['hashing', 'hash function', 'hash collision', 'avalanche effect', 'hash map', 'murmur'],
    what: 'Feed values to good and bad hash functions and see how evenly they spread, where they collide and what that does to a hash map.',
    by: 'Sam Rose'
  },
  {
    id: 'samwho-bloom-filters',
    title: 'Bloom Filters',
    url: 'https://samwho.dev/bloom-filters/',
    topics: ['bloom filter', 'probabilistic data structure', 'false positive rate'],
    what: 'Add items to a Bloom filter bit by bit and see where its false positives come from.',
    by: 'Sam Rose'
  },

  // ---------- Databases ----------
  {
    id: 'usfca-btree',
    title: 'B-Trees',
    url: 'https://www.cs.usfca.edu/~galles/visualization/BTree.html',
    topics: ['b-tree', 'btree', 'b tree', 'node split', '2-3 tree', '2-3-4 tree'],
    what: 'Insert, delete and find keys in a B-tree of the degree you choose and watch its nodes split and merge.',
    by: 'David Galles, University of San Francisco'
  },
  {
    id: 'planetscale-btrees',
    title: 'B-trees and database indexes',
    url: 'https://planetscale.com/blog/btrees-and-database-indexes',
    topics: ['b-tree', 'btree', 'b tree', 'b+ tree', 'database index', 'index scan', 'primary key', 'secondary index', 'clustered index', 'innodb'],
    what: 'Insert keys into B-trees and B+ trees in the page and see how they shape a database’s indexes and the cost of a primary key.',
    by: 'Ben Dicken, PlanetScale'
  },
  {
    id: 'usfca-bplustree',
    title: 'B+ Trees',
    url: 'https://www.cs.usfca.edu/~galles/visualization/BPlusTree.html',
    topics: ['b+ tree', 'b+tree', 'bplus tree', 'b-tree', 'b tree', 'leaf node', 'range scan'],
    what: 'Insert, delete and find keys in a B+ tree and watch the leaves split, merge and stay linked.',
    by: 'David Galles, University of San Francisco'
  },
  {
    id: 'planetscale-io',
    title: 'IO devices and latency',
    url: 'https://planetscale.com/blog/io-devices-and-latency',
    topics: ['disk io', 'io latency', 'storage latency', 'ssd', 'hard disk', 'hdd', 'iops', 'storage device', 'random read', 'sequential read'],
    what: 'Send reads and writes to tape, spinning disks, SSDs and network storage and see where each one’s latency comes from.',
    by: 'Ben Dicken, PlanetScale'
  },
  {
    id: 'sqlbolt',
    title: 'SQLBolt',
    url: 'https://sqlbolt.com/',
    topics: ['sql', 'sql join', 'inner join', 'outer join', 'left join', 'group by', 'subquery', 'learn sql', 'sql query'],
    what: 'Work through short SQL lessons, each with exercises you answer by writing queries against a table in the page.',
    by: 'SQLBolt'
  },
  {
    id: 'sql-murder-mystery',
    title: 'SQL Murder Mystery',
    url: 'https://mystery.knightlab.com/',
    topics: ['sql', 'sql practice', 'practise sql', 'sql join', 'sql exercise', 'sql query'],
    what: 'Solve a crime by writing SQL queries against a small database in the page.',
    by: 'Joon Park and Cathy He, Knight Lab, Northwestern University'
  },
  {
    id: 'dalibo-explain',
    title: 'explain.dalibo.com',
    url: 'https://explain.dalibo.com/',
    topics: ['explain analyze', 'explain analyse', 'query plan', 'execution plan', 'postgres explain', 'postgresql explain', 'query planner', 'query optimiser', 'query optimizer', 'slow query'],
    what: 'Paste a PostgreSQL EXPLAIN plan and read it as a tree that shows where the time and the rows go.',
    by: 'Dalibo'
  },

  // ---------- Distributed systems ----------
  {
    id: 'samwho-load-balancing',
    title: 'Load Balancing',
    url: 'https://samwho.dev/load-balancing/',
    topics: ['load balancing', 'load balancer', 'round robin', 'least connections', 'tail latency', 'request routing'],
    what: 'Watch requests flow to servers under round robin, least connections and other strategies, and see how each copes with uneven load.',
    by: 'Sam Rose'
  },
  {
    id: 'kafka-visualisation',
    title: 'Kafka Visualisation',
    url: 'https://softwaremill.com/kafka-visualisation/',
    topics: ['kafka', 'apache kafka', 'kafka partition', 'consumer group', 'kafka replication', 'message broker', 'event streaming', 'log replication'],
    what: 'Set the brokers, partitions and replication of a small Kafka cluster and watch messages flow as brokers fail.',
    by: 'SoftwareMill'
  },

  // ---------- Networking ----------
  {
    id: 'illustrated-tls13',
    title: 'The Illustrated TLS 1.3 Connection',
    url: 'https://tls13.xargs.org/',
    topics: ['tls', 'tls 1.3', 'tls handshake', 'ssl', 'https', 'key exchange', 'tls certificate'],
    what: 'Click through every byte of a TLS 1.3 connection, from the first hello to the encrypted data, with each field explained.',
    by: 'Michael Driscoll'
  },
  {
    id: 'illustrated-quic',
    title: 'The Illustrated QUIC Connection',
    url: 'https://quic.xargs.org/',
    topics: ['quic', 'http/3', 'http3', 'quic handshake', 'udp transport'],
    what: 'Click through every byte of a QUIC connection, packet by packet, with each field explained.',
    by: 'Michael Driscoll'
  },
  {
    id: 'cidr-xyz',
    title: 'CIDR.xyz',
    url: 'https://cidr.xyz/',
    topics: ['cidr', 'subnet', 'subnetting', 'subnet mask', 'ip address', 'ip range', 'netmask', 'ipv4'],
    what: 'Change the bits of an IP address and its prefix length and see the range, the mask and the number of addresses.',
    by: 'Yuvi Panda'
  },

  // ---------- Cryptography and blockchain ----------
  {
    id: 'sha256-algorithm',
    title: 'SHA-256 Algorithm',
    url: 'https://sha256algorithm.com/',
    topics: ['sha-256', 'sha256', 'sha-2', 'sha2', 'cryptographic hash', 'hash function', 'message schedule', 'compression function'],
    what: 'Step through SHA-256 on your own input and watch the message schedule and each compression round change the bits.',
    by: 'Domingo Martin'
  },
  {
    id: 'blockchain-demo',
    title: 'Blockchain Demo',
    url: 'https://andersbrownworth.com/blockchain/',
    topics: ['blockchain', 'proof of work', 'block mining', 'block hash', 'hash chain', 'nonce', 'distributed ledger'],
    what: 'Change the data in a block and watch the hashes break down the chain, then mine the blocks again to repair it.',
    by: 'Anders Brownworth'
  },
  {
    id: 'evm-codes',
    title: 'evm.codes',
    url: 'https://www.evm.codes/',
    topics: ['evm', 'ethereum virtual machine', 'opcode', 'evm opcode', 'gas cost', 'solidity bytecode', 'ethereum bytecode', 'precompile', 'smart contract'],
    what: 'Look up every EVM opcode with its gas cost, and run bytecode step by step in a playground that shows the stack, memory and storage.',
    by: 'smlXL'
  },
  {
    id: 'learn-me-a-bitcoin',
    title: 'Learn Me A Bitcoin',
    url: 'https://learnmeabitcoin.com/',
    topics: ['bitcoin', 'bitcoin transaction', 'utxo', 'bitcoin script', 'bitcoin block', 'bitcoin mining', 'bitcoin key', 'bitcoin address', 'merkle root', 'segwit'],
    what: 'Read how Bitcoin works at the level of bytes, with tools in the page for keys, transactions, scripts and blocks.',
    by: 'Greg Walker'
  },

  // ---------- Systems, C and C++ ----------
  {
    id: 'c-tutor',
    title: 'C Tutor',
    url: 'https://pythontutor.com/c.html',
    topics: ['c', 'c programming', 'pointer', 'c pointer', 'pointer arithmetic', 'malloc', 'stack and heap', 'stack frame', 'call stack', 'struct', 'array decay', 'memory layout'],
    what: 'Run C one line at a time and see the stack, the heap and where every pointer points.',
    by: 'Philip Guo'
  },
  {
    id: 'cpp-tutor',
    title: 'C++ Tutor',
    url: 'https://pythontutor.com/cpp.html',
    topics: ['c++', 'pointer', 'c++ pointer', 'c++ reference', 'stack and heap', 'stack frame', 'call stack', 'object lifetime', 'new and delete', 'memory layout'],
    what: 'Run C++ one line at a time and see the stack, the heap, and every pointer and reference.',
    by: 'Philip Guo'
  },
  {
    id: 'python-tutor',
    title: 'Python Tutor',
    url: 'https://pythontutor.com/',
    topics: ['python execution', 'python variable', 'code execution', 'execution trace', 'recursion', 'call stack', 'stack frame', 'variable scope', 'aliasing', 'mutable', 'mutability', 'javascript closure', 'closure'],
    what: 'Run Python, JavaScript, C, C++ or Java one line at a time and see the frames, variables and objects at each step.',
    by: 'Philip Guo'
  },
  {
    id: 'compiler-explorer',
    title: 'Compiler Explorer',
    url: 'https://godbolt.org/',
    topics: ['compiler', 'assembly', 'assembler', 'compiler optimisation', 'compiler optimization', 'inlining', 'godbolt', 'machine code', 'x86', 'arm64', 'c++', 'c', 'undefined behaviour', 'undefined behavior', 'vectorisation', 'vectorization'],
    what: 'Type C, C++, Rust or many other languages and see the assembly each line compiles to, across compilers and flags.',
    by: 'Matt Godbolt'
  },
  {
    id: 'cpp-insights',
    title: 'C++ Insights',
    url: 'https://cppinsights.io/',
    topics: ['c++', 'c++ template', 'template instantiation', 'c++ lambda', 'range-based for', 'auto type deduction', 'type deduction', 'implicit conversion', 'structured binding', 'coroutine'],
    what: 'See what the compiler makes of your C++: lambdas, range-based for loops, auto and templates rewritten as the code they stand for.',
    by: 'Andreas Fertig'
  },
  {
    id: 'samwho-memory-allocation',
    title: 'Memory Allocation',
    url: 'https://samwho.dev/memory-allocation/',
    topics: ['memory allocation', 'memory allocator', 'malloc', 'free list', 'fragmentation', 'heap allocation', 'allocator'],
    what: 'Call malloc and free on a small heap drawn in the page and watch free lists and fragmentation form.',
    by: 'Sam Rose'
  },
  {
    id: 'float-exposed',
    title: 'Float Exposed',
    url: 'https://float.exposed/',
    topics: ['floating point', 'floating-point', 'ieee 754', 'float', 'double precision', 'significand', 'mantissa', 'rounding error', 'nan'],
    what: 'Flip the bits of a floating-point number and see its sign, exponent, significand and value change.',
    by: 'Bartosz Ciechanowski'
  },
  {
    id: 'nandgame',
    title: 'NandGame',
    url: 'https://nandgame.com/',
    topics: ['logic gate', 'nand', 'nand gate', 'computer architecture', 'cpu design', 'adder', 'alu', 'digital logic', 'how a cpu works', 'how computers work'],
    what: 'Build a working computer from NAND gates, one level at a time: adders, memory, an instruction decoder, a processor.',
    by: 'Olav Junker Kjær'
  },

  // ---------- Tools of the trade ----------
  {
    id: 'regex101',
    title: 'regex101',
    url: 'https://regex101.com/',
    topics: ['regex', 'regular expression', 'regexp', 'capture group', 'lookahead', 'lookbehind', 'backreference'],
    what: 'Write a regular expression against your own text and read what each part of it does, with matches and groups marked as you type.',
    by: 'Firas Dib'
  },
  {
    id: 'learn-git-branching',
    title: 'Learn Git Branching',
    url: 'https://learngitbranching.js.org/',
    topics: ['git', 'git branch', 'git branching', 'git rebase', 'rebase', 'git merge', 'cherry-pick', 'cherry pick', 'detached head', 'commit graph'],
    what: 'Practise git commands in a sandbox that draws the commit graph as you branch, merge and rebase.',
    by: 'Peter Cottle'
  }
]

/**
 * Good pages that could not be checked when the list was made: each refused the connection from
 * the Mac it was checked on. The owner has since confirmed (11 November 2026) that their own
 * network was blocking them, not that the pages are gone, so they are offered. They are kept
 * apart so they can be checked with `curl -sIL -m 15 <url>` once that network lets them through.
 */
export const UNCHECKED_EXPLAINERS: Explainer[] = [
  {
    id: 'transformer-explainer',
    title: 'Transformer Explainer',
    url: 'https://poloclub.github.io/transformer-explainer/',
    topics: ['transformer', 'transformer architecture', 'attention', 'self-attention', 'gpt', 'gpt-2', 'llm', 'next token prediction', 'query key value'],
    what: 'Type a sentence and watch GPT-2 run on it in the page, block by block, to predict the next token.',
    by: 'Polo Club of Data Science, Georgia Tech'
  },
  {
    id: 'illustrated-transformer',
    title: 'The Illustrated Transformer',
    url: 'https://jalammar.github.io/illustrated-transformer/',
    topics: ['transformer', 'transformer architecture', 'attention', 'self-attention', 'multi-head attention', 'positional encoding', 'encoder decoder'],
    what: 'Read the transformer drawn out one tensor at a time, from embeddings through self-attention to the decoder.',
    by: 'Jay Alammar'
  },
  {
    id: 'tensorflow-playground',
    title: 'TensorFlow Playground',
    url: 'https://playground.tensorflow.org/',
    topics: ['neural network', 'hidden layer', 'activation function', 'regularisation', 'regularization', 'overfitting', 'decision boundary', 'learning rate', 'multilayer perceptron', 'mlp'],
    what: 'Train a small neural network in the page and change its layers, activation, learning rate and data to see what it can learn.',
    by: 'Daniel Smilkov and Shan Carter'
  },
  {
    id: 'cnn-explainer',
    title: 'CNN Explainer',
    url: 'https://poloclub.github.io/cnn-explainer/',
    topics: ['cnn', 'convolutional neural network', 'convolution', 'convnet', 'pooling', 'max pooling', 'convolution kernel', 'image classification'],
    what: 'Follow an image through a small convolutional network and open any layer to see the convolution, ReLU or pooling worked out number by number.',
    by: 'Polo Club of Data Science, Georgia Tech'
  },
  {
    id: 'gan-lab',
    title: 'GAN Lab',
    url: 'https://poloclub.github.io/ganlab/',
    topics: ['gan', 'generative adversarial network', 'discriminator', 'adversarial training'],
    what: 'Train a generative adversarial network on a 2D distribution in the page and watch the generator and the discriminator push against each other.',
    by: 'Polo Club of Data Science, Georgia Tech, with Google'
  },
  {
    id: 'cs231n',
    title: 'CS231n course notes',
    url: 'https://cs231n.github.io/',
    topics: ['convolutional neural network', 'cnn', 'backpropagation', 'image classification', 'linear classifier', 'softmax classifier', 'svm loss', 'computer vision'],
    what: 'Read the Stanford course notes on neural networks for vision, with demos of linear classifiers and convolution that run in the page.',
    by: 'Stanford CS231n (Fei-Fei Li, Andrej Karpathy and others)'
  },
  {
    id: 'raft-secret-lives',
    title: 'Raft: Understandable Distributed Consensus',
    url: 'https://thesecretlivesofdata.com/raft/',
    topics: ['raft', 'raft consensus', 'consensus', 'distributed consensus', 'leader election', 'log replication', 'replicated log'],
    what: 'Step through an animated walk-through of Raft: leader election, log replication and what happens when the network splits.',
    by: 'Ben Johnson'
  },
  {
    id: 'raft-site',
    title: 'The Raft Consensus Algorithm',
    url: 'https://raft.github.io/',
    topics: ['raft', 'raft consensus', 'consensus', 'distributed consensus', 'leader election', 'log replication', 'election timeout', 'paxos'],
    what: 'Run a five-server Raft cluster in the page: stop servers, drop messages and send requests to see elections and replication happen.',
    by: 'Diego Ongaro and the Raft authors'
  },
  {
    id: 'explained-visually',
    title: 'Explained Visually',
    url: 'https://setosa.io/ev/',
    topics: ['eigenvector', 'eigenvalue', 'markov chain', 'principal component analysis', 'pca', 'conditional probability', 'ordinary least squares', 'least squares', 'exponentiation', 'sine and cosine', 'image kernel'],
    what: 'Drag the points in short visual explanations of eigenvectors, Markov chains, PCA, conditional probability and more.',
    by: 'Victor Powell and Lewis Lehe, Setosa'
  },
  {
    id: 'ev-eigenvectors',
    title: 'Eigenvectors and Eigenvalues, Explained Visually',
    url: 'https://setosa.io/ev/eigenvectors-and-eigenvalues/',
    topics: ['eigenvector', 'eigenvalue', 'eigendecomposition', 'steady state'],
    what: 'Drag two vectors and see which directions a matrix only stretches, and what repeated multiplication does.',
    by: 'Victor Powell and Lewis Lehe, Setosa'
  },
  {
    id: 'ev-markov-chains',
    title: 'Markov Chains, Explained Visually',
    url: 'https://setosa.io/ev/markov-chains/',
    topics: ['markov chain', 'transition matrix', 'markov process', 'stochastic matrix'],
    what: 'Edit a transition matrix and watch the chain it describes hop between states.',
    by: 'Victor Powell and Lewis Lehe, Setosa'
  },
  {
    id: 'ev-pca',
    title: 'Principal Component Analysis, Explained Visually',
    url: 'https://setosa.io/ev/principal-component-analysis/',
    topics: ['pca', 'principal component analysis', 'principal component', 'dimensionality reduction'],
    what: 'Drag data points and watch the principal components turn to follow the spread.',
    by: 'Victor Powell and Lewis Lehe, Setosa'
  },
  {
    id: 'ev-conditional-probability',
    title: 'Conditional Probability, Explained Visually',
    url: 'https://setosa.io/ev/conditional-probability/',
    topics: ['conditional probability', 'independent event', 'bayes'],
    what: 'Resize two events and watch falling balls show how the chance of one changes given the other.',
    by: 'Victor Powell and Lewis Lehe, Setosa'
  },
  {
    id: 'mlu-explain',
    title: 'MLU-Explain',
    url: 'https://mlu-explain.github.io/',
    topics: ['bias variance', 'bias-variance tradeoff', 'decision tree', 'random forest', 'logistic regression', 'linear regression', 'roc curve', 'auc', 'precision and recall', 'cross-validation', 'train test split', 'double descent'],
    what: 'Scroll through visual essays on core machine learning ideas, each with a model you can adjust as you read.',
    by: 'Amazon Machine Learning University'
  },
  {
    id: 'mcmc-demo',
    title: 'The Markov-chain Monte Carlo Interactive Gallery',
    url: 'https://chi-feng.github.io/mcmc-demo/',
    topics: ['mcmc', 'markov chain monte carlo', 'metropolis-hastings', 'metropolis hastings', 'hamiltonian monte carlo', 'hmc', 'nuts sampler', 'gibbs sampling'],
    what: 'Watch Metropolis-Hastings, Hamiltonian Monte Carlo, NUTS and other samplers explore a distribution, and change the target and step size.',
    by: 'Chi Feng'
  },
  {
    id: 'cdecl',
    title: 'cdecl',
    url: 'https://cdecl.org/',
    topics: ['c declaration', 'function pointer', 'pointer to function', 'pointer to array', 'c type syntax', 'const pointer'],
    what: 'Type a C declaration and read it in English, or the other way round.',
    by: 'the cdecl authors'
  }
]

// ---------- Finding the ones for a topic ----------

const STOP = new Set('a an the of in on for to and or is are was be do does did how what why when where which who me i you it its this that with about can from at as my we they there s vs versus between'.split(' '))

/** One word, singular: "trees" → "tree", "indexes" → "index", "queries" → "query" */
function singular(w: string): string {
  if (w === 'https') return w
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && /(x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}

/** The words that matter, in order: lower-case, singular, without stop words. "C++" and "A*" keep their meaning. */
export function topicWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\bc\+\+/g, ' cpp ')
    .replace(/\bc#/g, ' csharp ')
    .replace(/\ba\*/g, ' astar ')
    .replace(/\ba[- ]star\b/g, ' astar ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(singular)
}

const phrases = new WeakMap<Explainer, string[][]>()
function phrasesOf(e: Explainer): string[][] {
  let p = phrases.get(e)
  if (!p) {
    const seen = new Set<string>()
    p = [...e.topics, e.title].map(topicWords).filter((w) => w.length && !seen.has(w.join(' ')) && !!seen.add(w.join(' ')))
    phrases.set(e, p)
  }
  return p
}

/** 2 when the phrase is in the words as written, 1 when all its words are there in another order, 0 otherwise */
function found(words: string[], phrase: string[]): 0 | 1 | 2 {
  outer: for (let i = 0; i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (words[i + j] !== phrase[j]) continue outer
    return 2
  }
  return phrase.length > 1 && phrase.every((w) => words.includes(w)) ? 1 : 0
}

/**
 * How well an explainer fits. Each of its phrases found in the topic counts by its length, so
 * "b+ tree" beats "tree"; a little less when the words are there but apart ("pointers in C" for
 * "c pointer"). A lone letter ("C") is only a hint, never enough by itself.
 */
function score(e: Explainer, words: string[]): number {
  let total = 0
  for (const phrase of phrasesOf(e)) {
    const hit = found(words, phrase)
    if (hit) total += phrase.length === 1 && phrase[0].length === 1 ? 0.5 : hit === 2 ? phrase.length : phrase.length - 0.5
  }
  return total
}

/**
 * The explainers that fit a topic or a question, best first. Nothing is returned for a topic
 * none of them is about: better no link than a loosely related one.
 */
/** Everything the tutor may offer */
export const OFFERED = (): Explainer[] => [...EXPLAINERS, ...UNCHECKED_EXPLAINERS]

export function findExplainers(topic: string, limit = 3, from: Explainer[] = OFFERED()): Explainer[] {
  const words = topicWords(topic)
  if (!words.length) return []
  return from
    .map((e, i) => ({ e, i, s: score(e, words) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e)
}

/** What the find_explainer tool answers: Markdown links the tutor can pass on as they are */
export function explainerToolResult(topic: string, from: Explainer[] = OFFERED()): string {
  const found = findExplainers(topic, 3, from)
  if (!found.length) return 'No interactive explainer is kept for that. Teach it yourself; don’t invent a link.'
  return [
    ...found.map((e) => `- [${e.title}](${e.url}): ${e.what} By ${e.by}.`),
    '',
    'After you have taught the idea, offer the one that fits best as something to explore: its link on a line of its own, copied exactly. Tide shows it as a card with this description, so don’t repeat the description.'
  ].join('\n')
}

// ---------- Recognising one in tutor text ----------

/** An address without the parts that don't change what page it is */
const pageKey = (url: string): string | null => {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/(index\.html)?$/, '')}`
  } catch {
    return null
  }
}

let byPage: Map<string, Explainer> | null = null

/** The explainer a link points at, if it is one of ours. Only exact pages count, not the rest of their sites. */
export function explainerForUrl(url: string): Explainer | null {
  byPage ??= new Map(OFFERED().map((e) => [pageKey(e.url)!, e]))
  const key = pageKey(url)
  return (key && byPage.get(key)) || null
}
