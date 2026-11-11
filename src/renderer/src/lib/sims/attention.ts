/**
 * Scaled dot-product self-attention on a short sentence. The embeddings and the query, key and
 * value matrices are seeded random numbers (a toy model, not a trained one); the arithmetic is
 * the real mechanism: scores = Q·Kᵀ / √d_k, weights = softmax(scores / T), output = weights · V.
 */
import { gaussian, hashString, mulberry32 } from './rng'
import { softmax } from './softmax'

export const D_MODEL = 16

export interface AttentionModel {
  tokens: string[]
  n: number
  d: number
  heads: number
  dk: number
  /** Token embedding plus positional encoding, n × d */
  x: Float64Array
  /** Per head: n × dk */
  q: Float64Array[]
  k: Float64Array[]
  v: Float64Array[]
}

export interface AttentionResult {
  /** q·k before scaling, n × n (row = query token, column = key token) */
  raw: Float64Array
  /** raw / √d_k */
  scores: Float64Array
  /** softmax over each row of scores / T */
  weights: Float64Array
  /** weights · V, n × dk */
  out: Float64Array
}

function project(x: Float64Array, n: number, d: number, dk: number, rand: () => number): Float64Array {
  const w = new Float64Array(dk * d)
  const scale = 1 / Math.sqrt(d)
  for (let i = 0; i < w.length; i++) w[i] = gaussian(rand) * scale
  const out = new Float64Array(n * dk)
  for (let t = 0; t < n; t++)
    for (let r = 0; r < dk; r++) {
      let s = 0
      for (let c = 0; c < d; c++) s += w[r * d + c] * x[t * d + c]
      out[t * dk + r] = s
    }
  return out
}

export function buildAttention(tokens: string[], heads: number, seed: number): AttentionModel {
  const n = tokens.length
  const d = D_MODEL
  const dk = Math.floor(d / heads)
  const x = new Float64Array(n * d)
  for (let t = 0; t < n; t++) {
    // The same word always gets the same embedding, wherever it appears
    const rand = mulberry32(hashString(tokens[t].toLowerCase()) ^ 0x9e3779b9)
    for (let c = 0; c < d; c++) {
      const angle = t / Math.pow(10000, (2 * Math.floor(c / 2)) / d)
      x[t * d + c] = gaussian(rand) + (c % 2 === 0 ? Math.sin(angle) : Math.cos(angle))
    }
  }
  const q: Float64Array[] = []
  const k: Float64Array[] = []
  const v: Float64Array[] = []
  for (let h = 0; h < heads; h++) {
    const rand = mulberry32((seed * 7919 + h * 104729 + 17) >>> 0)
    q.push(project(x, n, d, dk, rand))
    k.push(project(x, n, d, dk, rand))
    v.push(project(x, n, d, dk, rand))
  }
  return { tokens, n, d, heads, dk, x, q, k, v }
}

export function attend(model: AttentionModel, head: number, temperature: number, causal: boolean): AttentionResult {
  const { n, dk } = model
  const q = model.q[head]
  const k = model.k[head]
  const v = model.v[head]
  const raw = new Float64Array(n * n)
  const scores = new Float64Array(n * n)
  const weights = new Float64Array(n * n)
  const out = new Float64Array(n * dk)
  const row = new Float64Array(n)
  const p = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let c = 0; c < dk; c++) s += q[i * dk + c] * k[j * dk + c]
      raw[i * n + j] = s
      scores[i * n + j] = s / Math.sqrt(dk)
      // A causal mask hides the tokens that come later
      row[j] = causal && j > i ? -Infinity : scores[i * n + j]
    }
    softmax(row, temperature, p)
    for (let j = 0; j < n; j++) {
      weights[i * n + j] = p[j]
      for (let c = 0; c < dk; c++) out[i * dk + c] += p[j] * v[j * dk + c]
    }
  }
  return { raw, scores, weights, out }
}
