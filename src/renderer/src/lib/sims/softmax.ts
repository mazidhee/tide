/** Softmax with temperature, computed stably (the largest logit is subtracted first). */
export function softmax(logits: ArrayLike<number>, temperature = 1, out: Float64Array = new Float64Array(logits.length)): Float64Array {
  const t = Math.max(temperature, 1e-6)
  let max = -Infinity
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i]
  let sum = 0
  for (let i = 0; i < logits.length; i++) {
    // A masked entry (-Infinity) gets exactly zero
    out[i] = logits[i] === -Infinity ? 0 : Math.exp((logits[i] - max) / t)
    sum += out[i]
  }
  for (let i = 0; i < logits.length; i++) out[i] /= sum
  return out
}

/** Shannon entropy in bits */
export function entropyBits(p: ArrayLike<number>): number {
  let h = 0
  for (let i = 0; i < p.length; i++) if (p[i] > 0) h -= p[i] * Math.log2(p[i])
  return h
}
