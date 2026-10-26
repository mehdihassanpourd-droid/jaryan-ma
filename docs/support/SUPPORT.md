# Customer support

Status: **foundation implemented and tested; no support UI yet; no notifications are sent.** Support needs customer accounts, so it is only reachable when customer sign-in is enabled (see [CUSTOMERS.md](../customers/CUSTOMERS.md)). The public FAQ endpoint works independently.

## 1. What exists

| Area | Implemented |
|---|---|
| Tickets with a first message, category, optional link to the customer's own order | yes |
| Conversation: customer messages and staff replies | yes |
| **Internal notes** (staff only) in a separate table | yes |
| Status workflow, priority, assignment, first-response time | yes |
| Role-based access (support / owner; editors and viewers excluded) | yes, enforced in the service **and** covered by HTTP tests |
| Spam and abuse protection | yes (see §4) |
| Persian FAQ (categories + items, publish flag, admin editing, public endpoint) | yes; starter content is seeded **unpublished** |
| Support UI for customers and staff | **planned** |
| E-mail / SMS notification of replies, attachments, canned replies, SLA reports | **planned (not started)** |

## 2. Model

`SupportTicket` (number shown as `T-1042`, customer, optional order, subject, category, status, priority, assignee, timestamps), `SupportMessage` (author `customer|staff|system`), `SupportNote` (internal), `FaqCategory`, `FaqItem`.

* **Categories:** سفارش، محصول، ارسال، مرجوعی، حساب کاربری، مشکل در سایت، سایر.
* **Statuses:** `open` → `in_progress` / `waiting_customer` → `resolved` → `closed`. Database `CHECK` constraints require a resolution time on resolved/closed tickets.
* **Priority:** `low | normal | high | urgent` — **only staff can set it**; the customer-facing create/reply schemas are `.strict()` and reject `priority`, `status`, `assignedToId` and any other unknown field.
* **Order link:** `orderNumber` must belong to the same customer; "not yours" and "does not exist" give the same answer (`invalid_order`).

## 3. Workflow rules (`src/domain/support/workflow.ts`)

| Event | Result |
|---|---|
| Customer opens a ticket | `open` |
| Staff replies | `waiting_customer` (or the status the staff member chose); the first replier is assigned if nobody is; `firstResponseAt` is set once |
| Customer replies while `waiting_customer` or `resolved` | back to `open` |
| Customer replies to a ticket resolved **more than 14 days ago** | refused (`reopen_expired`) — open a new ticket |
| Customer replies to a `closed` ticket | refused (`ticket_closed`) |
| `resolved` for 7 days without reply | closed automatically (scheduled job `close_resolved_tickets`) |
| Staff transitions | `closed` can only be reopened; no no-op transitions; assignee must be an active `support`/`owner` account |

## 4. Spam and abuse protection

| Control | Default |
|---|---|
| Tickets per customer | 3 / hour, 8 / day |
| Tickets that may be open at once | 10 |
| Customer messages per hour (tickets + replies, counted in the database) | 20 |
| Burst guard (in memory) | 5 messages / minute |
| Links per message | max 2 (URLs, `www.`, `t.me/`, `wa.me/`, bare domains) |
| Message length | 10–4,000 characters for a new ticket, ≤ 4,000 for replies; subject 3–120 |
| Duplicates | the same normalised ticket (digits/letters/punctuation/spacing differences ignored) within 24 h, or the same reply twice in a row, is refused |
| Structurally spammy text | very short, or ≥ 20 characters made of ≤ 3 distinct characters, or one character > 60 % of a long message |
| Control / bidi-override characters | stripped from every message |
| Suspended accounts | cannot open or write tickets (they cannot sign in at all) |
| Only authenticated customers | there is no anonymous ticket form, so there is nothing to CAPTCHA |

No external anti-spam service and no AI are used. These are structural checks; a determined human sender with a verified phone number is limited by the rate limits, not blocked by content analysis.

## 5. Roles

| Capability | viewer | editor | support | owner |
|---|---|---|---|---|
| Read tickets & customer messages (`support:read`) | – | – | ✔ | ✔ |
| Reply (`support:reply`) | – | – | ✔ | ✔ |
| Internal notes (`support:note`) | – | – | ✔ | ✔ |
| Status / priority / assignment (`support:manage`) | – | – | ✔ | ✔ |
| Edit the FAQ (`faq:write`) | – | ✔ | ✔ | ✔ |
| Maintenance (health, incidents, backups) | – | – | – | ✔ |

Staff lists show the customer's phone number **masked** (`+98912***4567`); staff do not get customer profile, address or order data through support endpoints. A role that can read tickets but lacks `support:note` would receive no notes at all.

## 6. Privacy guarantees (tested)

* The customer view of a ticket contains only number, subject, category, status, order number, timestamps and messages (author, text, time). Never notes, assignee, staff e-mail, priority or ids of staff.
* Customer queries select explicit columns and never touch the notes table (a static test checks this).
* Staff actions (reply, note, update, FAQ changes) are written to the audit log **without message text**.
* Account export includes the customer's tickets and the messages they can see; account deletion redacts subjects, messages and notes (see CUSTOMERS.md §6).

## 7. API

Staff (admin session, CSRF token, allowed origin; under `/api/v1`):

| Method & path | Needs |
|---|---|
| `GET /support/tickets?status=&priority=&category=&assignedToId=&unassigned=1&q=&page=&pageSize=` (ordered: highest priority, then longest waiting) | `support:read` |
| `GET /support/stats` | `support:read` |
| `GET /support/tickets/:number` | `support:read` |
| `POST /support/tickets/:number/reply {body, status?}` | `support:reply` |
| `POST /support/tickets/:number/notes {body}` | `support:note` |
| `PATCH /support/tickets/:number {status?, priority?, assignedToId?}` | `support:manage` |
| `GET /faq`, `PUT /faq/items`, `PUT /faq/categories`, `DELETE /faq/items/:slug`, `POST /faq/seed` | `faq:write` |

Customer: see CUSTOMERS.md §5. Public: `GET /api/v1/public/faq` (published answers only, CORS `*`, cacheable 5 min; answers are plain text, never HTML).

## 8. The Persian FAQ

`server/support/default-faq.ts` holds 10 starter entries in 4 groups (account, orders & shipping, privacy, support). `POST /faq/seed` (or `npm run ops -- faq-seed`) adds them **unpublished** and never overwrites an edited entry.

* Entries about how the site works (sign-in, addresses, export, deletion, tickets) are accurate for the code as built, but are published only by a person once the feature is live.
* Entries about **policy** (delivery time, returns, made-to-order lead time) contain *no* invented facts: they only say the policy will be completed by the owner. They must be edited before publishing.

## 9. Planned

Support UI (customer + staff, Persian RTL), notifications on staff reply (needs an SMS/e-mail decision and budget), attachments (images), canned replies, satisfaction rating, SLA dashboard.
