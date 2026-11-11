"""
Runs what a gold example states, so that nothing in the set is written from memory:

  - every <check lang="python"> in the tutor's turns and the reply (as Tide would run them)
  - every complete python, javascript, c and cpp block the tutor shows, compiled as the app
    compiles (src/main/runner.ts); when a plain fenced block follows it, that block must be the
    program's real output, character for character
  - every sql block the tutor shows, on a copy of the lab's sample database, and every chart
    block's query (which must return a category and at least one numeric column)
  - the example's own verify script: Python with asserts that re-derive each number, mark and
    result, given `reply`, `history`, `tutor`, `learner`, `ex` and the helpers below

Usage: python goldverify.py examples.json results.json  (run by cli.ts check; standard library only,
numpy if the interpreter has it). GOLD_LAB_DB names the lab database (made from the app's seeded
sample data); without it SQL on the lab is reported as not run.
"""
import json, os, re, shutil, sqlite3, subprocess, sys, tempfile, traceback
from concurrent.futures import ThreadPoolExecutor

LAB_DB = os.environ.get('GOLD_LAB_DB', '')
FENCE = re.compile(r'```([\w-]*)[^\n]*\n([\s\S]*?)```')
CC = {'c': ['/usr/bin/clang', '-std=c17'], 'cpp': ['/usr/bin/clang++', '-std=c++20']}
FLAGS = ['-Wall', '-Wextra', '-g', '-fsanitize=undefined,bounds', '-fno-omit-frame-pointer']


class Failed(Exception):
    pass


def visible(text):
    """What the learner reads: without <solution> and <check>"""
    return re.sub(r'<(solution|check)\b[^>]*>[\s\S]*?</\1>', '', text, flags=re.I)


def solution(text):
    return '\n'.join(m.strip() for m in re.findall(r'<solution\b[^>]*>([\s\S]*?)</solution>', text, flags=re.I))


def blocks(text, lang=None):
    """Bodies of the fenced blocks in text, of one language ('' for a plain block) or all"""
    return [m.group(2) for m in FENCE.finditer(text) if lang is None or m.group(1).lower() == lang]


def block(text, lang, n=0):
    found = blocks(text, lang)
    assert len(found) > n, f'no {lang or "plain"} block number {n} in the text'
    return found[n]


def table(text, n=0):
    """The nth Markdown table as rows of cell strings, header first, rule left out"""
    tables, cur = [], []
    for line in re.sub(FENCE, '', text).split('\n'):
        if line.count('|') >= 2:
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-{2,}:?', c) for c in cells):
                cur.append(cells)
        elif cur:
            tables.append(cur)
            cur = []
    if cur:
        tables.append(cur)
    assert len(tables) > n, f'no table number {n}'
    return tables[n]


def _run(cmd, stdin='', cwd=None, timeout=20):
    p = subprocess.run(cmd, input=stdin, capture_output=True, text=True, cwd=cwd, timeout=timeout)
    return p.stdout, p.stderr, p.returncode


def run_py_full(src, stdin=''):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'main.py')
        open(f, 'w').write(src)
        return _run([sys.executable, f], stdin, cwd=d)


def run_py(src, stdin=''):
    out, err, code = run_py_full(src, stdin)
    assert code == 0, f'python exited {code}: {err[-400:]}'
    return out


def run_js(src, stdin=''):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'main.js')
        open(f, 'w').write(src)
        out, err, code = _run(['node', f], stdin, cwd=d)
    assert code == 0, f'node exited {code}: {err[-400:]}'
    return out


def run_c_full(src, lang='c', stdin=''):
    """(stdout, stderr of the program, compiler messages, exit code); compiled as the app compiles"""
    with tempfile.TemporaryDirectory() as d:
        name = 'main.c' if lang == 'c' else 'main.cpp'
        open(os.path.join(d, name), 'w').write(src)
        _, cerr, code = _run(CC[lang] + FLAGS + ['-o', 'prog', name], cwd=d, timeout=60)
        if code != 0:
            return '', '', cerr, code
        out, err, code = _run([os.path.join(d, 'prog')], stdin, cwd=d)
        return out, err, cerr, code


def run_c(src, stdin=''):
    out, err, cerr, code = run_c_full(src, 'c', stdin)
    assert code == 0, f'C failed ({code}): {(cerr or err)[-600:]}'
    return out


def run_cpp(src, stdin=''):
    out, err, cerr, code = run_c_full(src, 'cpp', stdin)
    assert code == 0, f'C++ failed ({code}): {(cerr or err)[-600:]}'
    return out


def sql(query, setup=''):
    """Rows of the last statement, on an empty in-memory SQLite database (setup runs first)"""
    con = sqlite3.connect(':memory:')
    if setup:
        con.executescript(setup)
    return _last_rows(con, query)


def _statements(script):
    out, cur = [], ''
    for line in script.split('\n'):
        cur += line + '\n'
        if sqlite3.complete_statement(cur):
            if cur.strip().strip(';').strip():
                out.append(cur.strip())
            cur = ''
    if cur.strip():
        out.append(cur.strip())
    return out


def _last_rows(con, script):
    rows = []
    for st in _statements(script):
        cur = con.execute(st)
        if cur.description:
            rows = cur.fetchall()
    con.commit()
    return rows


class Lab:
    """A private copy of the lab's sample data (customers, products, orders, order_items, users, events)"""

    def __init__(self):
        assert LAB_DB and os.path.exists(LAB_DB), 'GOLD_LAB_DB is not set: the lab database is needed to run this'
        self.con = sqlite3.connect(':memory:')
        src = sqlite3.connect(f'file:{LAB_DB}?mode=ro', uri=True)
        src.backup(self.con)
        src.close()

    def __call__(self, query):
        return _last_rows(self.con, query)

    def columns(self, query):
        cur = self.con.execute(_statements(query)[-1])
        return [d[0] for d in cur.description]


def approx(a, b, tol=1e-9):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def _norm_out(s):
    return '\n'.join(l.rstrip() for l in s.strip().split('\n'))


def _shown_output(text, end):
    """The plain fenced block that follows a code block closely (its output), or None"""
    m = FENCE.search(text, end)
    if not m or m.group(1) != '':
        return None
    between = text[end:m.start()]
    if len(between.strip()) > 90 or '\n\n\n' in between:
        return None
    return m.group(2)


def autorun(text, where, lab, problems, on_lab=True):
    for m in FENCE.finditer(text):
        lang, body = m.group(1).lower(), m.group(2)
        shown = _shown_output(text, m.end())
        try:
            if lang == 'python':
                out, err, code = run_py_full(body)
                if code != 0 and not (shown and err.strip().split('\n')[-1] in shown):
                    problems.append(f'{where}: a python block fails when run: {err.strip()[-300:]}')
                elif shown is not None and code == 0 and _norm_out(out) != _norm_out(shown):
                    problems.append(f'{where}: the output shown under a python block is not what it prints. Real output:\n{out.strip()[:600]}')
            elif lang == 'javascript':
                out = run_js(body)
                if shown is not None and _norm_out(out) != _norm_out(shown):
                    problems.append(f'{where}: the output shown under a javascript block is not what it prints. Real output:\n{out.strip()[:600]}')
            elif lang in ('c', 'cpp') and re.search(r'\bmain\s*\(', body):
                out, err, cerr, code = run_c_full(body, lang)
                if cerr and code != 0 and not (shown and 'error' in shown):
                    problems.append(f'{where}: a {lang} block does not compile: {cerr.strip()[-400:]}')
                elif shown is not None and code == 0 and 'warning' not in shown and 'runtime error' not in shown and _norm_out(out) != _norm_out(shown):
                    problems.append(f'{where}: the output shown under a {lang} block is not what it prints. Real output:\n{out.strip()[:600]}')
                elif code == 0 and (cerr.strip() or err.strip()) and not (shown and ('warning' in shown or 'runtime error' in shown)) and not re.search(r'warning|undefined behaviou?r|runtime error', visible(text), re.I):
                    problems.append(f'{where}: a {lang} block compiles or runs with a diagnostic the text never mentions: {(cerr + err).strip()[:300]}')
            elif lang == 'sql' and on_lab:
                try:
                    lab()(body)
                except sqlite3.Error as e:
                    if str(e) not in visible(text):
                        problems.append(f'{where}: an sql block fails on the lab database: {e}')
            elif lang == 'chart':
                q = json.loads(body)['sql']
                rows = lab()(q)
                if not rows:
                    problems.append(f'{where}: the chart query returns no rows')
                elif len(rows[0]) < 2 or not all(isinstance(v, (int, float)) for r in rows for v in r[1:] if v is not None):
                    problems.append(f'{where}: a chart draws the numeric columns after the first; this query has none')
        except AssertionError as e:
            problems.append(f'{where}: {e}')
        except subprocess.TimeoutExpired:
            problems.append(f'{where}: a {lang} block did not finish in time')
        except Exception as e:  # noqa: BLE001
            problems.append(f'{where}: could not run a {lang} block: {e}')


def check_tags(text, where, problems):
    for m in re.finditer(r'<check\b([^>]*)>([\s\S]*?)</check>', text, flags=re.I):
        code = re.sub(r'^\s*```\w*\n?|```\s*$', '', m.group(2)).strip()
        out, err, rc = run_py_full(code)
        if rc != 0:
            problems.append(f'{where}: its <check> fails: {err.strip()[-300:]}')


def verify_one(ex):
    problems = []
    holder = {}

    def lab():
        if 'lab' not in holder:
            holder['lab'] = Lab()
        return holder['lab']

    tutor = [t['tutor'] for t in ex['history'] if 'tutor' in t]
    auto = ex.get('autorun', True)
    try:
        for i, t in enumerate(tutor):
            check_tags(t, f'tutor turn {i + 1}', problems)
            if auto:
                autorun(t, f'tutor turn {i + 1}', lab, problems)
        check_tags(ex['reply'], 'reply', problems)
        if auto:
            autorun(ex['reply'], 'reply', lab, problems)
    except Exception as e:  # noqa: BLE001
        problems.append(f'automatic run failed: {e}')
    script = ex.get('verify')
    if script:
        last = ex['history'][-1]['learner'] if ex['history'] else {}
        env = {
            '__name__': 'verify', 'ex': ex, 'reply': ex['reply'], 'history': ex['history'], 'tutor': tutor, 'learner': last.get('answer', last.get('question', '')),
            'visible': visible, 'solution': solution, 'blocks': blocks, 'block': block, 'table': table, 'run_py': run_py, 'run_py_full': run_py_full, 'run_js': run_js,
            'run_c': run_c, 'run_cpp': run_cpp, 'run_c_full': run_c_full, 'sql': sql, 'lab': lambda q: lab()(q), 'lab_columns': lambda q: lab().columns(q), 'approx': approx
        }
        try:
            exec(compile(script, f"verify:{ex['id']}", 'exec'), env)
        except AssertionError as e:
            tb = traceback.extract_tb(e.__traceback__)[-1]
            line = script.split('\n')[tb.lineno - 1].strip() if tb.filename.startswith('verify:') and tb.lineno <= len(script.split('\n')) else ''
            problems.append(f'verify: assertion failed at line {tb.lineno}: {line} {e}'.strip())
        except Exception as e:  # noqa: BLE001
            problems.append(f'verify: {type(e).__name__}: {e}')
    return ex['id'], problems


def main():
    examples = json.load(open(sys.argv[1]))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(verify_one, examples))
    json.dump(results, open(sys.argv[2], 'w'))


if __name__ == '__main__':
    main()
