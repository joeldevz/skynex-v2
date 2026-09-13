# Visual Recap

A self-contained skill that turns a PR, branch, commit, or raw diff into a local
HTML file. No external services or accounts required.

## Usage

```text
/visual-recap                    # recap working tree diff
/visual-recap PR 42              # recap a GitHub PR
/visual-recap branch feature-x   # recap a branch
/visual-recap commit abc1234     # recap a commit
/visual-recap file diff.patch    # recap a patch file
```

The output is a single `visual-recap.html` file in the current directory (or a
path the user specifies).

## What's inside

- `SKILL.md` — the skill prompt.
- `references/wireframe.md` — HTML/CSS wireframe guidelines for UI recaps.

## License

MIT — originally derived from the BuilderIO `visual-recap` skill, rewritten here
to produce local HTML output.
