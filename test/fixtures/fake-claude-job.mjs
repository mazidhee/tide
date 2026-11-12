#!/usr/bin/env node
// A stand-in for a one-shot `claude -p` job (main/claudeEngine claudeOnce): says which model
// answered. Words in the prompt change what it does: "LIMIT" answers as a plan at its limit,
// "OFFLINE" fails as Claude Code does with no network, "HANG" never answers.
const args = process.argv.slice(2)
const model = args[args.indexOf('--model') + 1]
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const result = (text, extra = {}) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 5 }, total_cost_usd: 0, duration_ms: 5, modelUsage: { [`claude-${model}`]: {} }, ...extra }) + '\n')
  if (input.includes('LIMIT')) return result('Claude usage limit reached', { is_error: true })
  if (input.includes('OFFLINE')) {
    process.stderr.write('API Error: getaddrinfo ENOTFOUND api.anthropic.com\n')
    process.exit(1)
  }
  if (input.includes('HANG')) return void setTimeout(() => {}, 60_000)
  result(`claude ${model}: ok`)
})
