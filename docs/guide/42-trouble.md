---
title: Troubleshooting
group: Reference
summary: The usual problems and what fixes them.
---
| Problem | What to do |
| --- | --- |
| “Can't reach the AI server” | Start the model server (see [Set up Tide](02-setup.md)), then **Test connection** in Settings → Models. |
| Answers are slow | Check **Settings → Model speed-ups** shows both on. A first answer in a new conversation reads everything once; follow-ups start in about a second. |
| The tutor ignores its tools | Your model may not support tool calling. Turn tools off in Settings → Tools. |
| The voice doesn't speak | Settings → Tutor and voice: set up the natural voice, or turn on **Use the Mac's own voice**. |
| Speak doesn't record | With Dictation on Handy, Speak only places the cursor: press your Handy shortcut. |
| A book has no chapters | It's probably scanned. Use **Chapter starts on page N**. |
| Tide's tasks don't show on Home | Open Things and turn on **Settings › API** there. Only tasks tagged **tide** show on Home; your own Today tasks stay in Things. |
| A YouTube video saved without a transcript | The video has no captions YouTube will share. The title and description are still saved. |
| A note changed in Obsidian doesn't show | Switch away and back. Tide won't overwrite a note while you have unsaved typing. |
| Your notes folder was moved or renamed | Tide notices within seconds, stops saving (so it never starts an empty folder in its place), looks for the folder by its hidden `.tide` folder and follows it, telling you where. If it can't tell which folder it is, it asks: press **Find it…** and choose it. |
| macOS won't open Tide | Right-click Tide in Applications and choose **Open**, once. |

Gemma 4 on MLX has one known quirk: on long notes it can get stuck producing empty hidden “thinking”. Tide prevents it by blocking that token for Gemma on local servers, and stops and retries any answer that starts repeating itself.
