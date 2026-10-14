# Building Engine wishes: one-time setup

Approving an Engine wish in God's View opens a GitHub issue, and the "Build
a wish" workflow has Claude Code write the change and open a pull request.
Three things only the repository's owner can do make that work. Until they
are done, approved wishes wait as "Queued to be built", and God's View's AI
models tab says what is missing.

## 1. Install the Claude GitHub app

1. Open https://github.com/apps/claude and press **Install** (or
   **Configure** if it is installed already).
2. Choose your account, then **Only select repositories**, pick `co-mmo`,
   and save.

The workflows use the app to push the wish branch and open the pull
request, so CI runs on it like on any other pull request.

## 2. Give the workflows an AI key

1. Make an API key at https://console.anthropic.com (API keys, Create key).
2. On GitHub, open the repository's **Settings**, then **Secrets and
   variables**, **Actions**, **New repository secret**.
3. Name it `ANTHROPIC_API_KEY`, paste the key, and save.

(A Claude subscription works too: run `claude setup-token` and save the result as `CLAUDE_CODE_OAUTH_TOKEN` instead.)

Only the build workflows can read it; the game server never sees it, and
the coding agent is never given any other secret.

## 3. Give the game server an issue-only token

1. Open https://github.com/settings/personal-access-tokens/new (a
   fine-grained token).
2. Name it "co-MMO server", pick an expiry, and under **Repository access**
   choose **Only select repositories** and `co-mmo`.
3. Under **Permissions**, **Repository permissions**, set **Issues** to
   **Read and write**. Leave everything else as it is (Metadata stays
   read-only), and generate the token.
4. On the machine that runs the game, add one line to the `.env` file in the
   checkout:

   ```
   GITHUB_ISSUES_TOKEN=github_pat_...
   ```

5. Restart the game (`set -a; . ./.env; set +a; npm run dev`). God's View's
   AI models tab shows the coding agent as connected.

The server can only open, read and close issues with it: it cannot touch
code, branches or pull requests.

## Recommended: protect main

So that nothing but a reviewed merge reaches `main`, add a ruleset:
**Settings**, **Rules**, **Rulesets**, **New branch ruleset**; target the
default branch; turn on **Restrict deletions**, **Block force pushes** and
**Require a pull request before merging**; add **Repository admin** to the
bypass list so you can still push yourself.

## How a build goes

1. You approve an Engine wish in God's View, with an optional note.
2. The game opens an issue: "Wish: <title>". One wish builds at a time; the
   rest wait, as do builds over the daily cap or the monthly budget.
3. The workflow comments that it started, Claude Code writes the change on
   `wish/<issue>`, the checks run, and it comments with the pull request.
   The wish shows "Waiting for the Owner's review".
4. You read the pull request. Merge it, ask for changes by writing
   `@claude` and what to change in a comment, or close it with a comment
   saying why (the wisher is told, and the wish comes back to you).
5. After a merge the wish shows "Updating". Open God's View, Updates, and
   pull main and restart. The wish turns Live and the world is told.

If a build fails, the wish shows "Build failed" with the reason, and you can
try again (a fresh issue) or give up on it.
