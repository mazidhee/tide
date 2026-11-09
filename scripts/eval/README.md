# Lesson evaluation

How well the tutor marks hard material, measured instead of guessed. `marking.json` holds 40 problems in maths and software engineering with known answers, and student answers that are right (16), partly right (8) or subtly wrong (16). The script puts each to the tutor the way a lesson does and compares its verdict with the known one, three ways: as before, with the tutor's hidden solution, and with the second-look review on top.

```bash
npx vite-node scripts/eval/lessons.ts -- --limit 40 --problems 6
# a stronger reviewer, e.g. a cloud model:
npx vite-node scripts/eval/lessons.ts -- --review-base https://api.groq.com/openai/v1 --review-key $GROQ_API_KEY --review-model openai/gpt-oss-120b
```

The number that matters most is how many not-right answers were marked **correct**. Results are saved in `results/`.
