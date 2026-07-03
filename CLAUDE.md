# Workflow Rules

## Branch Strategy

```
main  ←  dev
```

- `main` — stable, production-ready. Never commit directly.
- `dev` — where all work happens.

## Step-by-Step Workflow

### 1. Do the task
- Work directly on `dev`.
- Code exactly what the user asks.

### 2. Wait for feedback
- Do not commit until the user has tested the change and given feedback.
- If bugs are found: fix them and present again.

### 3. Commit (after user says "OK" / "good" / "commit")
- Commit atomically with a clear message describing *why*, not just what.
- Do not push or merge without user approval.

### 4. Merge into main (only when user explicitly validates dev)
- User must say something like "merge to main" or "push to main".
- Fast-forward merge only; no squash.
  ```
  git checkout main
  git merge dev
  git checkout dev
  ```

## Rules

- Never commit directly to `main`.
- Never commit to `dev` without the user first reviewing/testing the change.
- Never merge to `main` without explicit user instruction.
- Never use `--no-verify` or force-push unless the user explicitly asks.
- Always read this file at the start of every session before doing any git work.
