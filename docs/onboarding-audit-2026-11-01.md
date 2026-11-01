# Onboarding audit: landing to a checked team

Date: 2026-11-01. Walked in the built app with the provider fake, at 1440x1000 and 390x844, in light and
dark. The screenshots referenced below are in `.artifacts/onboarding/`.

## Before

Five screens. Five fixed actions for an account that signs in with a Yahoo password, or six when the
Yahoo account uses a Gmail address, plus one switch per team.

| #   | Screen         | Person action                  | Must understand                                                                                                         | Likely stop                                                                     |
| --- | -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Landing        | Sign in to connect Yahoo       | It checks enabled teams hourly; the first sign-in creates the account                                                   | None                                                                            |
| 2   | Sign-in, email | Enter email, submit            | Google and email code are alternatives; a code arrives by email                                                         | Which sign-in method applies                                                    |
| 3   | Sign-in, code  | Enter code, submit             | The code expires after ten minutes                                                                                      | Email delivery                                                                  |
| 4   | Connections    | Connect Yahoo                  | A private browser opens; nothing is installed; the password is not kept; a hidden disclosure holds the Gmail workaround | Whether the Google disclosure applies                                           |
| 5   | Hosted browser | Sign in to Yahoo               | Type into the streamed page; the session expires; cancelling discards the profile                                       | A Gmail address is refused by Yahoo, and the workaround is on the screen above  |
| 6   | Teams          | Turn on lineup checks per team | Which teams are listed; what the switch does; that nothing runs until it is on; that checks run hourly                  | Nothing marks the connection as finished, so the switches look optional and off |
| 7   | Wait           | None                           | When the first check will run                                                                                           | No visible next run time                                                        |

Counts: 17 listed facts or decisions for a Gmail-identity account (16 otherwise), 6 fixed actions for a
Gmail-identity account (5 otherwise), plus one action per team. A person returning with a ready
connection still saw the full connect setup and the Gmail disclosure above their connection.

## After

Five screens, no new page. Five fixed actions, plus one switch per team. The Gmail workaround appears
only when Yahoo refuses the address, in the browser frame itself.

| #   | Screen         | Person action                  | Must understand                                                                                                              | Likely stop                                                  |
| --- | -------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Landing        | Sign in to connect Yahoo       | It checks enabled teams hourly; the first sign-in creates the account                                                        | None                                                         |
| 2   | Sign-in, email | Enter email, submit            | Google and email code are alternatives; a code arrives by email                                                              | Which sign-in method applies                                 |
| 3   | Sign-in, code  | Enter code, submit             | The code expires after ten minutes                                                                                           | Email delivery                                               |
| 4   | Connections    | Connect Yahoo                  | A private browser opens; the password is not kept; the session is encrypted                                                  | None                                                         |
| 5   | Hosted browser | Sign in to Yahoo               | Type into the page; the session expires; if Yahoo refuses a Gmail address, the phone-number guidance is in the browser frame | The account-change workaround itself, which happens at Yahoo |
| 6   | Teams          | Turn on lineup checks per team | Which teams are listed; that no team is checked yet; that the switch is the activation; checks run hourly                    | None, because the empty-check notice names the switch        |
| 7   | Wait           | None                           | Nothing more is required                                                                                                     | None                                                         |

Counts: 13 listed facts or decisions for a Gmail-identity account (12 otherwise), 5 fixed actions for
everyone, plus one action per team. A person returning with a ready connection sees the connection
state and no setup instructions. The Gmail workaround still requires an account change at Yahoo, and
the copy does not promise that Yahoo will offer phone sign-in.

## The stuck case, as it now reads

Inside the browser frame, immediately below its title bar:

> **Yahoo refuses Gmail addresses in this browser.**
>
> If the account has a phone number, sign in with that number instead. If it does not, add one in
> Yahoo's account settings. Yahoo decides which sign-in options it offers.

The bar sits in the frame rather than below it because a phone viewport shows only the frame at the
moment of refusal. It disappears when the provider's notice disappears.

## What changed

- The hosted browser detects Yahoo's Gmail refusal from the provider page's visible text and reports it
  as a browser status. The guidance is rendered in the browser frame's chrome, not on the previous page.
- The two static Gmail hints on the connections page are gone.
- The hosted browser reports `finishing` while the captured session is validated and teams are read.
- Link failure copy names what happened and what to try, and offers Try again. Provider refusals do not
  blame the person.
- The connections page shows a compact connected state instead of the setup when a ready connection is
  present.
- The teams list says when no team is being checked and names the Lineup checks switch. The notice
  disappears when a team is turned on.
- Typing into the browser is rejected until the first frame is visible, so early keystrokes are not sent
  into an unready page.

## Deliberately not built

No wizard, modal chain, tour, tooltip tour, progress bar, or new page. No automatic team enrollment, no
automatic start of the hosted browser, and no manual run-now control. No change to the linking
mechanism, cookie capture, encryption, or egress policy. No attempt to defeat Yahoo's address rule or
Google's browser refusal, and no claim that adding a phone number works for every account.
