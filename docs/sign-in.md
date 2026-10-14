# Sign-in setup

Invite links create every account and need no setup. These steps turn on
the other ways back in: email links, Google and GitHub. Each one is
optional and works on its own. Put the values in the server's environment
(the `.env` file you start the game with, or your host's settings), never in
the repository, then restart the game.

Every redirect address below starts with `PUBLIC_URL`, the address players
open the game at. On your laptop that is `http://localhost:5173`; on a host
it is your real address, such as `https://co-mmo.example.com`. If you play
from both, add both addresses where the provider allows several.

## Email sign-in links (Resend)

Without this, email links still work for testing: the server prints each
link in its console instead of sending it.

1. Create a free account at https://resend.com.
2. Under Domains, add a domain you own and add the DNS records it shows
   (needed to send to anyone but yourself). For a first test you can skip
   this and use `onboarding@resend.dev`, which only delivers to your own
   Resend email address.
3. Under API Keys, create a key with "Sending access".
4. Set:

   ```sh
   RESEND_API_KEY=re_...
   MAIL_FROM="co-MMO <play@your-domain.com>"
   ```

The free plan sends 100 emails a day, far more than sign-in needs.

## Sign in with Google

1. Open https://console.cloud.google.com, and create a project (for
   example "co-MMO").
2. APIs & Services > OAuth consent screen: choose External, fill in the app
   name and your email, and add the scopes `openid` and `.../auth/userinfo.email`.
   While the app is in Testing, add your friends' Google addresses as test
   users (or publish the app; the email scope needs no review).
3. APIs & Services > Credentials > Create credentials > OAuth client ID,
   type "Web application". Under Authorized redirect URIs add
   `PUBLIC_URL/api/auth/google/callback`, for example
   `http://localhost:5173/api/auth/google/callback`.
4. Set:

   ```sh
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

## Sign in with GitHub

1. Open https://github.com/settings/developers > OAuth Apps > New OAuth App.
2. Homepage URL: your `PUBLIC_URL`. Authorization callback URL:
   `PUBLIC_URL/api/auth/github/callback`, for example
   `http://localhost:5173/api/auth/github/callback`. GitHub allows one
   callback address per app, so make a second app if you play both locally
   and on a host.
3. Register it, then "Generate a new client secret".
4. Set:

   ```sh
   GITHUB_CLIENT_ID=Ov23li...
   GITHUB_CLIENT_SECRET=...
   ```

This is a sign-in app only. It is not the `GITHUB_ISSUES_TOKEN` used for
building wishes, and it cannot touch your repositories.

## How players use it

- A new player still joins with an invite link. The form asks, optionally,
  for an email; a confirm link is sent to it.
- In the game, Account (top right) adds or changes the email, links Google or
  GitHub, and signs this device out.
- The sign-in page offers "Send me a link" and, once set up, the Google and
  GitHub buttons. Signing in with Google or GitHub also works without linking
  first when the provider confirms the same email the player confirmed.
- Someone with no account who tries Google or GitHub is told to ask a friend
  for an invite; nobody can join without one.
