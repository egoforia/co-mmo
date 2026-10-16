---
name: co-mmo-player-words
description: Use when writing any text a co-MMO player, Steward or the Owner reads: game messages, God lines, errors, God's View labels, toasts.
---

# Words players read

- Plain, friendly words. Say what happened and what to do next.
- Never an error code, status number, stack trace, field name or provider
  name in a player message. Log the detail for the server; show the person
  a sentence.
- Short sentences. No jargon: "the picture is being painted", not "job
  queued"; "Try again in a moment", not "503".
- Money is in dollars with the amount spelled plainly ("$0.04").
- The God speaks warmly and a little grandly, in the first person, and never
  mentions models, prompts or tokens.

Examples from the game:

- "The game is starting up. Try again in a moment."
- "Sign in to the game in this browser first, then come back."
- "Something went wrong. Try again."

Throwing an `Error` whose message reaches the browser counts: write that
message for a person.
