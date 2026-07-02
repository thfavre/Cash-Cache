# Workflow Rules

## Branch Strategy

```
main  ←  dev  ←  worktree/task-name
```

- `main` — stable, production-ready. Never commit directly.
- `dev` — integration branch. Merge worktrees here after user approval.
- Worktrees — one per task, always branched off `dev`.

## Step-by-Step Workflow

### 1. Start a task
- Create a worktree from `dev`:
  ```
  git worktree add ../worktree-<task-name> -b <task-name> dev
  ```
- Do all work inside that worktree.

### 2. Commit
- Commit atomically with a clear message describing *why*, not just what.
- Do not push or merge without user approval.
- Report back: what was done, what to test, any edge cases to watch.

### 3. User tests
- Wait for the user to test the worktree.
- If bugs are found: fix in the same worktree and commit again.

### 4. Merge into dev (after user says "OK" / "good" / "merge")
- Switch to `dev`, merge the worktree branch, resolve any conflicts.
- Delete the worktree and branch after a clean merge.
  ```
  git checkout dev
  git merge <task-name>
  git worktree remove ../worktree-<task-name>
  git branch -d <task-name>
  ```

### 5. Merge into main (only when user explicitly validates dev)
- User must say something like "merge to main" or "push to main".
- Fast-forward merge only; no squash.
  ```
  git checkout main
  git merge dev
  git checkout dev
  ```

## Rules

- Never commit directly to `dev` or `main`.
- Never merge to `main` without explicit user instruction.
- Never use `--no-verify` or force-push unless the user explicitly asks.
- Always read this file at the start of every session before doing any git work.
- If a conflict arises during merge to `dev`, resolve it and show the user the diff before finalizing.
