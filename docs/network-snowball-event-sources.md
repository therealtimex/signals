# Network Snowball event sources

Network Snowball accepts public Luma event URLs as first-class seed sources. Signals removes the
entire query string and fragment before storage, navigation, fetches, logs, errors, or agent
dispatch. For example, `https://luma.com/demo?tk=...` becomes `https://luma.com/demo`.

Before the terminal agent starts, Signals imports public event facts into a deterministic
`content_items` record. The versioned `platformData.eventSource` payload keeps event facts,
explicit organizer/host/sponsor/venue/calendar roles, evidence, aggregate going counts, and
bounded related-event links separate. Aggregate counts and teaser avatars never become contacts.
The Luma adapter reads public JSON-LD and provider-owned `__NEXT_DATA__` fields to resolve the
organizer calendar, distinguish people from organizations, and retain public website and social
identity URLs. Explicit calendar pages share the provider-request budget, and only provider-owned
embedded event records or typed event cards can add the bounded events listed by that calendar.

Any HTTPS event link can still seed the public research phase. Signed-in source access remains
provider-specific: unsupported sources stay public-only even when the opt-in is enabled. That
source-access decision is independent of the server-enforced LinkedIn identity/write gate, which
remains active for every Network Snowball seed that has a valid prepared target.

## Registered guest access

The launch dialog can opt one run into a named, existing RealTimeX browser session. Signals:

1. verifies that the selected connection exists and the session is already running;
2. leases that connection to the run without creating, starting, registering for, or stopping it;
3. requires a stable visible viewer identity and a visibly accessible guest list;
4. follows only visible guest-list pagination controls and bounded visible profile links;
5. stops immediately on login, registration, waitlist, permission, lease, or identity changes;
6. stores observed participants only in `snowball_event_observations` under the run, owner
   workspace, and short-lived grant.

Registered participants are not contacts, attendance claims, graph nodes, workflow results,
brief content, thread messages, or webhook payloads. The initiating launch dialog receives a
one-hour capability once; the database stores only its hash. Every report read validates the
capability, workflow run, owner workspace, expiry, and revocation state.
The initiating dialog can explicitly revoke the report. Closing or completing the Snowball run
releases its lease while leaving a user-selected borrowed browser session running.

The browser path uses visible DOM content only. It does not inspect cookies, browser storage,
authorization headers, private APIs, or network traffic, and it never attempts registration,
waitlisting, challenges, or access-control bypasses.

## Traversal limits

Defaults are one adjacent-event hop, three events per calendar, six events total, two calendar
pages, two guest pages, 30 participant observations, 20 profile visits, and 40 provider requests.
Hard limits are enforced server-side. Provider work is serialized with a one-second minimum
request interval, at most two transient retries (honoring `Retry-After`), a 30-second navigation
timeout, and a ten-minute phase deadline. Public HTTP fetches, redirects, retries, guest-list
pages, and profile visits all consume the same durable per-run provider-request budget, so a
retry or resumed run cannot reset the cap.
