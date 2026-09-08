# Fluva

## Git workflow

- After finishing each completed task or feature, automatically create a git commit and push it to GitHub (`origin main`) — no need to ask for confirmation each time.
- One commit per completed task/feature, not one per file edit. Write commit messages in Portuguese, matching the existing history's style (short, plain, e.g. "adicionado um botão para mover o texto ao editar").
- Never include incidental/unrelated changes in these commits (stray temp/debug files, unrelated deletions the user didn't ask for). If something unrelated shows up in `git status`, leave it out and mention it instead of silently committing it.
- This repo currently has no `.gitignore` — `node_modules/` and `dist/` are tracked intentionally (existing convention). Don't "fix" this unprompted.
