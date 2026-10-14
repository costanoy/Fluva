# Fluva

## Git workflow

- After finishing each completed task or feature, automatically create a git commit and push it to GitHub (`origin main`) — no need to ask for confirmation each time.
- One commit per completed task/feature, not one per file edit. Write commit messages in Portuguese, matching the existing history's style (short, plain, e.g. "adicionado um botão para mover o texto ao editar").
- Always commit every change in the project — everything `git status` shows, including files unrelated to the current task (videos, deleted files, build caches such as `tsconfig.tsbuildinfo` and `node_modules/.vite`). The user asked for this explicitly. Only exception: files holding credentials or secrets (passwords, private keys, certificates, `.env`) — ask before committing those.
- Since everything gets committed, keep temporary test/QA files out of the project folder (use the scratchpad).
- `node_modules/` and `dist/` are tracked intentionally (existing convention); `.gitignore` only excludes `portfolio-preview/`. Don't change this unprompted.
