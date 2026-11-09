---
title: The cloud helper
group: Everyday
summary: Gemma on your Mac is always the tutor. A cloud model can help with four jobs where a bigger model makes a real difference.
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

## When it's busy

Save keys for more than one provider and they back each other up. If the model you chose is rate limited, down or refuses the key, the next provider you have a key for answers, then Gemma on this Mac. A provider that refused is left alone for a minute or so (as long as it asks) before it's tried again. **Settings → Models → When it's busy** shows the order.

## Usage

**Settings → Usage** shows each month: cloud spend against your budget, requests and tokens, what ran on your Mac, and a breakdown by model and job. Requests on your Mac are always free. A model with no price set is left out of the total and flagged, never guessed.
