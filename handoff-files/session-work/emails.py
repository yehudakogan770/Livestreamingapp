import sys

out = sys.argv[1]
LOGO = "https://yehudakogan770.github.io/Livestreamingapp/img/lumora-mark-96.png"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>{title}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f5f7">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f5f7">
      <tr>
        <td align="center" style="padding: 32px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color: #ffffff; border: 1px solid #e3e5e8; border-radius: 8px">
            <tr>
              <td style="padding: 20px 32px; background-color: #15171b; border-radius: 8px 8px 0 0">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="vertical-align: middle"><img src="{logo}" width="32" height="32" alt="" style="display: block; border: 0" /></td>
                    <td style="vertical-align: middle; padding-left: 10px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 20px; font-weight: 600; color: #ffffff">Lumora</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #1d2025">
                <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 600; color: #15171b">{title}</h1>
{body}
              </td>
            </tr>
            <tr>
              <td style="padding: 20px 32px; border-top: 1px solid #e3e5e8; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #6b7079">
                {footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def p(text: str) -> str:
    return f'                <p style="margin: 0 0 16px">{text}</p>'


def button(label: str) -> str:
    return (
        '                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px">\n'
        "                  <tr>\n"
        '                    <td style="border-radius: 6px; background-color: #15171b">\n'
        '                      <a href="{{ .ConfirmationURL }}" style="display: inline-block; padding: 12px 22px; font-family: \'Segoe UI\', Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px">'
        f"{label}</a>\n"
        "                    </td>\n"
        "                  </tr>\n"
        "                </table>"
    )


LINK = p(
    'If the button does not work, copy this link into your browser:<br /><a href="{{ .ConfirmationURL }}" style="color: #1f6fb2; word-break: break-all">{{ .ConfirmationURL }}</a>'
)

NOT_YOU = "If you did not ask for this, you can ignore this email."

T = {
    "confirm-signup": (
        "Confirm your email",
        [p("Thanks for making a Lumora account. Confirm that this is your email address to finish."), button("Confirm my email"), LINK,
         p("After that, the Lumora team approves each new account before it can be used. You will be able to sign in once it is approved.")],
        "You got this email because someone made a Lumora account with {{ .Email }}. " + NOT_YOU,
    ),
    "invite": (
        "You are invited to Lumora",
        [p("The Lumora team has invited you to use Lumora. Accept the invitation to set up your account."), button("Accept the invitation"), LINK],
        "This invitation was sent to {{ .Email }}. If you were not expecting it, you can ignore this email.",
    ),
    "magic-link": (
        "Your sign-in link",
        [p("Use this button to sign in to Lumora. The link works once and expires soon."), button("Sign in to Lumora"), LINK,
         p('Or type this code: <strong style="font-size: 20px; letter-spacing: 0.1em">{{ .Token }}</strong>')],
        "Someone asked to sign in to Lumora as {{ .Email }}. " + NOT_YOU,
    ),
    "change-email": (
        "Confirm your new email",
        [p('You asked to change the email of your Lumora account from {{ .Email }} to <strong>{{ .NewEmail }}</strong>. Confirm the change to finish.'),
         button("Confirm the change"), LINK],
        "If you did not ask for this change, ignore this email and your account keeps its current address.",
    ),
    "reset-password": (
        "Reset your password",
        [p("You asked to reset the password of your Lumora account. Choose a new password with this button."), button("Choose a new password"), LINK,
         p("The link works once and expires soon.")],
        "Someone asked to reset the password for {{ .Email }}. " + NOT_YOU + " Your password stays the same.",
    ),
    "reauthentication": (
        "Your confirmation code",
        [p("Type this code in Lumora to confirm it is you:"),
         p('<strong style="font-size: 24px; letter-spacing: 0.15em">{{ .Token }}</strong>'),
         p("The code expires soon.")],
        "Someone asked for a confirmation code for {{ .Email }}. " + NOT_YOU,
    ),
}

for name, (title, parts, footer) in T.items():
    with open(f"{out}/{name}.html", "w") as f:
        f.write(PAGE.replace("{title}", title).replace("{logo}", LOGO).replace("{body}", "\n".join(parts)).replace("{footer}", footer))
print("ok")
