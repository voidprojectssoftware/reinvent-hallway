# LinkedIn: what an app can get (researched 2026-11-13)

- **Sign In with LinkedIn using OpenID Connect** is self-serve: scopes `openid
  profile email`, userinfo returns `sub`, `name`, `given_name`, `family_name`,
  `picture`, `email`, `email_verified`, `locale`. It does **not** return the
  public profile URL (vanity name). Docs:
  https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
- **Connections API** (`r_1st_connections`) exists but is restricted to approved
  partners; partner programs are closed to new apps.
  https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/connections-api
- **The member's own data export** ("Get a copy of your data" > Connections)
  yields `Connections.csv` with First Name, Last Name, URL, Email Address (often
  blank, only when the connection allows it), Company, Position, Connected On.
  The file starts with a few lines of notes before the header row.
- **Sharing**: a post with a link renders the page's Open Graph tags
  (`og:title`, `og:image` 1200x627 recommended), so the share page must serve
  them from the server, not from client script.

Consequence: Hallway runs its own connection graph and uses LinkedIn for
verified identity and for seeding suggestions from the export (ADR 0004).
