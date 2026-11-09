---
title: Set up Tide
group: Get started
summary: Install the app, point it at your notes and connect your model. About five minutes.
---
1. **Install the app.** Open `Tide-0.1.0-arm64.dmg` and drag Tide to Applications. Tide isn't signed, so the first time, right-click it and choose **Open**.
2. **Choose your notes folder.** On first launch, pick your Obsidian vault. You can change it later in **Settings → General**.
3. **Start your model server.** In Terminal, run the command below. Leave the window open while you use Tide.
4. **Connect it.** In **Settings → Models**, choose the **MLX** preset (`http://localhost:8080/v1`) and press **Test connection**. Leave **Model** empty to use whatever the server has loaded.
5. **Set up the voice (optional).** In **Settings → Tutor and voice**, set up the natural voice. It installs about 1 GB once and runs on your Mac.

## Starting the model server

```bash
~/mlx-env312/bin/mlx_vlm.server --model mlx-community/gemma-4-12B-it-4bit --port 8080 --draft-block-size 3
```

If you stop the server, run the same command to start it again. Tide notices and turns its speed-ups back on by itself: a prompt cache, so follow-up replies start in about a second, and Gemma's small draft model, which roughly doubles how fast answers are written. **Settings → Model speed-ups** shows whether both are on.

> [!info] How fast it is
> On an M4 Pro with 24 GB, Gemma reads about 220 tokens a second and writes about 43 a second with the draft model. Animations in Tide pause while the model is busy so they don't slow it down.

## Other model servers

| Preset | Address | Key |
| --- | --- | --- |
| MLX | `http://localhost:8080/v1` | No |
| Ollama | `http://localhost:11434/v1` | No |
| LM Studio | `http://localhost:1234/v1` | No |

Any server that speaks the OpenAI API works: type its address under **Settings → Models → Advanced**. The tutor's tools (note search, web search, running code) need a model that supports tool calling.

## Web search

The tutor searches Wikipedia with no setup. For the whole web, choose **Private search on this Mac** in Settings and click **Set up**: Tide runs a private search engine (SearXNG) in Docker Desktop that only your Mac can reach. The first setup downloads about 200 MB. Brave Search, Tavily or your own SearXNG address work too.

## Things 4

With Things 4 open and **Settings › API** turned on in Things, Tide connects to it by itself:

- The learning tasks Tide puts on Today appear on Home, alongside your plan. Your own tasks stay in Things.
- Plans become Things projects, a heading per phase and a to-do per chapter.
- Ticking something in either app ticks it in the other.
- The tutor can add tasks for you (it asks before adding more than two). Everything Tide adds is tagged **tide**.
