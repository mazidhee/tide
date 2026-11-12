#!/usr/bin/env node
// A stand-in for `claude -p`: replays recorded output lines, so the engine's process handling can
// be tested without the real CLI. It says what it was given (its arguments, any API key it can
// see, each message and model switch) in its replies. Words in a message change what it does:
// "crash" exits, "limit" answers as a plan at its limit, "slow" writes slowly until interrupted,
// "think" thinks before it writes.
import { createInterface } from 'readline'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const args = process.argv.slice(2)
const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
let model = flag('--model')
const tools = flag('--tools')
const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
const result = (text, extra = {}) => out({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 }, total_cost_usd: 0.001, duration_ms: 12, ttft_ms: 5, modelUsage: { [`claude-${model}-5-5`]: {} }, ...extra })

if (flag('--output-format') === 'json' || !flag('--input-format')) {
  // One call: the whole prompt on stdin, one result out (streamed when asked)
  let input = ''
  process.stdin.on('data', (d) => (input += d))
  process.stdin.on('end', () => {
    if (flag('--output-format') === 'json') {
      const verdict = input.includes('42') ? 'correct' : 'wrong'
      return result(JSON.stringify({ verdict, score: verdict === 'correct' ? 1 : 0, why: `marked by ${model}` }))
    }
    if (input.includes('limit')) return result('Claude usage limit reached', { is_error: true })
    const text = `draft by ${model}: ${input.slice(0, 30)}`
    delta(text.slice(0, 8))
    delta(text.slice(8))
    result(text)
  })
} else {
  out({ type: 'system', subtype: 'init', model: `claude-${model}-5-5`, tools: ['mcp__tide__run_code'], mcp_servers: [{ name: 'tide', status: 'connected' }] })
  let turn = 0
  let slow = null
  createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line)
    if (m.type === 'control_request' && m.request.subtype === 'set_model') {
      model = m.request.model
      return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } })
    }
    if (m.type === 'control_request' && m.request.subtype === 'interrupt') {
      clearInterval(slow)
      out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } })
      return out({ type: 'result', subtype: 'error_during_execution', is_error: true, usage: {}, total_cost_usd: 0.001 * turn, duration_ms: 5 })
    }
    if (m.type !== 'user') return
    turn++
    const said = typeof m.message.content === 'string' ? m.message.content : JSON.stringify(m.message.content)
    if (said.includes('crash')) process.exit(3)
    if (said.includes('limit')) {
      out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 600, rateLimitType: 'five_hour', utilization: 1 } })
      return out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached', usage: {}, total_cost_usd: 0, duration_ms: 5 })
    }
    out({ type: 'stream_event', event: { type: 'message_start' } })
    if (said.includes('slow')) {
      let n = 0
      slow = setInterval(() => delta(`word${++n} `), 20)
      return
    }
    if (said.includes('think')) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } })
    const reply = `pid ${process.pid} turn ${turn} model ${model} tools ${tools || 'none'} key ${process.env.ANTHROPIC_API_KEY ?? 'none'} heard: ${said.slice(0, 60)}`
    delta(reply.slice(0, 10))
    delta(reply.slice(10))
    out({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } })
    result(reply, { usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: turn > 1 ? 1100 : 0, cache_creation_input_tokens: turn > 1 ? 40 : 1100 }, total_cost_usd: 0.001 * turn })
  })
}
