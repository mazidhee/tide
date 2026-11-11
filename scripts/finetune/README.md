# Fine-tuning the tutor (prepared, not run)

A pipeline for training a LoRA adapter on the local tutor (Gemma 4 12B, 4-bit, served by mlx-vlm): a data builder, a training script, an evaluation step that runs the tutor benchmark on base and adapter, and a fuse step. **Nothing here has been executed beyond the builder's count of today's data, the script's read-only `check` and its `--print`. No training has run, no adapter exists, and the benchmark it would be judged by has no baseline yet.**

**Recommendation: do not fine-tune now.** There are 9 usable tutor turns from 1 lesson today (3 that fit the training window); a LoRA needs hundreds to help. Get the benchmark baseline first, fix what it shows with prompts, and come back only if the go rule below is met.

```bash
python3 scripts/finetune/tune.py check            # read-only: packages, data, memory, whether the server is up
npx vite-node scripts/finetune/build.ts -- --vault "<notes folder>" --count-only   # what exists, nothing written
npx vite-node scripts/finetune/build.ts -- --vault "<notes folder>" --gold gold.jsonl --names "First,Last"
python3 scripts/finetune/tune.py train --print    # the exact command
python3 scripts/finetune/tune.py train --smoke    # 5 steps: measures seconds per step and peak memory
python3 scripts/finetune/tune.py train            # the real run
python3 scripts/finetune/tune.py stop             # stop after the next save
python3 scripts/finetune/tune.py eval             # benchmark base and adapter, print the comparison and GO / NO-GO
```

## What fine-tuning can and cannot do

It can move habits the model already has the ability for:

- **Protocol adherence**: ending with one question in an ask tag, a `<solution>` with every problem, a grade first, a flashcard after a miss. These are regularities of form, which is what a low-rank adapter learns best.
- **Voice**: plain, short, no greeting or praise padding, British spelling.
- **Marking calibration**: how readily it says "correct". An adapter can shift the threshold (fewer generous marks) if it is shown many not-right answers marked as such. It shifts the bias, not the ability to tell.

It cannot add what the model lacks:

- **Knowledge**: a few hundred examples teach no distributed systems. Facts it gets wrong, it will still get wrong, now in a more convincing format.
- **Reasoning depth**: finding a subtle error in a worked answer is a capability of the base model. Tide's answer to that is the checks around the model (SymPy on final answers, the cloud second look), and those stay.

## The data

`build.ts` turns saved lessons (`<vault>/.tide/lessons/*.json`, read only) into chat examples: for every tutor turn that may be learned from, the request as the app sends it (system prompt, the lesson's instructions at the head of the first message, the turns before) and that turn as the target. Prompts come from the app's code, as in the benchmark. Output goes to `scripts/finetune/data/` (git-ignored: these are the learner's own lessons): `train.jsonl`, `valid.jsonl`, `manifest.json`.

Filters (`filters.ts`, tested in `test/finetuneData.test.ts`):

| Filter | Rule |
|---|---|
| Private projects | A lesson scoped to a private project's folder, its documents, or anything filed under its name is left out whole, read from the vault's own records as `privatePath` does. Any project lesson is left out. If the privacy records can't be read, everything with a path is left out. |
| Metabase | A lesson that mentions Metabase (or the host given with `--metabase-host`) anywhere is left out whole. |
| Passed Tide's checks | A turn is left out if a second look overturned its mark, a claim in it was corrected, its problem was replaced as flawed, it repeats an earlier problem, sets a problem it never asks, or breaks the tag protocol (the benchmark's scorer reads it). |
| Learner corrections | A turn is left out if the learner's next message pushes back on it, or the tutor's next reply takes it back. Both are pattern matches: they will miss some and catch some innocents. |
| Personal details | Emails, home-folder paths, local addresses, phone numbers, keys, the Mac account name and any `--names` are replaced. The learner's profile and memory are never in the prompt. Read a sample before training: a pattern cannot know every personal detail. |
| Voice | The spoken `<say>` part of replies written with Talk on is removed, since the adapter is trained for the written protocol. |
| Benchmark | Anything matching a benchmark scenario is refused, so the test is never trained on. |
| Length | Examples over the window (`--max-tokens`, an estimate at 3.4 characters a token) are dropped, not cut: cutting would cut the reply. |
| Split | Held out by whole lesson (15% by a hash of the lesson id), so no lesson is on both sides. |

**Gold replies.** `--gold file.jsonl` (or a folder of them) adds examples written by a stronger model, in the benchmark's scenario form (`group`, `setup`, `history`, `reply`, `by`, `expect`, and `before` for what the first message was told about earlier lessons). Each must pass the scorer and must not match the benchmark. This is where real improvement would come from: the tutor's own passing turns mostly teach it to do what it already does.

**The gold set kept here** (`scripts/finetune/gold/`): 606 examples, 42 to 45 for each of 14 subjects, across 13 situations (openings with and without a note about earlier lessons or a question due for recall, after a correct or a wrong answer, "I don't know", Show me, a worked answer with one error, an unusual correct method, a tangent, Why mode, hands-on code and SQL, a closing summary). They are written in `gold/src/*.gold` (plain text, see `gold/lib.ts`) and compiled to `gold/*.jsonl`:

```bash
export GOLD_PYTHON=<a python with numpy> GOLD_LAB_DB=<a file copy of the lab's sample database>
npx vite-node scripts/finetune/gold/cli.ts -- check --write   # validate, verify, keep what passes
npx vite-node scripts/finetune/gold/cli.ts -- stats           # counts by subject and situation
npx vite-node scripts/finetune/build.ts -- --vault "<notes folder>" --gold scripts/finetune/gold
```

`check` keeps an example only if the benchmark's scorer passes it against the expectations of its situation, its mark carries a score that agrees with the verdict and quotes the learner, its prose is in the product's voice, the builder's scrub would not alter it, it is far from every benchmark scenario (`gold/heldout.ts`: wording, numbers, topic and question, thresholds set from what the scenarios share with each other), and everything it states runs: every `<check>`, every program and its shown output, every SQL query on the lab data, every mermaid diagram, and its own verify script. `test/goldSet.test.ts` holds the kept set to the same rules, without the interpreter. On 11 November 2026 the builder turned the 606 into 512 training and 94 held-out examples (368 and 74 topics; no topic on both sides).

### How many examples exist today

Counted on 11 November 2026 with `--count-only`: **1 lesson, 9 tutor turns, all 9 pass the filters; 3 fit the 8,192-token window** (the other 6 are longer, because that lesson opens with a book passage). Gold replies: 606 (above). Nothing can be held out from one lesson. All 9 were written with Talk on.

### How many a LoRA would need (estimates, not measurements)

- **Below about 300**: do not train. With 70 distinct situation-by-subject cells in the benchmark alone, this is fewer than 5 examples a cell, and a rank-8 adapter on 12B parameters will memorise them.
- **About 300 to 800**, mostly gold, spread across subjects and situations: the range where protocol and voice changes plausibly show on the benchmark.
- **About 1,000 to 2,000**, with verdicts balanced (at least a third partial or wrong, each truth verified): what marking calibration would plausibly need, since the signal is one token among hundreds.
- More than about 3,000 is unlikely to add much at this rank.

These ranges come from general experience of LoRA on instruction-following models, not from anything measured on this model. At 10 to 20 tutor turns a lesson, real lessons alone reach 300 after 20 to 40 lessons, but they should be the minority of the set.

## Which base to train

**Train on the 4-bit model that is served** (`mlx-community/gemma-4-12B-it-4bit`), with the adapter in floating point on top.

The alternative, training on higher-precision weights and then quantising, gives cleaner gradients and lets a fused model be quantised once. It is not possible here: 12B weights at 16 bits are about 24 GB before any activations, on a 24 GB Mac, and they would have to be downloaded. Training on the 4-bit base also has a real advantage: the adapter learns against exactly the quantised weights it will serve with, so there is no mismatch to pay for afterwards. mlx-vlm's LoRA layers accept quantised linears directly (`trainer/peft/lora_layers.py`), established by reading the installed package.

## Settings, for 24 GB

`SETTINGS` in `tune.py`:

| Setting | Value | Why |
|---|---|---|
| Rank / alpha / dropout | 8 / 16 / 0.05 | Form and voice are low-rank changes; more rank on a few hundred examples memorises them. |
| Layers | `q_proj`, `v_proj` in all 48 layers (about 5M weights) | mlx-vlm's trainer adapts every layer and has no layer-count flag. With mlx-lm: the last 16 layers. |
| Batch | 1, gradients accumulated over 8 | One lesson prefix at a time is what the memory allows. |
| Sequence length | 8,192 | The fixed part of a lesson request is already about 5,000 tokens (system prompt about 3,400, instructions about 1,700). |
| Learning rate | 1e-4, constant | The usual LoRA range; mlx-vlm's trainer has no schedule. Halve it if validation loss rises within the first epoch. |
| Epochs | 2 | Validation loss every 100 steps decides whether to stop sooner. |
| Loss | On the reply only (`--train-on-completions`) | The prompt is fixed text; learning to reproduce it is wasted capacity. |
| Gradient checkpointing | On | Without it, activations for 48 layers at 8k tokens do not fit. |
| Saves | Every 25 steps | The most a stop or a crash can lose. |

**Expected memory (estimate):** about 6.5 GB of weights plus roughly 6 to 9 GB of checkpointed activations at 8k tokens: 13 to 16 GB at peak. The model server (another 6.5 GB plus its cache) cannot run beside it, and `train` refuses to start while it is up.

**Expected time (estimate):** the server reads prompts at about 260 tokens a second, so one forward pass over 8k tokens is about 30 seconds, and a checkpointed backward pass costs two to four times that: 1 to 2.5 minutes a step. 300 examples for 2 epochs is 600 steps: **10 to 25 hours**. 800 examples: 27 to 67 hours. `train --smoke` measures the real figure in 5 steps before any long run. Most of that cost is the 5,000-token prompt that every example repeats.

**The cost in use:** for all of those hours the tutor is unavailable, and so is everything else that uses the local model.

**Stopping safely.** The trainer has no stop signal and does not save on Ctrl-C. `tune.py stop` leaves a marker; the running `train` interrupts the trainer just after its next save, so nothing is lost. Ctrl-C works too and loses at most 25 steps. Resume with `train --resume <run folder> --iters <steps left>`; the optimiser's state is not restored.

## The trainer: mlx-lm is not installed

Checked read-only in `~/mlx-env312`: **mlx-lm is not installed** (nor in `~/mlx-env`). Installed are mlx 0.32.4, mlx-vlm 0.7.12, transformers 5.22.1, datasets 5.1.0, PyYAML 6.0.3.

mlx-vlm 0.7.12 ships its own trainer (`python -m mlx_vlm.train`), so `tune.py` uses that by default: it needs nothing installed, it knows this model's type (`gemma4_unified`), and the server reads what it writes. `--trainer mlx-lm` produces the equivalent `mlx_lm.lora` command for after mlx-lm is installed. That path is unverified in three ways: its flags are written from mlx-lm's documentation rather than an installed copy, mlx-lm may not support `gemma4_unified`, and its adapter's weight names may not match what mlx-vlm's server loads.

## Evaluating

`tune.py eval` runs the tutor benchmark twice against the running server, once plain and once with the adapter (mlx-vlm takes `adapter_path` per request), then `compare.ts` prints both and the decision.

**Go / no-go.**

Before training at all, every one of these:
1. A benchmark baseline exists, with 3 repeats.
2. Prompt changes have been tried for the top failures and measured.
3. What still fails is protocol, pace or generous marking (form and bias), not exactness or missed errors (knowledge and reasoning).
4. At least 300 training examples and 30 held out, most of them gold.

After training, serve the adapter only if `compare.ts` says GO: pass rate, protocol or marking up by at least 5 points and more than twice the runs' spread; marking accuracy not down by more than 2 points; no more not-right answers marked correct; exactness not down by more than 3; no subject down by more than 10. Then use it for a week and run Tide's other evaluations (`scripts/eval/lessons.ts`, `claims.ts`) for regressions the benchmark doesn't cover.

## Serving, fusing and the draft model

Established by reading the installed mlx-vlm, not by running it:

- **Serve the adapter unfused**: `mlx_vlm.server --adapter-path <run folder>`, or per request. This is the advised way. Tide starts the server with a fixed command (`src/main/modelServer.ts`), which would need that flag added; not done here.
- **There is no fuse command in mlx-vlm.** `LoRALinear.fuse()` exists but nothing calls it. `tune.py fuse` is a small script that does, and it is untested. Fusing into a 4-bit base re-quantises each merged weight to 4 bits, which can round away a small low-rank change; `--dequantize` avoids that but writes those layers in floating point and a larger model. Benchmark a fused model against the unfused adapter before trusting it.
- **The MTP draft model** (`mlx-community/gemma-4-12B-it-qat-assistant-5bit`, 4 layers, about 308 MB) is a separate checkpoint that reads the target model's hidden state and shared keys and values. The speculative walk accepts a drafted token only when the target agrees, so a tuned target should still decide every token: the adapter should affect speed, not correctness. This is inferred from the code and untested.
- **The likely incompatibility is speed.** The drafter was trained against the untuned model's hidden states; an adapter changes them, so fewer drafts may be accepted and generation may slow. The drafter cannot be retrained to match: the trainer's `--mtp-model` is for Qwen 3.5 only (it raises for anything else) and Gemma is not among `split_mtp`'s model types. Unfused LoRA layers also miss the verifier's fast path for plain linears. Measure with `scripts/bench/gemma.py` before and after.
- The server checks only that the drafter's hidden size matches (3840 on both), and falls back to ordinary generation with a warning if not. Nothing refuses an adapter together with a drafter.
- An adapter changes the prompt cache's key, so cached prefixes are rebuilt once.

## Risks

- **Overfitting to a handful of lessons**: the tutor starts steering every topic toward the examples it saw. Held-out loss and the benchmark's by-subject numbers are the guard.
- **Confident wrongness**: better form on the same knowledge reads as more trustworthy. Exactness and "not-right marked correct" must not move the wrong way.
- **Learning its own mistakes**: the filters catch what Tide's checks caught. A wrong mark nobody noticed goes in as a correct example.
- **Prompt drift**: the adapter is trained on today's system prompt and instructions. Change them later and it is partly out of date: rerun the benchmark after any prompt change, and expect to retrain.
- **Privacy**: an adapter can reproduce its training text. The filters keep private projects and Metabase out and strip patterns of personal detail; they cannot recognise every personal remark in a lesson. Read the data before training, and treat the adapter as private as the lessons.
- **Speed**: a possible drop in draft acceptance, as above.

## Unverified

Everything that needs a model: the training command end to end (flags were read from the installed trainer's source, not run), memory and time (estimates), the adapter loading into the server, per-request `adapter_path` in the benchmark runner, the fuse script, and the effect on the draft model.
