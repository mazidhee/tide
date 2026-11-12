#!/usr/bin/env node
// A stand-in for a one-shot `claude -p` job (main/claudeEngine claudeOnce): says which model
// answered. Words in the prompt change what it does: "LIMIT" answers as a plan at its limit,
// "OFFLINE" fails as Claude Code does with no network, "HANG" never answers. Pictures sent as
// stream-json image blocks are counted in the answer.
const args = process.argv.slice(2)
const model = args[args.indexOf('--model') + 1]
const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  // A message with pictures comes as stream-json (main/claudeCli onceArgs): its words, and how many pictures, of what type
  let pics = []
  if (flag('--input-format') === 'stream-json') {
    if (flag('--output-format') !== 'stream-json' || !args.includes('--verbose')) process.exit(2)
    const content = JSON.parse(input.trim().split('\n')[0]).message.content
    pics = (Array.isArray(content) ? content : []).filter((b) => b.type === 'image')
    input = Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : content
    // Streamed output: other lines come before the result
    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: `claude-${model}` }) + '\n')
  }
  const saw = pics.length ? `, saw ${pics.length} picture${pics.length === 1 ? '' : 's'} (${pics.map((b) => b.source.media_type).join(', ')})` : ''
  const result = (text, extra = {}) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 5 }, total_cost_usd: 0, duration_ms: 5, modelUsage: { [`claude-${model}`]: {} }, ...extra }) + '\n')
  if (input.includes('LIMIT')) return result('Claude usage limit reached', { is_error: true })
  if (input.includes('OFFLINE')) {
    process.stderr.write('API Error: getaddrinfo ENOTFOUND api.anthropic.com\n')
    process.exit(1)
  }
  if (input.includes('HANG')) return void setTimeout(() => {}, 60_000)
  // An exam answer: marked as JSON
  if (input.includes('Mark scheme:')) return result(JSON.stringify({ awarded: pics.length ? 2 : 0, feedback: `marked by ${model}${saw}`, missed: '' }))
  result(`claude ${model}: ok${saw}`)
})
