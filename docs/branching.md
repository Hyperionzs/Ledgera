# Branching

Feature-branch workflow. One sprint = one branch.

## Conventions

| Branch             | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `master`           | integration; merges from feature branches only    |
| `feature/<module>` | active sprint, e.g. `feature/category-management` |

## Flow

```bash
# start a sprint
git checkout master
git pull
git checkout -b feature/<new-module>

# when tests + gates are green (see CLAUDE.md)
git add <changed files>
git commit -m "feat(<scope>): ..."
git push -u origin feature/<new-module>

# merge once reviewed + approved
git checkout master
git merge --ff-only feature/<new-module>
git push origin master
```

## Commit messages

Conventional Commits: `feat(scope):`, `fix(scope):`, `chore:`, `docs:`,
`refactor(scope):`. No "Co-Authored-By" trailer.

## Rules

- Never commit directly to `master`; always through a feature branch.
- Never push without an explicit user request.
- A sprint is not done until lint, typecheck, build, and the full e2e suite pass
  and `CHANGELOG.md` is updated.
