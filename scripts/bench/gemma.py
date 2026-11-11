#!/usr/bin/env python3
"""
How fast the local model answers Tide, measured the way Tide talks to it.

    python3 scripts/bench/gemma.py speed --mode before     # the settings and behaviour Tide had
    python3 scripts/bench/gemma.py speed --mode after      # tuned cache, read-back and keep-warm
    python3 scripts/bench/gemma.py lesson --mode after     # one long lesson with full-length answers
    python3 scripts/bench/gemma.py check                   # the cache never changes an answer

`speed` covers cold and warm starts, short and long prompts, and conversations of several turns
with and without background work between them. Every scenario runs under its own cache tenant, so
nothing one scenario cached can help another, and "cold" means the server has truly never seen the
prompt. `check` asks the same things with and without the cache at temperature 0 and compares the
answers word for word, then edits earlier messages to prove no stale state is ever continued from.

Needs mlx-vlm's server on localhost:8080 with Gemma loaded. It changes the server's cache settings;
Tide puts its own back the next time it starts. Results are saved under scripts/bench/results.
"""
import argparse, json, os, random, statistics, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = json.load(open(os.path.join(HERE, 'chat-prefix.json')))
URL = 'http://localhost:8080'
NOW = '(Context from the app, not the student: it is Wednesday 11 November, 03:10.)'

# What Tide applied before this work, and what it applies now (src/main/modelServer.ts)
SETTINGS = {
    'before': {'apc_enabled': True, 'apc_disk_enabled': True, 'apc_disk_max_gb': 8, 'apc_memory_max_gb': 4, 'apc_memory_reserve_gb': None, 'apc_checkpoint_entries': 8, 'apc_checkpoint_interval_tokens': 8192, 'apc_checkpoint_guard_tokens': 1},
    'after': {'apc_enabled': True, 'apc_disk_enabled': True, 'apc_disk_max_gb': 20, 'apc_memory_max_gb': 2, 'apc_memory_reserve_gb': 0.5, 'apc_checkpoint_entries': 6, 'apc_checkpoint_interval_tokens': 8192, 'apc_checkpoint_guard_tokens': 4},
}

PARA = ("In two's complement, the most significant bit carries a negative weight, so adding signed and unsigned "
        "numbers uses the same circuit; overflow is detected by comparing carries into and out of the top bit. ")
QUESTIONS = ['Why is there no +128 in 8 bits?', 'Show -128 + 1 in binary.', 'What changes with 16 bits?', 'How is overflow detected?',
             'What is sign extension?', 'Why does subtraction reuse the adder?', 'What is the range of a signed byte?']


def call(method, path, body=None, tenant=None, timeout=900):
    headers = {'Content-Type': 'application/json'}
    if tenant:
        headers['X-APC-Tenant'] = tenant
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def ask(messages, tenant, max_tokens=150, tools=True, transient=NOW, temperature=0.2):
    """One streamed request. Returns seconds to the first word, the server's own timings, and the text."""
    body = {'model': PREFIX['model'], 'messages': messages, 'max_tokens': max_tokens, 'temperature': temperature, 'stream': True, 'stream_options': {'include_usage': True}}
    if tools:
        body['tools'] = PREFIX['tools']
    if transient:
        body['transient_context'] = transient
    req = urllib.request.Request(URL + '/v1/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-APC-Tenant': tenant})
    t0 = time.time()
    first, timings, text = None, None, ''
    with urllib.request.urlopen(req, timeout=900) as r:
        for line in r:
            line = line.decode().strip()
            if not line.startswith('data:') or line.endswith('[DONE]'):
                continue
            d = json.loads(line[5:])
            for ch in d.get('choices') or []:
                c = (ch.get('delta') or {}).get('content') or ''
                if c and first is None:
                    first = time.time() - t0
                text += c
            timings = d.get('timings') or timings
    return (first if first is not None else time.time() - t0), timings, text


def next_token(messages, tenant):
    """The model's five likeliest next tokens after this prompt, with their log-probabilities: a
    direct reading of the state the prompt left it in, which is exactly what the cache restores."""
    body = {'model': PREFIX['model'], 'messages': messages, 'tools': PREFIX['tools'], 'transient_context': NOW, 'max_tokens': 1, 'temperature': 0, 'stream': False, 'logprobs': True, 'top_logprobs': 5}
    req = urllib.request.Request(URL + '/v1/chat/completions', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-APC-Tenant': tenant})
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.loads(r.read())
    first = ((d['choices'][0].get('logprobs') or {}).get('content') or [{}])[0]
    return {t['token']: t['logprob'] for t in first.get('top_logprobs') or []}, (d.get('usage') or {}).get('prompt_tokens_details', {}).get('cached_tokens', 0)


def same_until(a, b):
    n = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
    return n if n < max(len(a), len(b)) else -1


def settle(settings):
    """Applies settings and waits until the server answers with them (a change reloads the model)."""
    current = call('GET', '/v1/settings')['current']
    changes = {k: v for k, v in settings.items() if k in current and current[k] != v}
    if changes:
        call('PATCH', '/v1/settings', changes)
    for _ in range(180):
        try:
            current = call('GET', '/v1/settings', timeout=5)['current']
            if all(current.get(k) == v for k, v in settings.items() if k in current):
                ask([{'role': 'user', 'content': 'ok'}], 'settle', 1, tools=False)
                return
        except Exception:
            pass
        time.sleep(1)
    raise SystemExit('The server did not take the settings')


def server_memory():
    pid = subprocess.run(['pgrep', '-f', 'mlx_vlm|gemma-server'], capture_output=True, text=True).stdout.split()
    if not pid:
        return ''
    out = subprocess.run(['footprint', '-p', pid[-1]], capture_output=True, text=True).stdout
    line = [l for l in out.splitlines() if 'Footprint:' in l]
    return line[0].split('Footprint:')[1].split('(')[0].strip() if line else ''


def mac_memory():
    swap = subprocess.run(['sysctl', '-n', 'vm.swapusage'], capture_output=True, text=True).stdout
    free = subprocess.run(['memory_pressure'], capture_output=True, text=True).stdout.strip().splitlines()[-1]
    return f"swap used {swap.split('used = ')[1].split()[0]}, {free.split(': ')[-1]} of memory free"


def system():
    return [{'role': 'system', 'content': PREFIX['system']}]


def long_history(turns, tag):
    out = system()
    for i in range(turns):
        out += [{'role': 'user', 'content': f'Question {i} about number representation ({tag})'}, {'role': 'assistant', 'content': PARA * 6}]
    return out


def background(tag):
    """A job like the ones Tide runs between turns: its own system prompt, no tools, a short answer."""
    return [{'role': 'system', 'content': 'You write a short title for a conversation. ' + ('Earlier conversation text about databases and indexes. ' * 150)},
            {'role': 'user', 'content': f'Title for conversation {tag}, five words.'}]


def converse(history, questions, tenant, mode, jobs, tag, answer_tokens=150):
    """A conversation of several turns. In 'after' mode each answer is read back and, once the
    background jobs have run, the conversation is touched again: what Tide now does itself."""
    rows = []
    convo = list(history)
    for qi, q in enumerate(questions):
        first, tm, answer = ask(convo + [{'role': 'user', 'content': q}], tenant, answer_tokens)
        rows.append({'first': first, 'new': tm['prompt_n'], 'cached': tm['cache_n'], 'rate': tm['predicted_per_second']})
        convo += [{'role': 'user', 'content': q}, {'role': 'assistant', 'content': answer}]
        if mode == 'after':
            ask(convo, tenant, 1)
        for k in range(jobs):
            ask(background(f'{tag}-{qi}-{k}'), tenant, 12, tools=False, transient=None)
        if mode == 'after' and jobs:
            ask(convo, tenant, 1)
    return rows


def lesson(mode, answer_tokens):
    """Only the long lesson, with answers as long as a tutor's really are (the full run caps them at 150 tokens)."""
    settle(SETTINGS[mode])
    run = f'{mode}-{random.randint(0, 10**9)}'
    rows = []
    for rep in range(2):
        t = f'{run}-lesson{rep}'
        rows += converse(long_history(10, t), [q + ' Explain fully, with a worked example.' for q in QUESTIONS[:5]], t, mode, 2, t, answer_tokens)[1:]
    firsts = [r['first'] for r in rows]
    print(f"{mode}: long lesson, answers up to {answer_tokens} tokens, background work between turns: first word {statistics.median(firsts):.2f}s median "
          f"({min(firsts):.2f} to {max(firsts):.2f}; n={len(rows)}), read {round(statistics.median(r['new'] for r in rows))} tokens a turn, wrote {statistics.median(r['rate'] for r in rows):.1f} tok/s | server {server_memory()}")


def speed(mode):
    settle(SETTINGS[mode])
    run = f'{mode}-{random.randint(0, 10**9)}'
    results = {}
    before = mac_memory()

    def scenario(name, rows):
        results[name] = rows
        firsts = [r['first'] for r in rows]
        print(f"{name:58s} first word {statistics.median(firsts):6.2f}s median  ({min(firsts):.2f} to {max(firsts):.2f}; n={len(rows)})  "
              f"read {round(statistics.median(r['new'] for r in rows)):5d} tokens  wrote {statistics.median(r['rate'] for r in rows):4.1f} tok/s", flush=True)

    def one(messages, tenant):
        first, tm, _ = ask(messages, tenant)
        return {'first': first, 'new': tm['prompt_n'], 'cached': tm['cache_n'], 'rate': tm['predicted_per_second']}

    # Cold start, short prompt: the server has never seen Tide's system prompt and tools
    scenario('Cold start, short question', [one(system() + [{'role': 'user', 'content': q}], f'{run}-cold-{i}') for i, q in enumerate(QUESTIONS[:3])])

    # Warm start, short prompt: the prefix was read when Tide opened (it warms it), then a first question
    t = f'{run}-warm'
    ask(system(), t, 1, transient='Hi')
    scenario('Warm start, short question', [one(system() + [{'role': 'user', 'content': q}], t) for q in QUESTIONS[:4]])

    # Cold, long prompt: a 6,000-token conversation the server has never seen (nothing can avoid this read)
    scenario('Cold start, long conversation (about 6,000 tokens)', [one(long_history(10, f'{run}-{i}') + [{'role': 'user', 'content': QUESTIONS[i]}], f'{run}-coldlong-{i}') for i in range(2)])

    # Several turns from an empty conversation, nothing else using the model
    t = f'{run}-chat'
    ask(system(), t, 1, transient='Hi')
    rows = converse(system(), QUESTIONS[:6], t, mode, 0, t)
    scenario('Short conversation, turns 2 to 6', rows[1:])

    # The same with one background job between turns
    t = f'{run}-chatbg'
    ask(system(), t, 1, transient='Hi')
    rows = converse(system(), QUESTIONS[:6], t, mode, 1, t)
    scenario('Short conversation with background work, turns 2 to 6', rows[1:])

    # A long lesson, two background jobs between turns
    for rep in range(2):
        t = f'{run}-lesson{rep}'
        rows = converse(long_history(10, t), QUESTIONS[:5], t, mode, 2, t)
        results.setdefault('lesson', []).extend(rows[1:])
    scenario('Long lesson (6,000+ tokens) with background work, turns 2 to 5', results.pop('lesson'))

    # Back after two minutes away from a conversation that was warm
    t = f'{run}-idle'
    convo = long_history(6, t)
    converse(convo, QUESTIONS[:1], t, mode, 0, t)
    first, tm, answer = ask(convo + [{'role': 'user', 'content': QUESTIONS[0]}], t)
    convo += [{'role': 'user', 'content': QUESTIONS[0]}, {'role': 'assistant', 'content': answer}]
    if mode == 'after':
        ask(convo, t, 1)
    time.sleep(120)
    scenario('Back after two minutes idle, next turn', [one(convo + [{'role': 'user', 'content': QUESTIONS[1]}], t)])

    stats = call('GET', '/v1/cache/stats')
    summary = {'mode': mode, 'at': time.strftime('%Y-%m-%d %H:%M'), 'server_memory': server_memory(), 'mac_before': before, 'mac_after': mac_memory(),
               'cache_in_memory_gb': round(stats.get('resident_bytes', 0) / 2**30, 2), 'refused': stats.get('memory_skips'), 'results': results}
    print(f"\nServer memory {summary['server_memory']} (cache {summary['cache_in_memory_gb']} GB in memory) | Mac before: {before} | after: {summary['mac_after']}")
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    json.dump(summary, open(os.path.join(HERE, 'results', f"{time.strftime('%Y-%m-%d-%H%M')}-{mode}.json"), 'w'), indent=1)


def check():
    """The cache must never change an answer, and must never continue from state that no longer matches."""
    settle(SETTINGS['after'])
    run = f'check-{random.randint(0, 10**9)}'
    failed = 0

    def verdict(ok, text):
        nonlocal failed
        failed += 0 if ok else 1
        print(('PASS  ' if ok else 'FAIL  ') + text, flush=True)

    # 1. The same prompt, continued from the cache and read from scratch by a server that has never
    # seen it. Two things are compared. The model's next-token probabilities, which depend on the
    # whole state the cache restored: they must agree to within rounding. And the full answers at
    # temperature 0, beside a control (two uncached runs against each other), because this server
    # is not exactly repeatable even with itself: near-ties between words can fall either way.
    worst = 0.0
    for i, q in enumerate(QUESTIONS[:6]):
        hot, cold, cold2 = f'{run}-hot-{i}', f'{run}-never-{i}', f'{run}-never2-{i}'
        convo = long_history(3 + i, f'{run}-{i}')
        ask(convo, hot, 1)                                        # read-back
        ask(background(f'{run}-{i}'), hot, 12, tools=False, transient=None)
        ask(convo, hot, 1)                                        # keep-warm
        turn = convo + [{'role': 'user', 'content': q}]
        p_hot, reused = next_token(turn, hot)
        p_cold, reused_cold = next_token(turn, cold)
        shared = set(p_hot) & set(p_cold)
        gap = max((abs(p_hot[t] - p_cold[t]) for t in shared), default=9.0)
        top_same = bool(p_hot) and max(p_hot, key=p_hot.get) == max(p_cold, key=p_cold.get)
        worst = max(worst, gap)
        verdict(reused > 0 and reused_cold == 0 and top_same and gap < 0.05,
                f"same next-token probabilities from the cache ({reused} tokens reused) and from scratch: largest difference {gap:.4f} in log-probability, same first choice: {top_same} | {q}")
        _, _, a_hot = ask(turn, hot, 160, temperature=0)
        _, _, a_cold = ask(turn, cold, 160, temperature=0)
        _, _, a_cold2 = ask(turn, cold2, 160, temperature=0)
        d_cache, d_control = same_until(a_hot, a_cold), same_until(a_cold, a_cold2)
        say = lambda n: 'identical' if n < 0 else f'differ from character {n}'
        # The cache may not make answers any less repeatable than the server already is
        verdict(d_cache < 0 or d_control >= 0, f"   full answers, cached against uncached: {say(d_cache)}; control, uncached against uncached: {say(d_control)}")
    print(f"      largest next-token difference over all prompts: {worst:.4f}")

    # 2. An earlier message is edited after the conversation was cached: the answer follows the edit
    t = f'{run}-edit'
    def locker(n):
        return system() + [{'role': 'user', 'content': f'Remember this for later: my locker number is {n}.'}, {'role': 'assistant', 'content': 'Noted. ' + PARA * 4},
                           {'role': 'user', 'content': 'Explain a carry bit briefly.'}, {'role': 'assistant', 'content': PARA * 3}]
    q = [{'role': 'user', 'content': 'What is my locker number? Reply with the number only.'}]
    ask(locker(17), t, 1)
    _, tm17, a17 = ask(locker(17) + q, t, 12, temperature=0)
    _, tm42, a42 = ask(locker(42) + q, t, 12, temperature=0)
    verdict('17' in a17 and '42' in a42 and '17' not in a42 and tm42['cache_n'] < tm17['cache_n'],
            f"an edited earlier message is read again, not answered from the old state: said {a17.strip()!r}, then after the edit {a42.strip()!r} (reused {tm17['cache_n']} then only {tm42['cache_n']} tokens)")

    # 3. The assistant's own earlier answer is edited (regenerated): same rule
    def fact(word):
        return system() + [{'role': 'user', 'content': 'Give me a code word to remember.'}, {'role': 'assistant', 'content': f'Your code word is {word}. ' + PARA * 3}]
    q = [{'role': 'user', 'content': 'What code word did you give me? Reply with the word only.'}]
    ask(fact('HARBOUR'), t, 1)
    _, _, a1 = ask(fact('HARBOUR') + q, t, 12, temperature=0)
    _, _, a2 = ask(fact('LANTERN') + q, t, 12, temperature=0)
    verdict('HARBOUR' in a1.upper() and 'LANTERN' in a2.upper() and 'HARBOUR' not in a2.upper(), f"an edited earlier answer is read again: {a1.strip()!r} then {a2.strip()!r}")

    # 4. Another conversation never sees this one's state
    _, _, other = ask(system() + [{'role': 'user', 'content': 'What is my locker number? If I never told you, reply with the single word UNKNOWN.'}], t, 12, temperature=0)
    verdict('17' not in other and '42' not in other, f"a different conversation in the same cache knows nothing of it: {other.strip()!r}")

    # 5. A conversation cut short (messages removed from the end) continues from the shorter state
    _, _, cut = ask(locker(17)[:3] + [{'role': 'user', 'content': 'Have I asked you about a carry bit yet? Reply YES or NO only.'}], t, 6, temperature=0)
    verdict('NO' in cut.upper(), f"a conversation with its last turns removed doesn't remember them: {cut.strip()!r}")

    print(f"\n{'All checks passed' if not failed else f'{failed} check(s) failed'}")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('what', choices=['speed', 'lesson', 'check'])
    p.add_argument('--mode', choices=['before', 'after'], default='after')
    p.add_argument('--answer', type=int, default=500, help='for `lesson`: the most tokens an answer may run to')
    a = p.parse_args()
    {'speed': lambda: speed(a.mode), 'lesson': lambda: lesson(a.mode, a.answer), 'check': check}[a.what]()
