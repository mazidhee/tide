#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json`: replays
// recorded output lines for each user message, so the engine's process handling can be tested
// without the real CLI. It says what it was given (its arguments, any API key it can see, each
// message and model switch) in its replies, and dies on the word "crash".
import { createInterface } from 'readline'
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const args = process.argv.slice(2)
let model = args[args.indexOf('--model') + 1]
// The one-shot marking call: the whole prompt on stdin, one JSON result out
if (args[args.indexOf('--output-format') + 1] === 'json') {
  let input = ''
  process.stdin.on('data', (d) => (input += d))
  process.stdin.on('end', () => {
    const verdict = input.includes('42') ? 'correct' : 'wrong'
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ verdict, score: verdict === 'correct' ? 1 : 0, why: `marked by ${model}` }), usage: { input_tokens: 50, output_tokens: 30 }, total_cost_usd: 0.002, duration_ms: 20, modelUsage: { [`claude-${model}-5-5`]: {} } })
  })
} else {
out({ type: 'system', subtype: 'init', model: `claude-${model}-5-5`, tools: ['mcp__tide__run_code'], mcp_servers: [{ name: 'tide', status: 'connected' }] })
let turn = 0
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.type === 'control_request' && m.request.subtype === 'set_model') {
    model = m.request.model
    out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } })
    return
  }
  if (m.type !== 'user') return
  turn++
  const said = typeof m.message.content === 'string' ? m.message.content : JSON.stringify(m.message.content)
  if (said.includes('crash')) process.exit(3)
  if (said.includes('limit')) {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 600, rateLimitType: 'five_hour', utilization: 1 } })
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached', usage: {}, total_cost_usd: 0, duration_ms: 5 })
    return
  }
  const reply = `pid ${process.pid} turn ${turn} model ${model} key ${process.env.ANTHROPIC_API_KEY ?? 'none'} heard: ${said.slice(0, 60)}`
  out({ type: 'stream_event', event: { type: 'message_start' } })
  for (const part of [reply.slice(0, 10), reply.slice(10)]) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } } })
  out({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } })
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: turn > 1 ? 1100 : 0, cache_creation_input_tokens: turn > 1 ? 40 : 1100 }, total_cost_usd: 0.001, duration_ms: 12, ttft_ms: 5, modelUsage: { [`claude-${model}-5-5`]: {} } })
})
}
