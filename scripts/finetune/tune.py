#!/usr/bin/env python3
"""
A LoRA for Tide's tutor: check, train, evaluate, fuse. Prepared, and never yet run for real.

    python3 scripts/finetune/tune.py check                 # read-only: what is installed, how much data, is it enough
    python3 scripts/finetune/tune.py train --print         # the exact training command, without running it
    python3 scripts/finetune/tune.py train --smoke         # 5 iterations: measures seconds per step and peak memory
    python3 scripts/finetune/tune.py train                 # the real run (hours; the tutor is off while it runs)
    python3 scripts/finetune/tune.py stop                  # ask a running train to stop after its next save
    python3 scripts/finetune/tune.py eval                  # the tutor benchmark on base and adapter, compared
    python3 scripts/finetune/tune.py fuse --out DIR        # merge the adapter into a model folder (see README: not the advised way to serve)

It uses the trainer that is installed in ~/mlx-env312: mlx-vlm's own (python -m mlx_vlm.train),
because mlx-lm is not installed there and mlx-vlm is what serves the tutor, so the adapter it
writes is one the server reads (--adapter-path). `--trainer mlx-lm` prints or runs the equivalent
mlx_lm.lora command instead, for after mlx-lm has been installed; that path is unverified here.

Nothing in this file downloads a model or installs a package. `train`, `eval` and `fuse` refuse to
start without the things they need and say what is missing. The reasons for every setting are in
scripts/finetune/README.md.
"""
import argparse, importlib.metadata, json, os, shutil, signal, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
VENV = os.path.expanduser('~/mlx-env312')
PY = os.path.join(VENV, 'bin', 'python')
BASE = 'mlx-community/gemma-4-12B-it-4bit'
DRAFTER = 'mlx-community/gemma-4-12B-it-qat-assistant-5bit'
DATA = os.path.join(HERE, 'data')
RUNS = os.path.join(HERE, 'runs')

# Settings argued in the README. One place, so `check`, `train --print` and the README agree.
SETTINGS = {
    'rank': 8,                 # protocol and voice are low-rank changes; more rank on little data memorises it
    'alpha': 16.0,             # scale = alpha / rank = 2
    'dropout': 0.05,
    'target_modules': ['q_proj', 'v_proj'],   # attention only: about 5M trainable weights over 48 layers
    'mlx_lm_layers': 16,       # mlx-lm only: adapt the last 16 of 48 layers
    'batch_size': 1,           # one 8k-token lesson prefix at a time is what 24 GB allows
    'grad_accumulation': 8,    # an effective batch of 8
    'learning_rate': 1e-4,
    'max_seq_length': 8192,    # a lesson's fixed prompt is already about 5k tokens
    'epochs': 2,
    'steps_per_save': 25,      # what a stop or a crash can lose, at most
    'steps_per_eval': 100,
    'val_batches': 20,
    'seed': 0,
}

# Below this, training is refused: see "How many examples" in the README (estimates)
MIN_TRAIN = 300
MIN_VALID = 30
MIN_FREE_GB = 17      # estimated peak while training with gradient checkpointing, plus headroom
SECONDS_PER_STEP = (60, 150)   # estimated range for one 8k-token step on an M4 Pro; `train --smoke` measures it


def version(pkg):
    """A package's version in the MLX environment, read from its metadata without importing it"""
    try:
        out = subprocess.run([PY, '-c', f"import importlib.metadata as m; print(m.version('{pkg}'))"], capture_output=True, text=True, timeout=30)
        return out.stdout.strip() or None
    except Exception:
        return None


def manifest(data):
    try:
        return json.load(open(os.path.join(data, 'manifest.json')))
    except Exception:
        return None


def count_lines(path):
    try:
        return sum(1 for l in open(path) if l.strip())
    except Exception:
        return 0


def server_running():
    """Whether the model server is up, from the process list (nothing is sent to it)"""
    out = subprocess.run(['pgrep', '-fl', 'mlx_vlm.server|mlx_vlm/server'], capture_output=True, text=True).stdout.strip()
    return out or None


def cached(repo):
    path = os.path.expanduser(f"~/.cache/huggingface/hub/models--{repo.replace('/', '--')}")
    return path if os.path.isdir(path) else None


def memory_gb():
    try:
        return int(subprocess.run(['sysctl', '-n', 'hw.memsize'], capture_output=True, text=True).stdout) / 2**30
    except Exception:
        return None


def iters_for(n_train, s=SETTINGS):
    return max(1, n_train * s['epochs'] // s['batch_size'])


def readiness(args):
    """Everything `train` needs, as (ok, line) pairs; nothing here changes anything"""
    lines = []
    def say(ok, text):
        lines.append((ok, text))
    vlm, lm, mlx = version('mlx-vlm'), version('mlx-lm'), version('mlx')
    say(os.path.exists(PY), f"MLX environment: {VENV}")
    say(bool(mlx), f"mlx {mlx or 'not installed'}")
    say(bool(vlm), f"mlx-vlm {vlm or 'not installed'} (its trainer, python -m mlx_vlm.train, is what `train` runs)")
    say(bool(lm) or args.trainer != 'mlx-lm', f"mlx-lm {lm or 'not installed'}{'' if lm else ' (only needed for --trainer mlx-lm; nothing here installs it)'}")
    say(bool(cached(args.model)) or os.path.isdir(args.model), f"base model {args.model}: {'on this Mac' if cached(args.model) or os.path.isdir(args.model) else 'NOT downloaded (training would try to fetch it: refused)'}")
    n_train, n_valid = count_lines(os.path.join(args.data, 'train.jsonl')), count_lines(os.path.join(args.data, 'valid.jsonl'))
    say(n_train >= MIN_TRAIN, f"training examples: {n_train} (at least {MIN_TRAIN} wanted) in {args.data}")
    say(n_valid >= MIN_VALID, f"held-out examples: {n_valid} (at least {MIN_VALID} wanted)")
    m = manifest(args.data)
    if m:
        for w in m.get('warnings', []):
            say(False, f"builder warning: {w}")
    mem = memory_gb()
    say(bool(mem and mem >= 24), f"memory: {mem:.0f} GB" if mem else 'memory: unknown')
    srv = server_running()
    say(not srv, 'model server: not running' if not srv else f"model server is RUNNING ({srv.splitlines()[0][:60]}): stop it first, the Mac cannot hold both")
    free = shutil.disk_usage(HERE).free / 2**30
    say(free > 5, f"free disk: {free:.0f} GB (checkpoints are small; a fused model would need about 7 GB)")
    return lines, n_train, n_valid


def cmd_check(args):
    lines, n_train, _ = readiness(args)
    for ok, text in lines:
        print(f"  {'ok ' if ok else 'NO '} {text}")
    iters = iters_for(max(n_train, MIN_TRAIN))
    lo, hi = (iters * s / 3600 for s in SECONDS_PER_STEP)
    print(f"\nA run on {max(n_train, MIN_TRAIN)} examples would be {iters} steps: an ESTIMATED {lo:.0f} to {hi:.0f} hours with the tutor off (measure with `train --smoke`).")
    ready = all(ok for ok, _ in lines)
    print('\nReady to train.' if ready else '\nNot ready to train: see the lines marked NO.')
    return 0 if ready else 1


def train_command(args, iters, out):
    s = SETTINGS
    if args.trainer == 'mlx-lm':
        # mlx_lm.lora takes rank and scale from a config file; flags as documented by mlx-lm, unverified here (not installed)
        config = os.path.join(out, 'lora.yaml')
        body = (f"lora_parameters:\n  rank: {s['rank']}\n  scale: {s['alpha'] / s['rank']}\n  dropout: {s['dropout']}\n"
                f"  keys: [{', '.join(repr('self_attn.' + m) for m in s['target_modules'])}]\n")
        return [PY, '-m', 'mlx_lm', 'lora', '--model', args.model, '--train', '--data', args.data, '-c', config,
                '--fine-tune-type', 'lora', '--num-layers', str(s['mlx_lm_layers']), '--batch-size', str(s['batch_size']),
                '--grad-accumulation-steps', str(s['grad_accumulation']), '--iters', str(iters), '--learning-rate', str(s['learning_rate']),
                '--max-seq-length', str(s['max_seq_length']), '--grad-checkpoint', '--mask-prompt',
                '--steps-per-report', '5', '--steps-per-eval', str(s['steps_per_eval']), '--val-batches', str(s['val_batches']),
                '--save-every', str(s['steps_per_save']), '--adapter-path', out, '--seed', str(s['seed'])] + (['--resume-adapter-file', args.resume] if args.resume else []), (config, body)
    return [PY, '-m', 'mlx_vlm.train', '--algorithm', 'sft', '--model', args.model, '--data', args.data,
            '--train-type', 'lora', '--lora-rank', str(s['rank']), '--lora-alpha', str(s['alpha']), '--lora-dropout', str(s['dropout']),
            '--target-modules', *s['target_modules'],
            '--batch-size', str(s['batch_size']), '--gradient-accumulation-steps', str(s['grad_accumulation']),
            '--iters', str(iters), '--learning-rate', str(s['learning_rate']), '--max-seq-length', str(s['max_seq_length']),
            '--grad-checkpoint', '--train-on-completions',
            '--steps-per-report', '5', '--steps-per-eval', str(s['steps_per_eval']), '--val-batches', str(s['val_batches']),
            '--steps-per-save', str(s['steps_per_save']), '--output-path', out, '--seed', str(s['seed'])] + (['--resume-adapter-file', args.resume] if args.resume else []), None


def cmd_train(args):
    lines, n_train, _ = readiness(args)
    out = os.path.join(RUNS, args.name)
    iters = 5 if args.smoke else (args.iters or iters_for(n_train))
    cmd, config = train_command(args, iters, out)
    if args.print:
        print(' \\\n  '.join(cmd))
        if config:
            print(f"\n# with {config[0]} holding:\n{config[1]}")
        return 0
    blocked = [text for ok, text in lines if not ok]
    # A smoke run only measures speed and memory: it may run on too few examples, never without the model or beside the server
    if args.smoke:
        blocked = [b for b in blocked if 'examples' not in b and 'builder warning' not in b]
        if n_train < 1:
            blocked.append('no training examples at all')
    if blocked:
        print('Not training:\n' + '\n'.join(f"  - {b}" for b in blocked))
        return 1
    os.makedirs(out, exist_ok=True)
    if config:
        open(config[0], 'w').write(config[1])
    json.dump({'command': cmd, 'settings': SETTINGS, 'iters': iters, 'started': time.strftime('%Y-%m-%d %H:%M'), 'data': manifest(args.data)}, open(os.path.join(out, 'run.json'), 'w'), indent=2)
    stop_file = os.path.join(out, 'STOP')
    if os.path.exists(stop_file):
        os.remove(stop_file)
    lo, hi = (iters * s / 3600 for s in SECONDS_PER_STEP)
    print(f"Training {iters} steps into {out}: an estimated {lo:.1f} to {hi:.1f} hours. The tutor is unavailable until this ends.\n"
          f"To stop without losing work: python3 scripts/finetune/tune.py stop --name {args.name}   (or Ctrl-C: at most {SETTINGS['steps_per_save']} steps are lost)\n")
    # HF_HUB_OFFLINE: the model is already on this Mac; never let a typo in a path turn into a download
    env = {**os.environ, 'HF_HUB_OFFLINE': '1'}
    log = open(os.path.join(out, 'train.log'), 'a')
    child = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    adapter = os.path.join(out, 'adapters.safetensors')
    saved_at = os.path.getmtime(adapter) if os.path.exists(adapter) else 0
    stopping = False
    try:
        for line in child.stdout:
            sys.stdout.write(line)
            log.write(line)
            log.flush()
            # The trainer has no way to be asked to stop, so it is interrupted just after a save: nothing is lost
            now = os.path.getmtime(adapter) if os.path.exists(adapter) else 0
            if os.path.exists(stop_file) and now > saved_at and not stopping:
                stopping = True
                print('\nSTOP was asked for and a checkpoint has just been written: stopping.')
                child.send_signal(signal.SIGINT)
            saved_at = max(saved_at, now) if not os.path.exists(stop_file) else saved_at
    except KeyboardInterrupt:
        stopping = True
        child.send_signal(signal.SIGINT)
    code = child.wait()
    if stopping:
        print(f"\nStopped. The last checkpoint is {adapter}. To carry on:\n  python3 scripts/finetune/tune.py train --name {args.name} --resume {out} --iters <steps left>\n"
              "(the optimiser's state is not restored, and the step count starts again from 1)")
        return 0
    return code


def cmd_stop(args):
    out = os.path.join(RUNS, args.name)
    if not os.path.isdir(out):
        print(f"No run called {args.name}.")
        return 1
    open(os.path.join(out, 'STOP'), 'w').write(time.strftime('%Y-%m-%d %H:%M'))
    print(f"Asked {args.name} to stop after its next save (every {SETTINGS['steps_per_save']} steps).")
    return 0


def cmd_eval(args):
    """The tutor benchmark on the base and on the adapter, then the comparison and its go/no-go"""
    adapter = os.path.abspath(args.adapter or os.path.join(RUNS, args.name))
    if not os.path.exists(os.path.join(adapter, 'adapters.safetensors')):
        print(f"No adapter at {adapter}.")
        return 1
    if not server_running():
        print('Start the model server first (the same way Tide does), without --adapter-path: the adapter is asked for per request.')
        return 1
    results = os.path.join(adapter, 'bench')
    run = ['npx', 'vite-node', 'scripts/eval/tutor/run.ts', '--', '--base-url', args.base_url, '--out', results, '--repeats', str(args.repeats)]
    env = {**os.environ, 'PATH': '/opt/homebrew/bin:' + os.environ.get('PATH', '')}
    for label, extra in (('base', []), ('adapter', ['--adapter-path', adapter])):
        print(f"\n=== {label} ===")
        code = subprocess.run(run + ['--label', label] + extra, cwd=REPO, env=env).returncode
        if code:
            return code
    files = sorted(os.listdir(results))
    base = [f for f in files if f.endswith('-base.json')][-1]
    cand = [f for f in files if f.endswith('-adapter.json')][-1]
    print('\n=== comparison ===')
    return subprocess.run(['npx', 'vite-node', 'scripts/eval/tutor/compare.ts', '--', os.path.join(results, base), os.path.join(results, cand)], cwd=REPO, env=env).returncode


FUSE = r'''
import sys, json, shutil
from pathlib import Path
import mlx.core as mx
from mlx.utils import tree_unflatten
from mlx_vlm.utils import load, get_model_path, save_weights
model_id, adapter, out, dequantize = sys.argv[1], sys.argv[2], Path(sys.argv[3]), sys.argv[4] == '1'
model, processor = load(model_id, adapter_path=adapter)
fused = [(name, m.fuse(dequantize=dequantize)) for name, m in model.named_modules() if hasattr(m, 'fuse') and hasattr(m, 'lora_a')]
if not fused:
    sys.exit('No LoRA layers found on the loaded model: nothing to fuse.')
model.update_modules(tree_unflatten(fused))
out.mkdir(parents=True, exist_ok=True)
src = Path(get_model_path(model_id))
for f in src.iterdir():
    if f.is_file() and not f.name.endswith('.safetensors') and f.name != 'model.safetensors.index.json':
        shutil.copy(f, out / f.name)
save_weights(out, model)
print(f"Fused {len(fused)} layers into {out}")
'''


def cmd_fuse(args):
    adapter = os.path.abspath(args.adapter or os.path.join(RUNS, args.name))
    if not os.path.exists(os.path.join(adapter, 'adapters.safetensors')):
        print(f"No adapter at {adapter}.")
        return 1
    if server_running():
        print('Stop the model server first: fusing loads the whole model a second time.')
        return 1
    print('UNTESTED: mlx-vlm ships LoRALinear.fuse() but no command that uses it, so this script is the only caller.\n'
          'Check the result with `eval --adapter` numbers against a benchmark run on the fused folder before serving it.')
    env = {**os.environ, 'HF_HUB_OFFLINE': '1'}
    code = subprocess.run([PY, '-c', FUSE, args.model, adapter, os.path.abspath(args.out), '1' if args.dequantize else '0'], env=env).returncode
    if code == 0:
        print(f"\nServe it with the draft model as Tide does:\n  {VENV}/bin/mlx_vlm.server --model {os.path.abspath(args.out)} --port 8080 --draft-model {DRAFTER} --draft-kind mtp --draft-block-size 3")
    return code


def main():
    p = argparse.ArgumentParser(description="A LoRA for Tide's tutor: check, train, evaluate, fuse.")
    sub = p.add_subparsers(dest='cmd', required=True)
    def common(sp):
        sp.add_argument('--model', default=BASE, help='the base to train: the 4-bit model that is served (see README)')
        sp.add_argument('--data', default=DATA, help='folder with train.jsonl and valid.jsonl from build.ts')
        sp.add_argument('--name', default='tutor-lora', help='the run, under scripts/finetune/runs/')
        sp.add_argument('--trainer', choices=('mlx-vlm', 'mlx-lm'), default='mlx-vlm')
    c = sub.add_parser('check'); common(c)
    t = sub.add_parser('train'); common(t)
    t.add_argument('--print', action='store_true', help='print the command and stop')
    t.add_argument('--smoke', action='store_true', help='5 steps, to measure speed and memory')
    t.add_argument('--iters', type=int, help='steps (default: epochs × examples)')
    t.add_argument('--resume', help='an adapter folder to carry on from')
    s = sub.add_parser('stop'); s.add_argument('--name', default='tutor-lora')
    e = sub.add_parser('eval'); common(e)
    e.add_argument('--adapter'); e.add_argument('--base-url', default='http://localhost:8080/v1'); e.add_argument('--repeats', type=int, default=3)
    f = sub.add_parser('fuse'); common(f)
    f.add_argument('--adapter'); f.add_argument('--out', required=True); f.add_argument('--dequantize', action='store_true', help='write float weights instead of re-quantising to 4 bits')
    args = p.parse_args()
    sys.exit({'check': cmd_check, 'train': cmd_train, 'stop': cmd_stop, 'eval': cmd_eval, 'fuse': cmd_fuse}[args.cmd](args))


if __name__ == '__main__':
    main()
