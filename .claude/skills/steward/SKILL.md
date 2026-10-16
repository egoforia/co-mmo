---
name: steward
description: Use when driving a co-MMO pull request to mergeable: before each push, on CI failures and on review comments.
---

# Driving a co-MMO pull request

- Before every push: `npm run typecheck` and `npm test` pass locally. Wish
  branches (`wish/<issue>`) also pass
  `node scripts/wish-guard.mjs --base origin/main`.
- Never change `.github/`, never push to `main`, never merge. The Owner
  (egoforia) cannot approve their own PRs on GitHub; a PR is merged only after
  they say "PR #N approved" in the project chat.
- No new dependencies unless the Owner's approval allows core changes.
- Never read or print `.env` or API keys, and never make paid AI calls from
  tests or CI.
- Merge `main` into the branch to resolve conflicts (no force-push on someone
  else's branch). Keep both sides' behaviour; when a conflict is in a file a
  refactor split up, apply the other side's change to the new file.
- Keep each fix to what the failure or comment needs.
- The PR description says, in plain words, what a player or the Owner sees
  change, then how to test it.
