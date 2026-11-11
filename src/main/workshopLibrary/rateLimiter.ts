import type { WorkshopProject } from '@shared/workshop'

// Authoring notes: see kvWal.ts. JavaScript here: the tests require('./ratelimit').

const STARTER = String.raw`'use strict'
// Rate limiters. Built in four stages; see STAGE-1.md.
// Every limiter takes now: a function returning the time in milliseconds (Date.now by default).

class TokenBucket {
  // Stage 1: { capacity, refillPerSecond, now }
  constructor(options = {}) {
    this.options = options
  }

  // Stage 1: the tokens in the bucket now (may be fractional)
  available() {
    throw new Error('available is not written yet')
  }

  // Stage 1: take n tokens if there are enough; true or false
  tryTake(n = 1) {
    throw new Error('tryTake is not written yet')
  }

  // Stage 2: milliseconds until n tokens are available
  waitTime(n = 1) {
    throw new Error('waitTime is not written yet')
  }
}

class SlidingWindowLog {
  // Stage 3: { limit, windowMs, now }
  constructor(options = {}) {
    this.options = options
  }

  allow() {
    throw new Error('allow is not written yet')
  }

  remaining() {
    throw new Error('remaining is not written yet')
  }
}

class KeyedLimiter {
  // Stage 4: { capacity, refillPerSecond, now }
  constructor(options = {}) {
    this.options = options
  }

  allow(key, n = 1) {
    throw new Error('allow is not written yet')
  }

  retryAfter(key, n = 1) {
    throw new Error('retryAfter is not written yet')
  }

  size() {
    throw new Error('size is not written yet')
  }

  sweep() {
    throw new Error('sweep is not written yet')
  }
}

module.exports = { TokenBucket, SlidingWindowLog, KeyedLimiter }
`

const SOLUTION = String.raw`'use strict'
// Rate limiters: a token bucket, an exact sliding window, and a limiter per key that forgets idle keys.

const positive = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0

class TokenBucket {
  constructor({ capacity, refillPerSecond, now = Date.now } = {}) {
    if (!positive(capacity)) throw new RangeError('capacity must be a positive number')
    if (!(typeof refillPerSecond === 'number' && Number.isFinite(refillPerSecond) && refillPerSecond >= 0)) throw new RangeError('refillPerSecond must be a number of at least 0')
    this.capacity = capacity
    this.rate = refillPerSecond
    this.now = now
    this.tokens = capacity
    this.last = now()
  }

  _refill() {
    const t = this.now()
    // Time that ran backwards adds nothing, and is not counted twice when it runs forwards again
    if (t > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.rate)
      this.last = t
    }
  }

  _check(n) {
    if (!positive(n) || n > this.capacity) throw new RangeError('n must be above 0 and at most the capacity, ' + this.capacity)
  }

  available() {
    this._refill()
    return this.tokens
  }

  tryTake(n = 1) {
    this._check(n)
    this._refill()
    if (this.tokens < n) return false
    this.tokens -= n
    return true
  }

  waitTime(n = 1) {
    this._check(n)
    this._refill()
    if (this.tokens >= n) return 0
    if (this.rate === 0) return Infinity
    return Math.ceil(((n - this.tokens) / this.rate) * 1000)
  }
}

class SlidingWindowLog {
  constructor({ limit, windowMs, now = Date.now } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a whole number of at least 1')
    if (!positive(windowMs)) throw new RangeError('windowMs must be a positive number')
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
    this.log = []
  }

  _prune(t) {
    let i = 0
    while (i < this.log.length && this.log[i] <= t - this.windowMs) i++
    if (i) this.log.splice(0, i)
  }

  allow() {
    const t = this.now()
    this._prune(t)
    if (this.log.length >= this.limit) return false
    this.log.push(t)
    return true
  }

  remaining() {
    this._prune(this.now())
    return this.limit - this.log.length
  }
}

class KeyedLimiter {
  constructor({ capacity, refillPerSecond, now = Date.now } = {}) {
    // Checked once here, so a bad option fails at once rather than on the first request
    new TokenBucket({ capacity, refillPerSecond, now })
    this.options = { capacity, refillPerSecond, now }
    this.buckets = new Map()
  }

  _bucket(key) {
    let b = this.buckets.get(key)
    if (!b) {
      b = new TokenBucket(this.options)
      this.buckets.set(key, b)
    }
    return b
  }

  allow(key, n = 1) {
    return this._bucket(key).tryTake(n)
  }

  retryAfter(key, n = 1) {
    const b = this.buckets.get(key)
    return b ? b.waitTime(n) : 0
  }

  size() {
    return this.buckets.size
  }

  // A full bucket behaves exactly like a new one, so keeping it costs memory and buys nothing
  sweep() {
    let removed = 0
    for (const [key, b] of this.buckets) {
      if (b.available() >= b.capacity) {
        this.buckets.delete(key)
        removed++
      }
    }
    return removed
  }
}

module.exports = { TokenBucket, SlidingWindowLog, KeyedLimiter }
`

const HELPERS = String.raw`const lib = require('./ratelimit')
const { TokenBucket } = lib
const fakeClock = (start = 0) => { let t = start; const now = () => t; now.advance = (ms) => { t += ms }; now.set = (ms) => { t = ms }; return now }
const throwsRange = (f) => { try { f() } catch (e) { return e instanceof RangeError ? null : 'it threw ' + e.name + ': ' + e.message } return 'it did not throw' }
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9
`

export const rateLimiter: WorkshopProject = {
  id: 'rate-limiter',
  title: 'Rate limiters: token bucket, sliding window, per client',
  outcome: 'The rate limiting an API gateway does, in JavaScript and tested against a clock you control: a token bucket that allows bursts and refills continuously, the wait a client is told to observe, an exact sliding window without the burst at a window boundary, and a per-client limiter that forgets idle clients without changing a single answer.',
  area: 'systems',
  prerequisites: ['JavaScript classes', 'Rates and units'],
  languages: ['javascript'],
  stages: [
    {
      id: 'bucket',
      title: 'A token bucket',
      goal: 'Allow bursts up to a capacity and a steady rate after that, refilling continuously from an injected clock.',
      brief: `In \`ratelimit.js\`, finish \`TokenBucket\`. Its clock is \`now\`, a function returning milliseconds; the tests pass a fake one and move it by hand, so read the time only through \`now()\`.

- \`new TokenBucket({ capacity, refillPerSecond, now })\`: the bucket starts **full**. \`capacity\` must be a finite number above 0 and \`refillPerSecond\` a finite number of at least 0; otherwise throw a \`RangeError\`.
- Tokens flow in continuously at \`refillPerSecond\` (after 250 ms at 4 per second, one more token), never above \`capacity\`.
- \`available()\`: the tokens in the bucket now, possibly fractional.
- \`tryTake(n = 1)\`: if at least \`n\` tokens are there, remove them and return \`true\`; otherwise remove nothing and return \`false\`. An \`n\` that is not above 0, or is more than \`capacity\` (it could never succeed), throws a \`RangeError\`.
- If the clock goes backwards, nothing is added, and when it goes forwards again only time after the latest reading counts.`,
      read: { concept: 'Token bucket rate limiting', source: 'RFC 2697, “A Single Rate Three Color Marker” (the token bucket); Stripe engineering blog, “Scaling your API with rate limiters”' },
      files: [{ path: 'ratelimit.js', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'a new bucket is full, and a burst up to the capacity is allowed',
          code: String.raw`const now = fakeClock()
const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now })
assert.ok(near(b.available(), 5), 'a new bucket of capacity 5 should hold 5 tokens, got ' + b.available())
for (let i = 1; i <= 5; i++) assert.strictEqual(b.tryTake(), true, 'take number ' + i + ' of a burst of 5 should be allowed')
assert.strictEqual(b.tryTake(), false, 'a sixth take with no time passed should be refused')`
        },
        {
          name: 'tokens flow back at the rate, a fraction at a time',
          code: String.raw`const now = fakeClock(1000)
const b = new TokenBucket({ capacity: 10, refillPerSecond: 4, now })
for (let i = 0; i < 10; i++) b.tryTake()
now.advance(250)
assert.ok(near(b.available(), 1), 'after 250 ms at 4 per second the bucket should hold 1 token, got ' + b.available())
now.advance(125)
assert.ok(near(b.available(), 1.5), 'after 375 ms in all it should hold 1.5 tokens, got ' + b.available())
assert.strictEqual(b.tryTake(2), false, 'taking 2 with 1.5 in the bucket should be refused')
assert.ok(near(b.available(), 1.5), 'a refused take must remove nothing; the bucket holds ' + b.available())`
        },
        {
          name: 'the bucket never fills past its capacity',
          code: String.raw`const now = fakeClock()
const b = new TokenBucket({ capacity: 3, refillPerSecond: 10, now })
b.tryTake(2)
now.advance(60000)
assert.ok(near(b.available(), 3), 'after a minute the bucket should be at its capacity, 3, not ' + b.available())
for (let i = 0; i < 3; i++) b.tryTake()
assert.strictEqual(b.tryTake(), false, 'a long idle time must not buy a burst bigger than the capacity')`
        },
        {
          name: 'bad options and impossible takes are refused',
          code: String.raw`const now = fakeClock()
for (const opts of [{ capacity: 0, refillPerSecond: 1 }, { capacity: -1, refillPerSecond: 1 }, { capacity: 5, refillPerSecond: -1 }, { capacity: Infinity, refillPerSecond: 1 }, { capacity: '5', refillPerSecond: 1 }]) {
  const why = throwsRange(() => new TokenBucket({ ...opts, now }))
  assert.strictEqual(why, null, 'new TokenBucket(' + JSON.stringify(opts) + ') should throw a RangeError; ' + why)
}
const b = new TokenBucket({ capacity: 5, refillPerSecond: 1, now })
for (const n of [0, -1, 6]) {
  const why = throwsRange(() => b.tryTake(n))
  assert.strictEqual(why, null, 'tryTake(' + n + ') on a bucket of capacity 5 should throw a RangeError; ' + why)
}`
        },
        {
          name: 'a clock that goes backwards adds nothing',
          code: String.raw`const now = fakeClock(10000)
const b = new TokenBucket({ capacity: 10, refillPerSecond: 1, now })
for (let i = 0; i < 10; i++) b.tryTake()
now.set(5000)
assert.ok(near(b.available(), 0), 'the clock went back 5 s: the bucket should still be empty, got ' + b.available())
now.set(11000)
assert.ok(near(b.available(), 1), 'from 10 000 back to 5000 and on to 11 000 ms is 1 s of real progress: 1 token, got ' + b.available())`
        }
      ],
      hints: [
        'Don’t run a timer to add tokens. Work out, whenever you are asked, how many tokens the time since you last looked has added.',
        'Keep the token count and the time you last updated it. Before answering anything, add (elapsed ms / 1000) × rate, cap at the capacity, and move the “last” time forward, but only if the clock has moved forward.',
        'Constructor: validate, store capacity, rate and now, set tokens = capacity and last = now(). refill(): t = now(); if t > last, tokens = min(capacity, tokens + (t − last) / 1000 × rate) and last = t. available: refill, return tokens. tryTake(n): validate n, refill, if tokens < n return false, else subtract and return true.'
      ],
      teaches: ['Token bucket rate limiting', 'Lazy computation'],
      recall: 'Why does a token bucket compute the refill when it is asked, instead of adding tokens on a timer?'
    },
    {
      id: 'wait',
      title: 'How long to wait',
      goal: 'Tell a refused client exactly how long until its request would be allowed.',
      brief: `A server that refuses a request should say when to come back (HTTP's \`Retry-After\`). Add to \`TokenBucket\` in \`ratelimit.js\`:

- \`waitTime(n = 1)\`: the number of **milliseconds** from now until \`n\` tokens will be in the bucket, rounded **up** to a whole millisecond; \`0\` if they are there now. With a refill rate of 0 and too few tokens, \`Infinity\`.
- The same \`RangeError\` as \`tryTake\` for an \`n\` that could never succeed.
- Asking does not take anything: waiting the time returned and then calling \`tryTake(n)\` succeeds.`,
      read: { concept: 'Backoff and Retry-After', source: 'RFC 9110, section 10.2.3 “Retry-After”; RFC 6585, section 4 “429 Too Many Requests”' },
      files: [],
      tests: [
        {
          name: 'no wait when the tokens are there',
          code: String.raw`const now = fakeClock()
const b = new TokenBucket({ capacity: 4, refillPerSecond: 2, now })
assert.strictEqual(b.waitTime(), 0, 'a full bucket should need no wait, got ' + b.waitTime())
assert.strictEqual(b.waitTime(4), 0, 'waitTime(4) on a full bucket of 4 should be 0, got ' + b.waitTime(4))`
        },
        {
          name: 'the wait is the missing tokens over the rate, in milliseconds',
          code: String.raw`const now = fakeClock()
const b = new TokenBucket({ capacity: 10, refillPerSecond: 2, now })
for (let i = 0; i < 10; i++) b.tryTake()
assert.strictEqual(b.waitTime(1), 500, 'an empty bucket refilling 2 per second needs 500 ms for 1 token, got ' + b.waitTime(1))
assert.strictEqual(b.waitTime(3), 1500, 'and 1500 ms for 3 tokens, got ' + b.waitTime(3))
now.advance(250)
assert.strictEqual(b.waitTime(1), 250, 'after 250 ms (half a token) it needs 250 ms more, got ' + b.waitTime(1))`
        },
        {
          name: 'the wait is rounded up, so waiting it is always enough',
          code: String.raw`const now = fakeClock()
const b = new TokenBucket({ capacity: 3, refillPerSecond: 3, now })
for (let i = 0; i < 3; i++) b.tryTake()
const w = b.waitTime(1)
assert.strictEqual(w, 334, 'one token at 3 per second takes 333.33… ms, which rounds up to 334, got ' + w)
now.advance(w)
assert.strictEqual(b.tryTake(1), true, 'after waiting the ' + w + ' ms returned, tryTake(1) should succeed')`
        },
        {
          name: 'asking does not take, and a bucket that never refills says Infinity',
          code: String.raw`const now = fakeClock()
const b = new TokenBucket({ capacity: 2, refillPerSecond: 0, now })
b.waitTime(1); b.waitTime(2)
assert.ok(near(b.available(), 2), 'waitTime must not take tokens; the bucket holds ' + b.available() + ' instead of 2')
b.tryTake(2)
assert.strictEqual(b.waitTime(1), Infinity, 'with a refill rate of 0 an empty bucket never refills: Infinity, got ' + b.waitTime(1))
const why = throwsRange(() => b.waitTime(3))
assert.strictEqual(why, null, 'waitTime(3) on a bucket of capacity 2 should throw a RangeError; ' + why)`
        }
      ],
      hints: [
        'It is the refill formula turned round: given the tokens missing and the rate, how much time?',
        'Bring the bucket up to date first, then the missing amount is n minus the tokens there. Divide by the rate per second and convert to milliseconds; round up so that a client who waits exactly that long is never refused.',
        'waitTime(n): validate n as tryTake does; refill; if tokens >= n return 0; if the rate is 0 return Infinity; return Math.ceil((n − tokens) / rate × 1000).'
      ],
      teaches: ['Backoff and Retry-After', 'Rounding direction'],
      recall: 'Why must the wait a server returns be rounded up rather than to the nearest millisecond?'
    },
    {
      id: 'window',
      title: 'A sliding window',
      goal: 'Allow at most limit requests in any window of time, with no double burst at a boundary.',
      brief: `A token bucket allows bursts. Sometimes the rule is stricter: *at most \`limit\` requests in any \`windowMs\` milliseconds*. Counting per fixed window (per minute on the clock) allows twice the limit across a boundary: \`limit\` at 0:59 and \`limit\` again at 1:00. In \`ratelimit.js\`, finish \`SlidingWindowLog\`:

- \`new SlidingWindowLog({ limit, windowMs, now })\`: \`limit\` a whole number of at least 1 and \`windowMs\` a positive number, else \`RangeError\`.
- \`allow()\`: \`true\`, and the request counted, if fewer than \`limit\` allowed requests happened in the window \`(now − windowMs, now]\`; otherwise \`false\`. A request allowed at time *t* stops counting at exactly *t + windowMs*.
- **Refused requests are not counted**: otherwise a client that keeps retrying would never get through.
- \`remaining()\`: how many more requests would be allowed right now.
- Keep only what the window needs: a log that grows without bound under steady traffic is a memory leak.`,
      read: { concept: 'Sliding window rate limiting', source: 'Cloudflare blog, “How we built rate limiting capable of scaling to millions of domains” (fixed versus sliding windows); Figma engineering, “An alternative approach to rate limiting”' },
      files: [],
      setup: 'const { SlidingWindowLog } = lib',
      tests: [
        {
          name: 'up to the limit in a window, then refused',
          code: String.raw`const now = fakeClock()
const w = new SlidingWindowLog({ limit: 3, windowMs: 1000, now })
for (let i = 1; i <= 3; i++) { assert.strictEqual(w.allow(), true, 'request ' + i + ' of 3 should be allowed'); now.advance(10) }
assert.strictEqual(w.allow(), false, 'a fourth request inside the same second should be refused')
assert.strictEqual(w.remaining(), 0, 'remaining() should be 0, got ' + w.remaining())`
        },
        {
          name: 'no double burst across a window boundary',
          code: String.raw`const now = fakeClock(999)
const w = new SlidingWindowLog({ limit: 5, windowMs: 1000, now })
for (let i = 0; i < 5; i++) w.allow()
now.set(1000)
assert.strictEqual(w.allow(), false, 'five requests at 999 ms and one more at 1000 ms is six in one second: it should be refused')
now.set(1998)
assert.strictEqual(w.allow(), false, 'at 1998 ms the requests from 999 ms are still in the window')
now.set(1999)
assert.strictEqual(w.allow(), true, 'at 1999 ms the requests from 999 ms have left the window (they count until exactly 999 + 1000)')
assert.strictEqual(w.remaining(), 4, 'all five from 999 ms left together and one was just used: remaining() should be 4, got ' + w.remaining())`
        },
        {
          name: 'refused requests are not counted',
          code: String.raw`const now = fakeClock()
const w = new SlidingWindowLog({ limit: 2, windowMs: 1000, now })
w.allow(); w.allow()
for (let i = 0; i < 50; i++) { now.advance(10); w.allow() }
now.set(1000)
assert.strictEqual(w.allow(), true, 'two requests at 0 ms; refused retries since must not count, so at 1000 ms a request should be allowed')`
        },
        {
          name: 'remaining follows the window as it slides',
          code: String.raw`const now = fakeClock()
const w = new SlidingWindowLog({ limit: 3, windowMs: 100, now })
w.allow(); now.advance(40); w.allow(); now.advance(40); w.allow()
assert.strictEqual(w.remaining(), 0, 'at 80 ms three requests are in the window: remaining() should be 0, got ' + w.remaining())
now.set(100)
assert.strictEqual(w.remaining(), 1, 'at 100 ms the request from 0 ms has left: remaining() should be 1, got ' + w.remaining())
now.set(180)
assert.strictEqual(w.remaining(), 3, 'at 180 ms all three have left: remaining() should be 3, got ' + w.remaining())`
        },
        {
          name: 'bad options are refused',
          code: String.raw`for (const opts of [{ limit: 0, windowMs: 1000 }, { limit: 2.5, windowMs: 1000 }, { limit: 3, windowMs: 0 }, { limit: 3, windowMs: -5 }]) {
  const why = throwsRange(() => new SlidingWindowLog(opts))
  assert.strictEqual(why, null, 'new SlidingWindowLog(' + JSON.stringify(opts) + ') should throw a RangeError; ' + why)
}`
        }
      ],
      hints: [
        'The exact rule needs the time of each allowed request still inside the window, and nothing else.',
        'Keep the times of allowed requests in order. Before any answer, drop from the front every time t with t <= now − windowMs. Then the length of what is left is the count in the window. Only push the time when you allow.',
        'Constructor: validate and keep an empty array. prune(t): remove leading entries <= t − windowMs. allow(): t = now(); prune(t); if length >= limit return false; push t; return true. remaining(): prune(now()); return limit − length. Because only allowed requests are kept, the array never holds more than limit entries.'
      ],
      teaches: ['Sliding window rate limiting', 'Off-by-one errors at boundaries'],
      recall: 'How can a limiter that counts per fixed minute let through twice its limit, and how does a sliding window prevent it?'
    },
    {
      id: 'keyed',
      title: 'One bucket per client',
      goal: 'Limit each client separately, say when each may retry, and forget idle clients without changing any answer.',
      brief: `A real limiter keeps a bucket per client (per API key, per IP address). In \`ratelimit.js\`, finish \`KeyedLimiter\`:

- \`new KeyedLimiter({ capacity, refillPerSecond, now })\`: the same options as \`TokenBucket\`, checked at once (a bad option throws a \`RangeError\` here, not on the first request).
- \`allow(key, n = 1)\`: \`tryTake(n)\` on that key's bucket, creating a full one the first time a key is seen. Keys are independent.
- \`retryAfter(key, n = 1)\`: that key's \`waitTime(n)\`; \`0\` for a key never seen.
- \`size()\`: how many keys have a bucket.
- \`sweep()\`: removes the bucket of every key whose bucket is **full again**, and returns how many it removed. A full bucket answers exactly like a new one, so forgetting it changes no answer: the tests check that every \`allow\` gives the same result with and without sweeping.`,
      read: { concept: 'Per-client state and memory bounds', source: 'Envoy proxy documentation, “Local rate limit” (token buckets per descriptor); the Redis documentation for EXPIRE (idle keys)' },
      files: [],
      setup: 'const { KeyedLimiter } = lib',
      tests: [
        {
          name: 'each client has its own bucket',
          code: String.raw`const now = fakeClock()
const k = new KeyedLimiter({ capacity: 2, refillPerSecond: 1, now })
assert.strictEqual(k.allow('alice'), true, 'alice’s first request should be allowed')
assert.strictEqual(k.allow('alice'), true, 'alice’s second request should be allowed')
assert.strictEqual(k.allow('alice'), false, 'alice’s third request with no time passed should be refused')
assert.strictEqual(k.allow('bob'), true, 'bob has his own bucket: his first request should be allowed even though alice is out')
assert.strictEqual(k.size(), 2, 'two clients have been seen, so size() should be 2, got ' + k.size())`
        },
        {
          name: 'a refused client is told when to retry',
          code: String.raw`const now = fakeClock()
const k = new KeyedLimiter({ capacity: 1, refillPerSecond: 4, now })
k.allow('alice'); k.allow('alice')
assert.strictEqual(k.retryAfter('alice'), 250, 'alice emptied a bucket refilling 4 per second: retry after 250 ms, got ' + k.retryAfter('alice'))
assert.strictEqual(k.retryAfter('nobody'), 0, 'a client never seen can go now: 0, got ' + k.retryAfter('nobody'))
assert.strictEqual(k.size(), 1, 'asking about a client must not create a bucket for it; size() is ' + k.size())`
        },
        {
          name: 'sweep forgets only the clients whose bucket is full again',
          code: String.raw`const now = fakeClock()
const k = new KeyedLimiter({ capacity: 4, refillPerSecond: 2, now })
k.allow('a', 1); k.allow('b', 4)
now.advance(500)
const removed = k.sweep()
assert.strictEqual(removed, 1, 'after 500 ms, a (down 1) is full again and b (down 4) is not: sweep should remove 1, got ' + removed)
assert.strictEqual(k.size(), 1, 'one client should be left after the sweep, got ' + k.size())
now.advance(1500)
assert.strictEqual(k.sweep(), 1, 'after 2 s in all b is full too, so a second sweep should remove 1')
assert.strictEqual(k.size(), 0, 'no client should be left, got ' + k.size())`
        },
        {
          name: 'sweeping never changes an answer',
          code: String.raw`const now1 = fakeClock(), now2 = fakeClock()
const swept = new KeyedLimiter({ capacity: 3, refillPerSecond: 1.5, now: now1 })
const kept = new KeyedLimiter({ capacity: 3, refillPerSecond: 1.5, now: now2 })
let seed = 7
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
for (let i = 0; i < 2000; i++) {
  const step = Math.floor(rand() * 400)
  now1.advance(step); now2.advance(step)
  const key = 'client-' + Math.floor(rand() * 5)
  const n = 1 + Math.floor(rand() * 3)
  const a = swept.allow(key, n), b = kept.allow(key, n)
  assert.strictEqual(a, b, 'request ' + i + ' (' + key + ', n = ' + n + '): with sweeping the answer was ' + a + ', without it ' + b)
  if (i % 7 === 0) swept.sweep()
}`
        },
        {
          name: 'bad options fail at once',
          code: String.raw`const why = throwsRange(() => new KeyedLimiter({ capacity: 0, refillPerSecond: 1, now: fakeClock() }))
assert.strictEqual(why, null, 'new KeyedLimiter with capacity 0 should throw a RangeError straight away; ' + why)`
        }
      ],
      hints: [
        'This is a Map from key to TokenBucket. The interesting part is the question sweep asks of each bucket.',
        'Create buckets lazily in allow, never in retryAfter or size. To check the options at once, build one throwaway bucket in the constructor. A bucket that has refilled to capacity is indistinguishable from a new one, which is why removing it is safe.',
        'Constructor: new TokenBucket(options) to validate, keep the options and an empty Map. allow(key, n): get the bucket or create and store one, then return its tryTake(n). retryAfter: the bucket’s waitTime(n), or 0 if there is none. size: the Map’s size. sweep: for each entry, if bucket.available() >= capacity, delete it and count it; return the count.'
      ],
      teaches: ['Per-client state and memory bounds', 'Token bucket rate limiting'],
      recall: 'Why is it safe for a per-client limiter to forget a client whose bucket is full, and what would go wrong if it forgot one whose bucket was not?'
    }
  ],
  solution: [{ path: 'ratelimit.js', content: SOLUTION }]
}
