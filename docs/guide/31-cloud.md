---
title: The cloud helper
group: Everyday
summary: When Gemma teaches, a cloud model can help with four jobs where a bigger model makes a real difference. With Claude set up, Claude teaches instead (see Claude as your tutor).
---
- **Hard maths:** checking each step of worked answers.
- **Finding mistakes:** “check my working”, find-the-error questions and code answers.
- **Marking exams:** typed answers against the mark scheme. Photos of handwriting stay with Gemma.
- **Curriculum planning:** sizing a plan, changing it, and writing outlines.

Set it up in **Settings → Models**: **Automatically** or **When I ask**, a provider and your key (kept in your Mac's Keychain). In Chat and lessons, the picker beside the box chooses **Auto**, **Gemma only** or the cloud model. When a turn goes to the cloud, the step above the reply says so.

> [!warning] What never goes to the cloud
> Private projects, your Metabase and turns with pictures always stay on Gemma, even with the cloud helper on.

If the cloud model can't take a request (rate limited, offline, key refused, over your monthly budget), Gemma answers instead and says why. On Groq's free tier, Tide reads how much is left after each request and goes straight to Gemma when the next one won't fit.

## Which provider

| Provider | Best model for maths and code | Cost (checked 9 Nov 2026) |
| --- | --- | --- |
| NVIDIA | DeepSeek V4.1 Flash, Kimi K2.6 | Free, about 40 requests a minute. Prompts may be logged |
| DeepSeek | DeepSeek Flash (V4.1) | About $0.15 in and $0.60 out per million tokens, half off-peak: a check costs a fraction of a cent |
| Groq | GPT-OSS 120B | Free: 1,000 requests a day, 8,000 tokens a minute |
| OpenRouter | Kimi K3.1 Pro for the hardest proofs; Nemotron 3 Ultra free | Free models: 50 requests a day. Kimi K3.1 Pro is paid |
| Google Gemini | Gemini 3.8 Flash | Free, but only about 20 requests a day |

For most people, NVIDIA's free tier is the best start, with Groq or DeepSeek behind it.

## Getting the most from NVIDIA's free tier

With NVIDIA as the provider, each job gets its own model, because each model has its own limit and spreading the work uses more of the free allowance:

| Job | Model |
| --- | --- |
| Hard maths and proofs | DeepSeek V4.1 Flash, the strongest free model NVIDIA's API serves |
| Finding mistakes and code | Kimi K2.6 |
| Marking and solving everyday problems | GLM 5.3 Flash (fast) |
| Planning | Nemotron 3 Super |

Kimi K3.1 Pro has a page on build.nvidia.com but NVIDIA's API doesn't serve it yet (it answers 404); when it does, it appears in the model menu and you can pick it for hard maths. A model a provider doesn't serve is skipped for half an hour and the next one answers.

Change any of them under **Settings → Models**. Tide paces itself at about 35 requests a minute rather than wait to be refused, and gives each job a time limit (longer for hard maths) after which the next model in line answers.

## The problem bank

Every half hour while Tide is open, the cloud model writes problems for what's coming (today's and your next study day's topics, and lessons in progress) at three levels, each solved and checked, and a different model reviews them. During the day this counts as routine work, so it stops once a model is 70% through its day and leaves the rest for your lessons. In the evening it spends what's left before the allowance resets: free allowances don't carry over. **Settings → Models → Problem bank** shows the last run, and **Prepare now** runs it at once. Private projects are never sent; their problems are written by Gemma.



Two open endpoints need no key and join the end of the line by themselves, after the providers you have keys for: **Kilo** (NVIDIA's Nemotron 3 Ultra, about 200 requests an hour, around 15 seconds an answer) and **OVHcloud** (GPT-OSS 120B and Qwen3.5 397B, about 2 requests a minute, slow). Kilo's free models may train on what they're sent, so they only ever get the short checks (a problem, its solution, your answer), never a tutoring turn with your notes in it.

## Free backups with no account

Two open endpoints need no key and join the end of the line by themselves, after the providers you have keys for: **Kilo** (NVIDIA's Nemotron 3 Ultra, about 200 requests an hour, around 15 seconds an answer) and **OVHcloud** (GPT-OSS 120B and Qwen3.5 397B, about 2 requests a minute, slow). Kilo's free models may train on what they're sent, so they only ever get the short checks (a problem, its solution, your answer), never a tutoring turn with your notes in it.

## The line learns

Tide keeps score for each model and job: whether it answers, how fast, and (for writing problems) how many pass the second model's review. A model that keeps failing a job, or whose problems keep failing review, moves to the back of the line on its own. The rules and output format sit at the start of every request, so providers that cache a repeated start reuse it.

## When it's busy

Models back each other up. If one is rate limited, down, too slow or refuses the key, the same provider's other models try, then every other provider you've saved a key for, then Gemma on this Mac. A provider that refused is left alone for a minute or so (as long as it asks) before it's tried again. **Settings → Models → When it's busy** shows the order.

## Usage

**Settings → Usage** shows each month: cloud spend against your budget, requests and tokens, what ran on your Mac, and a breakdown by model and job. Requests on your Mac are always free. A model with no price set is left out of the total and flagged, never guessed.
