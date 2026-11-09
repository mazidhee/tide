---
title: The Library
group: Everyday
summary: Your reading list: books, papers, articles and videos, each a file in your vault's Library folder.
new: The Library as a bookcase
new-text: Your books, videos and articles on shelves by subject, with their real covers. Hover to pull one out.
new-image: shelves
---
```walkthrough
Three ways to see it
library | 89,27,6,5 | Switch layouts | **Switch layouts.** The three buttons beside Filter: **Covers**, a plain **List**, and **Shelves**. | library
library | 21,36,73,62 | Covers | **Covers.** PDFs show their first page, articles their preview image, videos their thumbnail and length. | library
shelves | 51,20,38,66 | Shelves | **Shelves.** A bookcase, one shelf per subject, each with how much of it you've read. Hover a book to pull it out. | library
shelves | 62,42,8,15 | Pull one out | **The card.** Click a book for its card: set it to unread, reading or read, and **Open**, **Teach me** or **Quiz me**. Arrow keys move along the shelf. | library
```

## Saving things

- **Links:** paste a link on Home, in the Library, or with <kbd>⌘⇧S</kbd>. Articles become clean Markdown with maths kept as LaTeX. Pages that aren't articles are saved as bookmarks.
- **YouTube:** saved with the title, channel, description and full transcript, each paragraph linked back to its time in the video.
- **Files:** **Add files** (<kbd>⌘⇧O</kbd>), or drag PDFs, Word documents, Markdown and images into the window.

## The bookcase

**Shelves** lays your Library out as a real bookcase.

```animation
shelf
```

- The left column is the **antilibrary**: how many of your things are still unread, then each subject's items with a dot for unread, half for reading and full for read.
- Books show their real covers and spines, with colours taken from the cover. Videos stand as their YouTube thumbnail; articles as a small framed page.
- The rail on the right jumps between subjects, and you can zoom in and out.
- Search and the subject filters at the top work on the shelves too.

The bookcase is just a view. Covers and a plain list are still there, and Tide remembers which you used last.

## Subjects

File anything under one or more subjects: hover a cover and click the tag button, or right-click it. Notebooks are offered first, so a statistics book can go under Mathematics and Finance at once. Anything filed under a project's name counts as one of its documents.

## Covers offline

Covers are fetched once and kept in `.tide/thumbs`, so they show offline. If a site has no preview picture, Tide remembers and doesn't ask again.
