# Wireframe Guide for HTML Recaps

Use this guide when the diff changes rendered UI. The wireframes are plain
HTML/CSS inside the generated `visual-recap.html` file. No design tools,
JavaScript frameworks, or external services are needed.

## Core idea

A wireframe in a recap shows the **visible UI delta**. It is not a polished
mockup; it is a fast, structural drawing that helps the reviewer understand what
changed before reading code.

Show only the surfaces the diff actually changes:

- Entry point (page, list row, toolbar, menu trigger).
- Opened interaction surface (popover, dialog, tab, sheet, dropdown).
- Resulting state or destination page.
- Empty/error/permission states when the diff adds them.

## HTML/CSS conventions

Use a single block element per wireframe:

```html
<figure class="wireframe">
  <figcaption>After — Invite members dialog</figcaption>
  <div class="wireframe-frame">
    <div class="wireframe-header">
      <span class="wireframe-title">Invite members</span>
      <button class="wireframe-close">×</button>
    </div>
    <div class="wireframe-body">
      <input class="wireframe-input" placeholder="Email address" />
      <select class="wireframe-select"><option>Member</option><option>Admin</option></select>
      <button class="wireframe-primary">Send invite</button>
    </div>
  </div>
</figure>
```

CSS rules:

- Use a `wireframe` class on the `<figure>`.
- Frames use a 1px dashed border (`#9ca3af`), light gray fill (`#f9fafb`), and
  rounded corners (`8px`).
- Title/header bars use a slightly darker fill (`#e5e7eb`).
- Buttons use rectangles with clear labels; primary actions use a filled style.
- Inputs/selects use simple boxes with placeholder text.
- Use CSS Grid or Flexbox for layout; never absolute positioning.
- Keep wireframes in grayscale. No brand colors, no custom fonts, no shadows.

## Before / After pairs

When a direct comparison helps, render two wireframes side by side:

```html
<div class="wireframe-pair">
  <figure class="wireframe">...Before...</figure>
  <figure class="wireframe">...After...</figure>
</div>
```

On narrow viewports, stack them vertically with a media query.

## State sequences

For flow-dependent changes, show 2-4 wireframes in a horizontal sequence with
arrows or numbers. Do not force everything into one before/after pair.

## Captions

Every wireframe must have a `<figcaption>` that says what it depicts and, if
needed, notes anything inferred (e.g. "Inferred spacing — not from exact pixel
measurements").

## What to avoid

- Do not write `<html>`, `<head>`, or `<body>` inside a wireframe — the snippets
  are injected into the recap HTML document.
- Do not use real product screenshots or external images.
- Do not invent UI elements that the diff does not mention.
- Do not hand-draw ASCII art; the wireframe should render as real markup.

## Quick template

```html
<figure class="wireframe">
  <figcaption>After — {surface name}</figcaption>
  <div class="wireframe-frame">
    <div class="wireframe-header">
      <span class="wireframe-title">{Title}</span>
      <!-- optional close/actions -->
    </div>
    <div class="wireframe-body">
      <!-- inputs, lists, buttons, rows -->
    </div>
  </div>
</figure>
```

Keep wireframes compact. A good recap wireframe is usually 200-400px tall.
