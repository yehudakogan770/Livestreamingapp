# Lumora's sign-in emails

The emails Supabase sends (confirm sign-up, reset password and the rest), with Lumora's logo. The logo comes from the website:
`https://yehudakogan770.github.io/Livestreamingapp/img/lumora-mark-96.png` (a PNG, since many email programs don't show SVG). It shows once the website with that file is published.

## Putting them in

1. Open the project in Supabase → **Authentication** → **Emails** → **Templates**.
2. For each email below: open its tab, paste the **Subject**, open the file, copy everything in it into **Message body** (the "Source" view), then **Save changes**.

| Supabase tab         | Subject                    | File                    |
| -------------------- | -------------------------- | ----------------------- |
| Confirm sign up      | Confirm your Lumora email  | `confirm-signup.html`   |
| Invite user          | You are invited to Lumora  | `invite.html`           |
| Magic link           | Your Lumora sign-in link   | `magic-link.html`       |
| Change email address | Confirm your new email     | `change-email.html`     |
| Reset password       | Reset your Lumora password | `reset-password.html`   |
| Reauthentication     | Your Lumora code           | `reauthentication.html` |

Keep the parts in double braces (like `{{ .ConfirmationURL }}`) as they are: Supabase fills them in.

To try one: Supabase → Authentication → Users → **Send password recovery** to your own address.
