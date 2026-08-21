# Contact Schema: 4-Channel Golden Record

> Comprehensive contact schema specification for multi-channel identity resolution
> across X/Twitter, LinkedIn, Gmail (Google People API), and Substack.
> See [`specs/01-origin.md`](./01-origin.md) for the foundation spec.

---

## 1. Channel API Field Inventory

### 1.1 X/Twitter API v2

**Endpoint:** `GET /2/users/:id` and `GET /2/users/by/username/:username`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique numeric user ID |
| `name` | string | Display name |
| `username` | string | @handle (unique) |
| `description` | string | Bio text (up to 160 chars) |
| `location` | string | User-set location (free-text) |
| `url` | string | Expanded URL from profile |
| `profile_image_url` | string | Avatar URL (48x48 default, `_normal` suffix) |
| `verified` | boolean | Currently-verified status |
| `verified_type` | string | `blue` / `business` / `government` / `none` |
| `protected` | boolean | Protected/private account |
| `created_at` | ISO 8601 | Account creation timestamp |
| `public_metrics.followers_count` | integer | Follower count |
| `public_metrics.following_count` | integer | Following count |
| `public_metrics.tweet_count` | integer | Total tweets |
| `public_metrics.listed_count` | integer | Times listed |
| `entities.url.urls[]` | object | Parsed URLs with expanded_url |
| `entities.description.urls[]` | object | Parsed URLs in bio |
| `entities.description.hashtags[]` | object | Hashtags in bio |
| `entities.description.mentions[]` | object | @mentions in bio |
| `pinned_tweet_id` | string | ID of pinned tweet |

**NOT available via API:** email, phone, real name (only display name).

**Auth:** OAuth 2.0 User Context or App-only Bearer Token.
**Rate limits:** 300 req/15min (app), 900 req/15min (user context).

### 1.2 LinkedIn API

**Endpoints:** Profile API, Email API (separate calls).

| Field | Scope Required | Notes |
|---|---|---|
| `id` | `profile` | LinkedIn member URN |
| `firstName.localized` | `profile` | Localized first name |
| `lastName.localized` | `profile` | Localized last name |
| `profilePicture` | `profile` | Display photo URL |
| `headline` | `profile` | Professional headline |
| `vanityName` | `profile` | Custom profile URL slug |
| `emailAddress` | `email` | Primary email (separate API call) |

**Partner-only fields** (require LinkedIn Partner Program approval):
- `positions` — work history (company, title, dates)
- `location` — geographic location
- `industry` — industry classification
- `skills` — endorsed skills
- `education` — education history

**Auth:** OAuth 2.0 with scopes `profile` + `email` (current), or
`r_liteprofile` + `r_emailaddress` (legacy, deprecated).
**Rate limits:** 100 req/day for most endpoints; partner apps get higher limits.

### 1.3 Google People API (powers "Gmail" channel)

**Endpoint:** `GET /v1/people/me/connections` and `GET /v1/people/{resourceName}`

The richest data source — 28+ structured field types:

| Field Type | Structure | Notes |
|---|---|---|
| `names` | given, family, display, middle, prefix, suffix | Multiple names possible |
| `emailAddresses` | value, type (home/work/other), formattedType | Multiple emails |
| `phoneNumbers` | value, type (mobile/home/work), formattedType | Multiple phones |
| `organizations` | name, title, department, type, startDate, endDate | Work history |
| `addresses` | streetAddress, city, region, postalCode, country, type | Structured address |
| `biographies` | value, contentType (TEXT_PLAIN/TEXT_HTML) | Bio/notes |
| `urls` | value, type (home/work/blog/profile/etc), formattedType | Multiple URLs |
| `photos` | url, default (bool) | Profile photos |
| `birthdays` | date { year, month, day } | May be partial (no year) |
| `events` | date, type (anniversary/other), formattedType | Anniversaries etc |
| `relations` | person, type (spouse/child/parent/etc) | Relationships |
| `occupations` | value | Free-text occupation |
| `skills` | value | Free-text skills |
| `interests` | value | Free-text interests |
| `locations` | value, type (desk/floor/etc) | Office locations |
| `memberships` | contactGroupMembership, domainMembership | Group memberships |
| `externalIds` | value, type (account/customer/etc) | External identifiers |
| `userDefined` | key, value | Custom key-value pairs |
| `nicknames` | value, type | Nicknames |
| `imClients` | username, type, protocol | IM accounts |
| `sipAddresses` | value, type | SIP addresses |
| `calendarUrls` | url, type | Calendar URLs |
| `fileAses` | value | "File as" sort name |
| `genders` | value | Gender |
| `clientData` | key, value | App-specific data |
| `miscKeywords` | value, type | Misc keywords |

**Supplemental — Gmail API:**
- Message frequency analysis via `messages.list` with query filters
- `From` / `To` / `CC` headers for relationship mapping
- Thread depth for engagement scoring
- Labels for categorization

**Auth:** OAuth 2.0, scopes `contacts.readonly` + `gmail.metadata`.
**Rate limits:** 60 req/min per user (People API), Gmail varies by endpoint.

**Note:** Channel is named "gmail" in the UI but is powered by Google People API
(contacts) + Gmail API (email metadata).

### 1.4 Substack

**No official API.** Two data access methods:

#### CSV Export (primary, reliable)

| CSV Column | Type | Notes |
|---|---|---|
| `email` | string | Subscriber email |
| `subscription_type` | string | `free` / `paid` / `founding` / `gift` / `comp` |
| `subscription_status` | string | `active` / `paused` / `cancelled` |
| `date_subscribed` | date | Subscription start date |
| `activity_score` | number | 30-day engagement score |
| `email_opens_7d` | integer | Opens in last 7 days |
| `email_opens_30d` | integer | Opens in last 30 days |
| `email_opens_180d` | integer | Opens in last 180 days |
| `posts_read` | integer | Total posts read |
| `comments` | integer | Total comments |
| `likes` | integer | Total likes |
| `revenue` | number | Total revenue from this subscriber |
| `payment_amount` | number | Current payment amount |
| `currency` | string | Payment currency |
| `location` | string | IP-based location (city/country) |

#### Unofficial API (optional, fragile)

Session-cookie authenticated endpoints exist but are undocumented, may break
without notice, and violate Substack ToS. **Recommended approach:** CSV import
as primary method, unofficial API as optional enhancement only.

---

## 2. Rationalized Contact Schema (Golden Record)

The `contacts` table becomes the canonical golden record — a single unified view
of a person across all platforms.

### 2.1 Columns to Add

| Column | Type | Default | Source Priority |
|---|---|---|---|
| `firstName` | text | null | LinkedIn > Google > parsed from name |
| `lastName` | text | null | LinkedIn > Google > parsed from name |
| `location` | text | null | Google > X > Substack |
| `website` | text | null | X > Google |
| `photoUrl` | text | null | Google > LinkedIn > X (best quality) |
| `verifiedEmail` | integer | 0 | 1 if email confirmed via OAuth or platform |
| `enrichmentScore` | integer | 0 | Computed 0-100, see Section 8 |

### 2.2 Columns to Remove (move to `contact_identities`)

| Column | Replacement |
|---|---|
| `platform` | `contact_identities.platform` (one per identity) |
| `platformUserId` | `contact_identities.platformUserId` |
| `profileUrl` | `contact_identities.platformUrl` |
| `avatarUrl` | `contacts.photoUrl` (golden record best-quality photo) |

### 2.3 Columns Retained

All existing columns not listed above remain unchanged:

`id`, `name`, `email`, `phone`, `headline`, `company`, `title`, `bio`, `tags`,
`metadata`, `funnelStage`, `score`, `lastInteractionAt`, `createdAt`, `updatedAt`

### 2.4 Updated Schema Definition

```typescript
// In src/lib/db/schema.ts — contacts table updates
export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  headline: text("headline"),
  company: text("company"),
  title: text("title"),
  bio: text("bio"),
  location: text("location"),
  website: text("website"),
  photoUrl: text("photo_url"),
  verifiedEmail: integer("verified_email").default(0),
  enrichmentScore: integer("enrichment_score").default(0),
  tags: text("tags").default("[]"),
  metadata: text("metadata").default("{}"),
  funnelStage: text("funnel_stage").default("prospect"),
  score: integer("score").default(0),
  lastInteractionAt: integer("last_interaction_at"),
  createdAt: integer("created_at").$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").$defaultFn(() => Date.now()),
});
```

---

## 3. New `contact_identities` Table

One row per platform presence, linked to a contact. Enables one contact to
have identities on X + LinkedIn + Gmail + Substack simultaneously.

### 3.1 Schema Definition

```typescript
export const contactIdentities = sqliteTable("contact_identities", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  contactId: text("contact_id").notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // "x" | "linkedin" | "gmail" | "substack"
  platformUserId: text("platform_user_id").notNull(),
  platformHandle: text("platform_handle"),   // bare identifier: username (X), vanityName (LinkedIn)
  platformUrl: text("platform_url"),         // profile URL on that platform
  platformData: text("platform_data").default("{}"), // JSON blob, shape varies per platform
  isPrimary: integer("is_primary").default(0),
  isActive: integer("is_active").default(1),
  lastSyncedAt: integer("last_synced_at"),
  syncErrors: integer("sync_errors").default(0),
  createdAt: integer("created_at").$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").$defaultFn(() => Date.now()),
});
```

### 3.2 Indexes

```typescript
// Unique identity per platform
CREATE UNIQUE INDEX idx_identity_platform_user
  ON contact_identities(platform, platform_user_id);

// Fast lookup by contact
CREATE INDEX idx_identity_contact
  ON contact_identities(contact_id);
```

### 3.3 `platformData` JSON Shapes

Each platform stores its full raw data in the `platformData` JSON column.
Shapes below are documented for reference — they are not schema-enforced.

#### X/Twitter

```json
{
  "verified": true,
  "verifiedType": "blue",
  "protected": false,
  "createdAt": "2009-03-21T00:00:00Z",
  "metrics": {
    "followers": 12500,
    "following": 890,
    "tweets": 45000,
    "listed": 320
  },
  "entities": {
    "bioUrls": ["https://example.com"],
    "bioHashtags": ["ai", "crm"],
    "bioMentions": ["openai"]
  },
  "pinnedTweetId": "1234567890"
}
```

#### LinkedIn

```json
{
  "headline": "VP Engineering at Acme Corp",
  "vanityName": "janedoe",
  "positions": [
    {
      "company": "Acme Corp",
      "title": "VP Engineering",
      "startDate": "2022-01",
      "current": true
    }
  ],
  "industry": "Technology",
  "connectionDegree": 2
}
```

#### Gmail (Google People API)

```json
{
  "resourceName": "people/c1234567890",
  "emails": [
    { "value": "jane@work.com", "type": "work" },
    { "value": "jane@personal.com", "type": "home" }
  ],
  "phones": [
    { "value": "+1-555-0123", "type": "mobile" }
  ],
  "organizations": [
    { "name": "Acme Corp", "title": "VP Engineering", "department": "Engineering" }
  ],
  "addresses": [
    { "city": "San Francisco", "region": "CA", "country": "US", "type": "work" }
  ],
  "birthdays": [{ "month": 3, "day": 15 }],
  "relations": [{ "person": "John Doe", "type": "spouse" }],
  "userDefined": [{ "key": "CRM ID", "value": "12345" }],
  "messageFrequency": { "sent30d": 5, "received30d": 12 }
}
```

#### Substack

```json
{
  "subscriptionType": "paid",
  "subscriptionStatus": "active",
  "dateSubscribed": "2024-06-15",
  "activityScore": 78,
  "emailOpens": { "7d": 3, "30d": 10, "180d": 42 },
  "postsRead": 67,
  "comments": 5,
  "likes": 12,
  "revenue": 120.00,
  "paymentAmount": 10.00,
  "currency": "USD",
  "location": "San Francisco, US"
}
```

---

## 4. Channel Onboarding Workflow

Step-by-step hydration flow when a user connects a new channel:

```
1. CONNECT → Store API credentials (OAuth token or API key) in platform_accounts
             Validate token with a test API call
             Set platform_accounts.status = "active"

2. FETCH   → Pull contacts from platform API (full initial sync)
             X: GET /2/users/me/following (paginated, max 1000 per page)
             LinkedIn: GET /v2/connections (paginated)
             Gmail: GET /v1/people/me/connections (paginated, up to 2000)
             Substack: parse uploaded CSV file

3. EXTRACT → Normalize each contact to common format:
             {
               name, firstName, lastName, email, phone,
               headline, company, title, bio, location,
               website, photoUrl, platform, platformUserId,
               platformHandle, platformUrl, rawPlatformData
             }
             Generate matching keys: normalized email, name+company hash

4. MATCH   → Compare against existing contacts in database:
             ┌─────────────────────────────┬────────────┬─────────────┐
             │ Match Type                  │ Confidence │ Action      │
             ├─────────────────────────────┼────────────┼─────────────┤
             │ Email exact match           │ 0.95       │ Auto-merge  │
             │ Name + Company exact match  │ 0.70       │ Review task │
             │ Fuzzy name + location match │ 0.50       │ Review task │
             │ No match                    │ < 0.50     │ New contact │
             └─────────────────────────────┴────────────┴─────────────┘

5. PRUNE   → Apply filters BEFORE inserting (see Section 6):
             Platform defaults + user-defined filters
             Filtered contacts are skipped, not deleted

6. MERGE   → For matches: add contact_identity row, recompute golden record
             For new: create contact + contact_identity rows
             Set isPrimary = true if this is the contact's first identity

7. SYNC    → Update platform_accounts.lastSyncedAt
             Calculate enrichmentScore for each affected contact
             Log sync results: added, merged, skipped, errors
```

---

## 5. De-duplication Strategy

### 5.1 Matching Hierarchy

| Priority | Match Key | Cross-Platform? | Confidence |
|---|---|---|---|
| 1 | Email exact match | Yes | 0.95 |
| 2 | Normalized name + company | Yes | 0.70 |
| 3 | Platform user ID (within same platform) | No | 1.00 |
| 4 | Fuzzy name + location | Yes | 0.50 |

**Email normalization:** lowercase, trim whitespace, strip `+` aliases
(e.g., `jane+work@gmail.com` → `jane@gmail.com` for Gmail addresses).

**Name normalization:** lowercase, strip titles (Dr, Mr, Mrs), strip suffixes
(Jr, III), collapse whitespace.

### 5.2 Confidence Thresholds

| Score Range | Action |
|---|---|
| >= 0.85 | Auto-merge: add identity to existing contact |
| 0.50 – 0.84 | Create review task for manual confirmation |
| < 0.50 | Create new contact |

### 5.3 Merge Resolution (field-by-field priority)

When merging, each golden record field is populated from the highest-priority
source that has a non-empty value:

| Field | Priority Order | Rationale |
|---|---|---|
| `firstName`, `lastName` | LinkedIn > Google > X | LinkedIn has structured names |
| `email` | Google > LinkedIn > Substack | Google has verified emails |
| `phone` | Google > LinkedIn | Google has structured phone data |
| `headline`, `title` | LinkedIn > Google | LinkedIn is professional-focused |
| `company` | LinkedIn > Google > X | LinkedIn most current |
| `bio` | X > LinkedIn | X bios are public-facing |
| `location` | Google > X > Substack | Google has structured addresses |
| `website` | X > Google | X profiles often have primary URL |
| `photoUrl` | Google > LinkedIn > X | Google has highest-res photos |

### 5.4 Golden Record Recompute

Triggered whenever a contact_identity is added, updated, or removed. The
recompute process:

1. Load all identities for the contact
2. For each golden record field, apply priority order from 5.3
3. Recalculate enrichmentScore (Section 8)
4. Update `contacts.updatedAt`

---

## 6. Pruning Rules

### 6.1 Pre-hydration Filters (applied during import)

| Platform | Skip When | Rationale |
|---|---|---|
| X | `protected == true` | Cannot interact with protected accounts |
| X | Account suspended | No value as CRM contact |
| X | `tweet_count == 0` | Likely bot or inactive |
| LinkedIn | Insufficient profile data (no name) | Cannot meaningfully engage |
| Gmail | No email interaction in 2+ years | Stale contact |
| Gmail | No email address | Cannot use for outreach |
| Substack | `subscription_status == "cancelled"` AND `activity_score == 0` | Fully disengaged |
| Substack | `subscription_type == "free"` AND `email_opens_180d == 0` | Inactive free subscriber |

### 6.2 User-Defined Filters (configurable in settings)

- Minimum follower count (X)
- Required location / exclude locations
- Required company / exclude companies
- Custom tag requirements
- Minimum enrichment score threshold

### 6.3 Post-Hydration Cleanup

- **Score-based:** flag contacts below configurable enrichment threshold
- **Engagement-based:** flag contacts with no interactions across ANY channel
  in configurable time window (default: 6 months)
- **User-defined:** custom criteria via settings UI

### 6.4 Non-Destructive by Default

All pruning operations use soft-delete (archive). Hard deletion requires
explicit user action from the UI. Archived contacts can be restored.

---

## 7. Sync & Update Mechanism

### 7.1 Sync Types

| Type | Trigger | Scope | Use Case |
|---|---|---|---|
| Full sync | Manual or first connect | All contacts from platform | Initial onboarding |
| Delta sync | Scheduled | New/changed since `lastSyncedAt` | Ongoing updates |
| Single refresh | Manual (per-contact) | One contact's platform data | Ad-hoc update |

### 7.2 Default Sync Cadence

| Platform | Cadence | Rationale |
|---|---|---|
| X | Daily | Generous rate limits, public data |
| LinkedIn | Weekly | Restricted API, low rate limits |
| Gmail/Google | Daily | Good rate limits, contacts change often |
| Substack | Weekly | CSV re-import or manual trigger |

Cadence is configurable per-platform in `platform_accounts.sync_config` (JSON).
Implemented via the `scheduled_jobs` table.

### 7.3 Conflict Resolution on Update

- **Platform-specific fields** (in `platformData`): platform always wins
- **Golden record fields edited by user**: preserved unless user enables
  "auto-update from platform" per field
- **Golden record fields NOT edited by user**: updated from platform data
  using priority order from Section 5.3
- **Tracking:** `contacts.metadata` stores `{ "userEdited": ["headline", "bio"] }`
  to distinguish user edits from platform-sourced values

### 7.4 Error Handling

- `syncErrors` counter increments on each failed sync attempt
- After 3 consecutive failures: mark identity as `isActive = false`
- After 10 consecutive failures: create task for user review
- Token expiry: prompt user to re-authenticate via platform_accounts settings

---

## 8. Enrichment Score

Scoring matrix (0-100) measuring data completeness:

| Criterion | Points | Notes |
|---|---|---|
| Structured name (`firstName` + `lastName`) | 10 | Both fields present |
| Verified email | 15 | `verifiedEmail == 1` |
| Unverified email | 10 | Has email but not verified |
| Phone number | 10 | Any phone present |
| Professional: headline | 5 | |
| Professional: company | 5 | |
| Professional: title | 5 | |
| Location | 5 | |
| Bio | 5 | |
| Photo | 5 | `photoUrl` present |
| Website | 5 | |
| 2+ platform identities | 10 | Cross-platform coverage |
| 3+ platform identities | +5 | Additional bonus |
| Rich platform data | 10 | `platformData` has > 5 fields |
| Platform-specific bonus | up to 5 | X verified, LinkedIn partner data, etc |
| **Maximum** | **100** | |

Note: email scoring is mutually exclusive (verified OR unverified, not both).

Enrichment score is recomputed on:
- Contact creation
- Identity added/updated/removed
- Golden record field update
- Manual refresh

---

## 9. Migration Path

### 9.1 Schema Migration Steps

1. **Add new columns** to `contacts` table:
   ```sql
   ALTER TABLE contacts ADD COLUMN first_name TEXT;
   ALTER TABLE contacts ADD COLUMN last_name TEXT;
   ALTER TABLE contacts ADD COLUMN location TEXT;
   ALTER TABLE contacts ADD COLUMN website TEXT;
   ALTER TABLE contacts ADD COLUMN photo_url TEXT;
   ALTER TABLE contacts ADD COLUMN verified_email INTEGER DEFAULT 0;
   ALTER TABLE contacts ADD COLUMN enrichment_score INTEGER DEFAULT 0;
   ```

2. **Create `contact_identities` table** (full schema from Section 3.1)

3. **Data migration script:** For each existing contact with `platform` +
   `platform_user_id` values:
   - Create a `contact_identity` row with the platform data
   - Copy `avatar_url` → `photo_url` (if no better source)
   - Parse `name` into `first_name` / `last_name` (simple split on first space)
   - Calculate initial `enrichment_score`

4. **Backward compatibility:** Keep deprecated columns (`platform`,
   `platform_user_id`, `profile_url`, `avatar_url`) as nullable during
   transition period. Remove after verification that all reads go through
   `contact_identities`.

5. **Schema sync:** `drizzle-kit push` handles the schema changes.
   For production data migration, run the data migration script separately.

### 9.2 API Migration

- `GET /api/contacts` — include `identities[]` in response
- `POST /api/contacts` — accept optional `identity` object alongside flat fields
- `PUT /api/contacts/:id` — continue accepting flat `platform` field for
  backward compat, but prefer `identity` operations
- New: `POST /api/contacts/:id/identities` — add identity to existing contact
- New: `DELETE /api/contacts/:id/identities/:identityId` — remove identity

---

## 10. Known Issues & Required Fixes

### 10.1 Bug Fixes

| File | Line | Issue | Fix |
|---|---|---|---|
| `src/app/api/contacts/[id]/route.ts` | 10 | Zod enum only `["x", "linkedin"]` | Change to `["x", "linkedin", "gmail", "substack"]` |

### 10.2 Missing Indexes

```sql
-- De-duplication queries need these indexes
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_name ON contacts(name);
CREATE INDEX idx_contacts_company ON contacts(company);
```

### 10.3 Uniqueness Constraints

The `contact_identities` table requires a unique constraint on
`(platform, platform_user_id)` to prevent duplicate identity rows.
Defined in Section 3.2.

---

## 11. UI Display Labels

Shared label map used across all UI components:

```typescript
const platformLabels: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  substack: "Substack",
};
```

---

## 12. API Validation

Zod schemas for contact and workflow template creation validate platform against the
4-channel enum:

```typescript
z.enum(["x", "linkedin", "gmail", "substack"])
```

---

## 13. Phase Placement

| Component | Phase | Notes |
|---|---|---|
| Contact schema rationalization | 2 | Golden record + identities table |
| Data migration script | 2 | Existing contacts → identities |
| X OAuth 2.0 + API client | 1 | Current phase |
| LinkedIn OAuth + API client | 2 | After X integration |
| Gmail/Google OAuth + People API | 2 | With contact enrichment |
| Substack CSV import | 2 | With contact enrichment |
| Identity resolution UI | 3 | De-dup review queue |
| Cross-channel sync scheduler | 3 | Automated sync jobs |
| Enrichment score dashboard | 3 | Score visualization |
| Pruning rules settings UI | 4 | User-configurable filters |
