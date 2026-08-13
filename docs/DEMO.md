# Live demo checklist

This walkthrough produces a short, honest recording of the CLI operating in a
real Discord test server. Keep the recording uncut so viewers can distinguish a
live run from a mock or slide presentation.

## Prepare before recording

1. Install the bot in a test server and enable **Message Content Intent**.
2. Put the bot role above a harmless test role such as `Demo Participant`.
3. Create one native poll message, vote in it, and add an ordinary emoji reaction
   to that same message. A super reaction is optional.
4. Put the server, channel, poll-message, and test-role IDs in `.env`.
5. Confirm that `.env` is ignored with `git status --ignored --short .env`.
6. Run `npm run verify` and then `npm start -- --dry-run` privately once.

Never open `.env`, the Developer Portal token page, a wallet, or a password
manager while recording. Reset the bot token immediately if it appears on screen.

## Record one continuous 60–90 second take

1. Show the poll message, its reaction, and that the test member lacks the role.
2. Show `npm run verify` completing successfully in the terminal.
3. Run the default preview:

   ```bash
   npm start
   ```

   Point out that the same member was discovered from both a reaction and a poll
   answer but appears only once in the total.

4. Apply ADD and refresh the member in Discord:

   ```bash
   npm start -- --apply
   ```

5. Repeat the same command to show the safe `already has the role` skip.
6. Apply REMOVE, then refresh Discord to show the role is gone:

   ```bash
   npm start -- --action REMOVE --apply
   ```

7. Repeat REMOVE to show the safe `does not have the role` skip.
8. End on the terminal summary with no failed updates.

## Before publishing

- Watch the full recording and verify that no secret or personal notification is
  visible.
- Keep the repository's AI-assistance disclosure in the README and mention the
  same assistance in the bounty submission.
- Link both the public repository and the actual live-demo video.
