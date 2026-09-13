---
name: visual-recap
description: >-
  Turn a PR, branch, commit, or git diff into a self-contained HTML recap with
  file maps, key diffs, API/schema summaries, and review notes.
metadata:
  visibility: exported
---

# Visual Recap

`/visual-recap` creates a single, self-contained HTML file that summarizes a
change. Feed it a PR, branch, commit, or raw diff; the output is a local
`visual-recap.html` (or a user-chosen path) that a reviewer can open in any
browser.

The HTML file is fully standalone. It carries its own CSS and, when useful, a
small amount of inline SVG or Mermaid via CDN. No server, no SaaS account, no
MCP connector, and no database are required.

## When To Use

Use `/visual-recap` when a change is large, multi-file, or touches schema, API
contracts, architecture, or UI, and a reviewer would benefit from seeing the
shape of the change before reading every line. Skip it for tiny single-file
diffs — plain diff review is faster.

Typical invocations:

- `/visual-recap` — recap the current working tree diff.
- `/visual-recap PR 42` — recap a GitHub PR (requires `gh` CLI).
- `/visual-recap branch feature-x` — recap the diff between `feature-x` and the
default branch.
- `/visual-recap commit abc1234` — recap a single commit.
- `/visual-recap file /path/to/diff.patch` — recap a pre-existing patch file.

## Deliverable

The deliverable is ALWAYS a local HTML file. Do not return the recap as inline
chat prose, markdown, or ASCII art. Generate the file, write it to disk, and
report the absolute path.

Default output path: `visual-recap.html` in the current working directory. Honor
a user-specified path if they give one.

## How To Build The Recap

### 1. Gather the diff

Choose one source depending on the user's request:

- **Working tree** (default): `git diff --stat` + `git diff`.
- **Branch vs default branch**: `git diff $(git merge-base HEAD origin/main)..<branch>`.
- **Single commit**: `git show --stat --patch <commit>`.
- **GitHub PR**: `gh pr view <n> --json title,body,author,createdAt,number,url` and
`gh pr diff <n>`.
- **Patch file**: read the file directly.

For private repos, `gh` must be authenticated in the current environment. If it
is not, tell the user and fall back to local git data only.

Strip secrets from the diff before including anything in the HTML (API keys,
tokens, `.env` values, signing secrets). Redact them as `•••` or `<redacted>`.

### 2. Analyze the change

Identify the work unit:

- What is the objective? (one sentence)
- What files changed and how? (added / removed / modified / renamed)
- Are there schema/migration changes?
- Are there API/route/contract changes?
- Are there UI/layout/UX changes?
- Are there architecture/data-flow changes?
- Are there risky, breaking, or backwards-compatibility concerns?

Only include facts visible in the diff. If you infer something, label it as
inferred in the prose.

### 3. Build the HTML document

The HTML file must be a single self-contained document.

Required structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visual Recap — {title}</title>
  <style>
    /* Light, readable, responsive CSS. */
  </style>
</head>
<body>
  <header>
    <h1>{title}</h1>
    <p class="meta">{commit / PR / branch reference} · {author/date if known} · {N files changed}</p>
  </header>

  <main>
    <section id="summary">
      <h2>Summary</h2>
      <p>{1-3 paragraphs of what changed and why}</p>
    </section>

    <section id="file-tree">
      <h2>Files changed</h2>
      <ul class="file-tree">
        <li class="added">path/to/new/file (added)</li>
        <li class="removed">path/to/deleted/file (removed)</li>
        <li class="modified">path/to/changed/file (modified, +45/-12)</li>
      </ul>
    </section>

    <!-- Include only when the diff actually contains them: -->
    <section id="schema">
      <h2>Schema / API changes</h2>
      ...
    </section>

    <section id="ui">
      <h2>UI changes</h2>
      ...
    </section>

    <section id="key-changes">
      <h2>Key changes</h2>
      ...diff blocks...
    </section>

    <section id="notes">
      <h2>Review notes</h2>
      ...
    </section>
  </main>
</body>
</html>
```

CSS requirements:

- System font stack.
- Clean hierarchy: header, sections, clear headings.
- Color code file-tree entries: green for added, red for removed, blue/amber for
modified.
- Diff blocks: monospaced, side-by-side or unified, with syntax highlighting if
feasible (simple spans for keywords/strings/comments are enough).
- Responsive: max-width container, horizontal scrolling for wide diffs.

### 4. Content sections

**Summary (always).** 1-3 paragraphs: objective, scope, and any high-level risk.

**Files changed (always).** A tree/table with status and change stats. Keep paths
relative to the repo root.

**Schema / API changes (when present).** For schema/migration changes, show the
resulting fields/entities and what moved (added/modified/removed/renamed). For
API/route changes, show method, path, and a concise request/response example.

**UI changes (when present).** When the diff changes rendered UI, include simple
HTML wireframes. Read `references/wireframe.md` for the in-repo wireframe
guidelines. Keep wireframes plain HTML/CSS — no external design tools. Show the
entry point, the opened interaction surface, and the resulting state when
applicable.

**Key changes (always for non-trivial diffs).** Show the most important diffs.
Use 3-8 focused excerpts. Each excerpt must have:

- File path as heading.
- One-line summary of what the hunk changes and why.
- The actual diff (before/after). Keep each excerpt under ~150 lines; summarize
or truncate the rest.

**Review notes (when useful).** Flag risks, breaking changes, compatibility
concerns, or follow-up work visible in the diff.

## Quality Rules

- **Lean, not thin.** Include enough context to replace the need to read the raw
diff first, but do not dump every changed line.
- **Grounded in the diff.** Every file path, field name, method/path, and code
excerpt must come from the real diff. Do not invent changes.
- **No boilerplate.** Do not add generic intros like "This recap will help you
review..." or "Please review the diff carefully." The content should speak for
itself.
- **No secrets.** Redact credentials, tokens, and private URLs.
- **Self-contained.** The HTML file must render correctly when opened from
`file://` with no network, except optionally for Mermaid diagrams loaded from a
CDN with a local fallback message.
- **No SaaS promotion.** Do not reference BuilderIO, Agent-Native, Plan MCP, or
any paid service. The skill works with local git and standard CLI tools only.

## Mermaid Diagrams (optional)

For architecture or data-flow changes, you may include a Mermaid diagram using
the CDN loader:

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true });
</script>
```

If the user needs fully offline HTML, render the diagram as inline SVG instead
or omit it.

## Output And Handoff

After writing the file, report:

1. The absolute path to the HTML file.
2. The scope that was recapped (PR/branch/commit/diff).
3. How many files changed and the net +/- line count.
4. A one-line invitation to open the file in a browser.

If the user asks for edits, modify the same HTML file in place unless they ask
for a new path.
