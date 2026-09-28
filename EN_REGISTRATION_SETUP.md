# English member registration and practice space

The English homepage is `/en/`. The direct application form is `/en/apply`, the private reviewer is `/en/admin`, and approved members enter at `/en/members`. The private device guide is `/en/install`. The Japanese homepage, videos, and playlist feeds are kept separate.

## New manual-review flow

Visitor opens the English form and submits name, email, country/region, time zone, and referral details → the application is stored in D1 as `pending` → if configured, a LINE Messaging API push notifies the administrator → the administrator reviews it in `/en/admin` → clicking approve creates a one-time access link and an English email draft → the administrator manually sends that email using their chosen mail app or Mac email agent → applicant opens the link once to start a 30-day browser session.

No email provider, paid email API, or email credential is needed by the website. The approval link is shown after approval, expires after seven days, and is stored as a hash. Copy the email draft at approval time. If it is lost or expires, the administrator can enter the approved member's email in the reissue form to prepare a fresh one-time link; this replaces any older unredeemed link.

## Cloudflare setup

1. In **Workers & Pages → aboji-exercise → Settings → Bindings**, confirm the D1 database binding named `REG_DB` exists. Keep existing bindings such as `VIDEO_BUCKET` unchanged.
2. Open that D1 database's **Console** and run the complete `en-schema.sql` file. The statements use `IF NOT EXISTS`, so this adds the practice-day table without replacing existing member records.
3. In **Workers & Pages → aboji-exercise → Settings → Variables and Secrets → Production**, add:

   | Name | Type | Required? | Purpose |
   | --- | --- | --- | --- |
   | `EN_ADMIN_SECRET` | Secret | Yes | At least 32 random characters; protects `/en/admin` APIs |
   | `EN_ZOOM_URL` | Secret | Optional | Morning 6 Zoom link shown only to signed-in members |
   | `LINE_CHANNEL_ACCESS_TOKEN` | Secret | Optional | Messaging API channel token used for admin push alerts |
   | `LINE_ADMIN_USER_ID` | Text | Optional | LINE user ID that should receive application alerts |

   Save, then deploy the project so the Worker receives the binding and variables.

4. To enable LINE notifications, the Messaging API channel must be able to push a message to the administrator's LINE user ID. This is separate from simply having admin access to a LINE Official Account. If the original account owner has not granted the necessary Developers/Messaging API access, leave the two LINE variables unset for now; applications will still be retained in D1 and visible in the private admin page. Do not put channel tokens in GitHub or paste them into this document.
5. Set `EN_ZOOM_URL` only if you are comfortable with every approved member seeing the meeting link. Zoom's own waiting room/passcode settings are still recommended.

## Administrator steps

1. Open `https://aboji-exercise.pages.dev/en/admin`.
2. Enter the secret `EN_ADMIN_SECRET` and load applications.
3. Review the applicant details and choose **Approve & prepare email** or **Reject**.
4. On approval, copy the email draft or open it in the configured mail app. The draft includes the one-time link. Send it yourself after checking the recipient address.
5. If LINE push is not configured, check this dashboard periodically; no automatic email alert is sent.

The included `mailto:` draft link can hand off to the default Mac/iPhone mail app, but a large body or a device without a configured mail account may make this inconvenient. A local Mac agent can send mail if it has been explicitly configured and authorized for a mail provider, but the current site cannot inspect or control that separate system. For this staged workflow, the dashboard creates a ready-to-send message without storing mail credentials. For later group announcements to 100–200 members, use a consent-based mailing list with unsubscribe handling and a provider configured by the account owner; do not use an unattended personal Mail.app window as a bulk sender.

## Member space and home-screen icon

- The member page shows the Morning 6 Zoom button if `EN_ZOOM_URL` is set, a link to the main site, a latest R2 video if it exists, and the existing three YouTube playlist series loaded dynamically from the API.
- The practice-day counter is an optional self-check-in. A member taps **I practiced today**; it counts one entry per Japan calendar day. It does not claim to detect actual attendance automatically.
- `/en/install` is private and explains how to add the member website shortcut to iPhone/iPad Safari, Android Chrome, and desktop Chrome/Edge. The web app icon is a home-screen shortcut to this site, not a native App Store application, and it does not bypass member sign-in.
- The service worker only caches the static icon and manifest. It never caches member pages, API data, Zoom URLs, or video responses.
- The current membership gate is a one-time emailed access link, followed by a 30-day secure browser cookie. It is appropriate for a small pilot but is not equivalent to verified LINE friendship, nor is a forwarded invitation impossible to misuse. Do not put publicly shareable or highly sensitive material in this member area.

## Form and data handling

The form requires the applicant's name, email, country/region, time zone, referral Yes/No, and either the referrer's name or the required answer to “How did you hear about us?”. It reminds applicants to check spam/promotions. A honeypot and minimum completion time provide basic anti-bot friction but are not a replacement for rate limiting. Before broad promotion, add a Cloudflare WAF rate-limit rule for `/api/en/apply` and agree on how long application records should be retained.

The application is stored in Cloudflare D1. The application includes a separate, unchecked opt-in for occasional practice emails; the admin reviewer shows whether the applicant opted in, and signed-in members can change that preference on their member page. Keep future announcements limited to people who opted in and provide an unsubscribe method. A D1 table is reserved for Web Push subscriptions, but browser opt-in and sending are not enabled by this change. To activate push later, add explicit subscribe/unsubscribe controls, VAPID keys stored as Cloudflare Secrets, and cleanup for expired subscriptions.

## Validation checklist after deployment

- Submit a test application and confirm it appears at `/en/admin`.
- If LINE variables are configured, confirm the administrator receives the push. Otherwise, verify the dashboard fallback.
- Approve a test record, use the email draft manually, and confirm the one-use link reaches `/en/members`; a second use should fail.
- Confirm a non-member cannot open `/en/members` or `/en/install` directly.
- Confirm each playlist still lists the current YouTube items and switches the one player per series.
- If an R2 latest video exists, test in-page playback, seek, and fullscreen; if absent, that section stays hidden.
- Try the device guide and add the home-screen shortcut. Member pages and APIs must remain network-only and private.
