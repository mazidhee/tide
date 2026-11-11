# Lesson evaluation

How well the tutor marks hard material, measured instead of guessed. `marking.json` holds 40 problems in maths and software engineering with known answers, and student answers that are right (16), partly right (8) or subtly wrong (16). The script puts each to the tutor the way a lesson does and compares its verdict with the known one, three ways: as before, with the tutor's hidden solution, and with the second-look review on top.

```bash
npx vite-node scripts/eval/lessons.ts -- --limit 40 --problems 6
# a stronger reviewer, e.g. a cloud model:
npx vite-node scripts/eval/lessons.ts -- --review-base https://api.groq.com/openai/v1 --review-key $GROQ_API_KEY --review-model openai/gpt-oss-120b
```

The number that matters most is how many not-right answers were marked **correct**. Results are saved in `results/`.

# Retrieval evaluation

Whether search finds the page that answers a question. `retrieval.json` holds 94 questions written by hand from 14 of the library's books, each with its page and a quote from it: 47 that use the page's own terms ("keyword") and 47 that describe the idea without them ("paraphrase"). A question is answered when a passage from its page, or the page either side, is among the results.

It runs the module's own index code (`native/tide-core/src/index.rs`) over the books' extracted text, with no Electron or Node, and can put a static embedding model (model2vec `potion`, MIT) beside the words:

```bash
cd native/tide-core
mkdir -p models/potion-base-8M   # git-ignored; model.safetensors and tokenizer.json from huggingface.co/minishlab/potion-base-8M
cargo run --release --example retrieval -- --questions ../../scripts/eval/retrieval.json \
  --pages "<vault>/.tide/pdftext" --index /tmp/tide-retrieval [--model models/potion-base-8M] [--exact] [--dump out.json]
```

Measured on 11,840 passages (results in `results/retrieval-*.json`): by words alone, keyword questions 47/47 in the first 8, paraphrase 19/47. The best fusion with vectors (potion-base-32M, reciprocal rank fusion) reached 23/47 on paraphrase, gaining 6 and losing 2: not distinguishable from chance (sign test p = 0.29), and which setting came out best changed from model to model. So the app's module is built without a model (`src/embed.rs` stands where one would go).
