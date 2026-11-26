# SyllabusSOS++

A university-scoped learning and peer tutoring platform. Students find help from people at their own university, teachers review resources and see where a course is struggling, and everyone shares campus events in one place.

Each university has its own space. Courses, tutors, messages, friends, resources and posts never cross between universities.

## What is built

| Area | What works |
| --- | --- |
| Accounts | Register, sign in, sign out, change password, delete account. Students and teachers pick their door on the sign-in page and land in separate spaces (`/student`, `/teacher`) with their own menus and dashboards. Administrators use `/admin`. |
| Public pages | Home, How it works, Campuses, Credits, Sign in, Terms and Privacy are each their own page, with canonical tags, a sitemap and robots.txt. |
| Universities | Public campus pages, new universities proposed at sign-up and approved by an administrator. |
| Syllabus | Courses, units, topics and learning objectives. Teachers assigned to a course edit its syllabus. |
| Resource library | Submit notes, worked examples, practice questions and links. Labels: official teacher resource, teacher verified, community contribution, pending review. Approve, reject with a reason, version history, bookmarks, reporting. |
| Difficulty radar | Students mark topics (understood, need practice, need help, not studied). Assigned teachers see combined counts. Topics with fewer than 5 responses are hidden (configurable). |
| Practice checks | Multiple choice with a server-side answer key, concept-by-concept feedback, saved attempts, and a comparison only when the same questions were used. |
| Learning missions | A rule-based planner builds a step list from your latest practice check and the approved resources. You accept or edit it before it is saved. |
| Peer tutoring | Type the course name to find a tutor or to offer a course (a new course is added for you). Offer a course opens its own page. Listings per course, search and filters, session requests, accept or decline, Jitsi link made on the site (or paste a Zoom, Meet or Teams link), in person or by message. |
| Credits | Held when you request, paid after you confirm, auto-released 72 hours after the end if nobody objects, refunds, disputes decided by an administrator, withdrawal requests. Append-only ledger that always sums to zero. |
| Community | Private messages, friends, campus feed (events with a place, hackathons, discussions, opportunities, teacher announcements), posted by students or teachers from their own Post an event page, comments, reports. |
| Senior handover | Seniors write study advice for a course. Teachers approve before others see it. Authors can stay anonymous. |
| Administration | Universities, users, teacher verification and course assignment, disputes, withdrawals, reports, audit log. |

## Run it

Needs Node.js 22.13 or newer. There is nothing to install: the project has no third-party packages.

```bash
cp .env.example .env
# put a random value in APP_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# set PAYMENTS_MODE=test and DEMO_MODE=true for the demo, and ADMIN_EMAIL / ADMIN_PASSWORD for the first administrator
npm run seed      # creates sample campuses (fictional) and the administrator
npm start         # http://localhost:3000
```

Remove `ADMIN_PASSWORD` from `.env` after the first run.

To reset the demo: stop the server, delete the `data/` folder, run `npm run seed` again.

## Environment variables

See `.env.example`. Notable ones: `APP_SECRET` (required in production, 32+ characters), `PUBLIC_URL`, `CORS_ORIGINS` (exact origins only, no wildcard), `TRUST_PROXY`, `PAYMENTS_MODE` (`off` or `test`), `PLATFORM_FEE_PERCENT`, `RADAR_MIN_RESPONSES`. The server refuses to start in production with a missing or weak setting.

## Demo journey (about 3 minutes)

The seeded campus is **Meridian Institute of Technology** (fictional). Sample people have no usable passwords, so create your own accounts.

1. Open the home page and try the tutor search on sample campuses.
2. Choose Student on the sign-in page and create an account at Meridian. Open **Syllabus**, choose CS301, open **NFA to DFA conversion**.
3. See resources with different review labels. Mark the topic "I need help".
4. Take the **practice check**, submit, read the concept-by-concept result.
5. **Plan a learning mission** from the results. Untick a step, accept the plan.
6. Open **Find a tutor**, pick a CS301 tutor, request a session (add test credits in **Wallet** first).
7. Create a second account as a **teacher** at Meridian. Sign in as the administrator at `/admin`, verify the teacher under **Users**, assign them to CS301 under **Teacher access**.
8. As the teacher: **Review queue** to approve a pending resource, **Difficulty radar** for CS301 (the seeded data shows the threshold working).
9. As the student, try to open another student's booking or the admin page. The server refuses.

## Tests and checks

```bash
npm test            # 33 end-to-end tests against a throwaway database
npm run audit       # static security audit
npm run scan-secrets  # working files and git history
npm run check-env   # validates configuration
```

The tests cover sign-up and sign-in, lockout, role escalation, university isolation, private data exposure, CSRF and CORS, host checks, exposed files, input cleaning, unsafe links, the credits ledger, bookings, disputes, resource review, teacher scoping, radar privacy, quiz grading, missions and handover review.

## Security summary

- Passwords: scrypt with a random salt, constant-time comparison, common-password check, account lockout, identical errors for unknown and known accounts.
- Sessions: random 256-bit token in an HttpOnly, SameSite=Strict cookie (`__Host-` prefixed and Secure in production). Only an HMAC of the token is stored.
- Access control is checked on the server for every route. Admin pages return 404 to non-admins.
- Input: every field is validated against a schema, unknown fields are rejected, markup is stripped, all SQL uses bound parameters, all pages render with DOM text nodes (no `innerHTML`).
- Browser protection: Content Security Policy that allows only scripts and styles from this site, no framing, no inline scripts, `nosniff`, no referrer.
- Cross-site requests: writes need a custom header and a trusted origin. CORS only answers for listed origins.
- Rate limits on every route, tighter on sign-in, registration, messages and posting.
- Secrets: read from the environment, validated at startup, `.env` and `data/` are git-ignored, files are mode 600 and 700.
- Database: private file outside the public folder, foreign keys on, append-only credits ledger enforced by triggers.
- Dependencies: none, so there is nothing to update and no supply chain exposure.

## Known limitations

- **No AI model is used.** Missions and recommendations are rule-based and say so on screen. There is no provider adapter yet.
- **Credits are for demonstration.** No payment provider is connected and nothing moves real money. Withdrawals are only recorded. Indian payment, tax and consumer rules need review before real money is involved.
- **No file uploads.** Resources are text and https links. A private file store with malware scanning is needed first.
- **No live video built in.** Sessions use a Jitsi, Zoom, Meet or Teams link.
- **Same university only.** Matching across colleges and universities is not built, by design of the original idea.
- **Tutors are matched by course,** not by individual topic.
- **No email verification or password reset** (needs an email service). Verified status is set by an administrator.
- **The rate limiter is in memory,** so it resets on restart and is per process.
- **`npm audit` could not be run** in the build environment because the package registry was unreachable. It has no meaning here since there are no packages.
- **Fonts are system fonts** (Palatino and Gill Sans families, with fallbacks), so they look slightly different per device.
- The terms and privacy policy are pilot drafts and need legal review.
- Success metrics (resource search time, session completion, quiz change) are things to measure in a pilot. No improvement is claimed.

## Next steps

1. Connect a payment provider and a private file store.
2. Add email verification, password reset and an optional AI assistant behind a provider adapter.
3. Pilot with one university and three courses, then measure the metrics above.
