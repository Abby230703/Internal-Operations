# HOSPI OPS — Full Project Handoff

Everything a new engineer (or LLM) needs to understand, run, test and debug this software. Read it top to bottom once; the table of contents is for coming back to it.

**Audience:** another LLM / developer who will debug this with the owner. You have **no access to the owner's live Google Sheet or Apps Script project** — only this repository, a test harness that fakes both, and the owner's screenshots and error messages. Section 17 lists what is verified, what is not, and the one open bug.

---

## Contents

1. [What this is](#1-what-this-is)
2. [Who is who, how we work](#2-who-is-who-how-we-work)
3. [Repository map](#3-repository-map)
4. [Deployment model (Apps Script)](#4-deployment-model-apps-script)
5. [Architecture](#5-architecture)
6. [The Google Sheet (data model)](#6-the-google-sheet-data-model)
7. [Business workflows by department](#7-business-workflows-by-department)
8. [Server API reference (all routes)](#8-server-api-reference-all-routes)
9. [Server building blocks and conventions](#9-server-building-blocks-and-conventions)
10. [Front end](#10-front-end)
11. [Roles, departments and access](#11-roles-departments-and-access)
12. [Typed-column rules — the #1 source of production errors](#12-typed-column-rules)
13. [Test harness](#13-test-harness)
14. [History: what was built, what broke, what fixed it](#14-history)
15. [Edits the owner was asked to apply by hand (status unknown)](#15-pending-hand-edits)
16. [OPEN BUG: cannot type in the Make Quote line items](#16-open-bug)
17. [Verified vs not verified](#17-verified-vs-not-verified)
18. [Assumptions and judgement calls](#18-assumptions-and-judgement-calls)
19. [Debugging playbook](#19-debugging-playbook)
20. [Glossary](#20-glossary)

---

## 1. What this is

**Hospi Ops** is an internal operations web app for a Surat (India) trading company ("Abhilasha Enterprises", divisions: Textile, Packaging, Dustbin, Hospitality; hotel/restaurant supplies — glassware, cutlery, bins, etc.). It is a **Google Apps Script web app** sitting on top of **one Google Sheet** that is the database. There is no other backend.

The sheet is named **"Copy of Hospi Solutions - Ops Backend"** (it was "Company Operations Database"; same sheet, renamed), ID `1SD9Uyn7EsN9QycQZNqIg0-8x67axiSQOzryWnEJa1Zc`.

One web app, **one URL per department** (`…/exec?dept=<key>`), five departments:

| Dept key | People | What they do |
|---|---|---|
| `sales` | Sales | Leads → requirements → quotations → sales orders (**pre-existing, written by the owner, not by us**) |
| `procurement` | Purchase manager | Accept/deny reorder requirements, choose supplier, make purchase orders (PO), manage suppliers |
| `warehouse` | Warehouse staff | Receive goods (GRN), put away to locations, pick/pack/book transport/dispatch orders, stock view, audit counts |
| `accounts` | Accounts | Invoice sales orders & record money received, record supplier bills & payments, payments ledger, review audit counts |
| `admin` | Admin | Overview/exceptions, product master data, users, locations |

**What we (the AI) built in this project:** Procurement, Warehouse, Accounts, Admin (server `.gs` + HTML boards) plus a shared shell. **Sales already existed** and is only touched in a few shared files (`Config.gs`, `Main.gs`, `Index.html`) — see §3.

---

## 2. Who is who, how we work

- **The owner** is a non-developer business owner/office manager. They paste code into Apps Script **by hand** into a **replica Apps Script project** (they do not use clasp/git), deploy, and test on real data. They report bugs with **screenshots** (browser toasts, UI states).
- **Preferences stated by the owner (follow them):**
  - Often asked for **"just give me the code lines that need changing in file X"** (find/replace instructions) rather than whole files. Sometimes asked for whole files ("give me the updated files"). Default: give exact FIND → REPLACE snippets, and offer full files.
  - Wants a **combined paste-ready file** (`HOSPI-OPS-ALL-FILES.txt`) — regenerate it after any change to a shipped file (builder script described in §3).
  - **Do not copy or delete the old kanban script** (a legacy `Sales_Leads` script with `onOpen`/`showDashboard`) — it isn't in the repo and breaks the shared Index; the owner just doesn't paste it.
  - **Do not create pull requests** unless asked. Work is committed/pushed to branch **`claude/procurement-warehouse-gs-html-wcanmt`**. Commit messages end with the attribution lines the harness asks for.
  - Think "from the POV of an office manager" — simple, button-driven screens, no jargon.
- **The owner's Sales files are theirs.** We do not have their *current* copies; `reference/original-sales/` holds what they pasted at the start (may be stale — see §3).
- The owner is currently going to debug the open bug (§16) **with another LLM**, using this document.

---

## 3. Repository map

Repo root `/home/user/Internal-Operations` (GitHub `abby230703/internal-operations`). Every `.gs` / `.html` at the root is a file to paste into Apps Script (name without extension).

### Server files (`.gs`)

| File | Owner | Purpose |
|---|---|---|
| `Config.gs` | **owner's file, modified by us** (`PW:` comments mark our additions) | `CONFIG` (settings, `DEPARTMENTS`, payment modes, PDF folders…), `TABLES` (tab/header-row/key), `REQUIRED_HEADERS` |
| `Main.gs` | **owner's file, modified by us** | `doGet`, `include`, `api()` (the single door), `Main.methods()` (route table), `Main.locked`, department picking, `boot`, `Auth`, `runDiagnostics` |
| `Items.gs` | ours | `Items` (cached product map) and `Rows` (row helpers incl. `Rows.serial` for typed dates) |
| `Procurement.gs` | ours | `ProcApi` — suppliers, purchase queue, purchase orders |
| `Warehouse.gs` | ours | `Ledger` (stock ledger math) and `WhApi` — locations, GRN receiving, put-away, stock, audit, dispatch |
| `Accounts.gs` | ours | `AcctApi` — order billing & receipts, supplier bills & payments, payments ledger |
| `Admin.gs` | ours | `AdminApi` — users, locations, products, overview, sheet check |

Owner's untouched Sales server files (**not in repo root**; reference copies in `reference/original-sales/`): `OrdersApi.gs`, `Pdf.gs` (`PdfApi`), `QuotesApi.gs` (`QuoteApi`), `RequirementsApi.gs` (`ReqApi`), `LeadsApi.gs` (`LeadsApi`), `Lookups.gs` (`Parties`, `Catalog`, `Photos`), `Db.gs` (`Db`), `Util.gs` (`U`).

### HTML files

| File | Owner | Purpose |
|---|---|---|
| `Index.html` | owner's, **rewritten by us** into a template | page shell, driven by `cfg` from `Main.deptConfig` |
| `DeptShell.html` | ours | wraps `App.go/App.icon/App.refreshAttn`; `PW.*` helpers incl. `PW.payDialog`; **loaded on every department including Sales** |
| `DeptStyles.html` | ours | extra CSS (`<style>` file) |
| Procurement boards | ours | `ProcQueueBoard`, `PurchaseOrdersBoard`, `SuppliersBoard` |
| Warehouse boards | ours | `ReceivingBoard`, `PutAwayBoard`, `DispatchBoard`, `StockBoard`, `AuditBoard` (also used by Accounts) |
| Accounts boards | ours | `OrderReceiptsBoard`, `PurchaseReceiptsBoard`, `PaymentsBoard` |
| Admin boards | ours | `OverviewBoard`, `ProductsBoard`, `UsersBoard`, `LocationsBoard` |
| `Client.html`, `Styles.html`, `LeadsBoard`, `RequirementsBoard`, `QuoteBoard`, `OrdersBoard` | **owner's, untouched** | (reference copies in `reference/original-sales/`) |

### Other files

| Path | What |
|---|---|
| `README.md` | user-facing install/how-it-works notes |
| `HOSPI-OPS-ALL-FILES.txt` | **combined paste-ready file** (version 4, 25 files verified byte-identical to the originals). Regenerate with a small script that concatenates each file between marker lines (see its header for the format) whenever a shipped file changes |
| `OrdersBoard-stage-fix.txt` | 5 optional edits to the owner's `OrdersBoard.html` so progress bars know the stages `To pack` and `Ready to dispatch` |
| `PROC-QUEUE-CHANGES.txt`, `TYPED-COLUMN-FIX.txt` | historic find/replace change lists given to the owner |
| `reference/original-sales/` | the owner's original Sales code **as pasted in conversation early on**. One paste artifact fixed (a stray `}` after `OrdersApi`). **These may be older than the owner's live files** — the open bug (§16) strongly suggests their live `QuoteBoard.html` differs. |
| `harness/` | the test harness (§13) |
| `appsscript.json` | deliberately **not** in the repo — the owner's project has its own |

---

## 4. Deployment model (Apps Script)

- The owner keeps a **replica Apps Script project** and pastes files into it manually. For each file: `.gs` → Script file, `.html` → HTML file; names without extension (`Items`, `ProcQueueBoard`…).
- **Web app settings:** *Execute as: User accessing the web app*; access per company policy. This matters: the code identifies the person via `Session.getActiveUser().getEmail()` (falls back to `getEffectiveUser`) and looks them up in the `Users` tab.
- After **any** edit the owner must **Deploy → Manage deployments → New version** for `/exec`; the `/dev` URL (test deployment) serves the last saved code.
- Every HTML board file **must start with `<script>` and end with `</script>`** (DeptStyles: `<style>`/`</style>`; Index: full `<!DOCTYPE html>` page). If the first line is lost when pasting, Apps Script prints the file's code as text and the tab doesn't appear — `Index.html` has an inline check that shows a red toast naming boards that failed to register.
- HtmlService runs the page in a **sandboxed iframe** (`script.google.com/macros/s/…/exec` → inner `*.googleusercontent.com` frame). Keep this in mind when debugging in DevTools: console context selector must be switched from `top` to the inner frame (`userHtmlFrame` / `sandboxFrame`) to run snippets against the app.
- `google.script.run` calls are made through a single function `api(name, argsJson)` (see §5). There is a ~6 min execution limit and `LockService` script lock (25 s wait) around writes.
- Not testable outside Google: Drive (PO PDFs, audit photos, quote PDFs), `LockService`, `CacheService` real behaviour, the HTML→PDF converter, real sign-in by email.

---

## 5. Architecture

### 5.1 One door: `api(name, argsJson)`

`Main.gs`:

```js
function api(name, argsJson) {
  // entry = Main.methods()[name]  ->  [function(args, user), needsLock, roles?]
  // user = Auth.current()  (Users tab lookup by Google email)
  // roles = entry[2] || CONFIG.SALES_ROLES  ('Sales')
  // if (roles !== '*' && user.role !== 'Admin' && roles.indexOf(user.role) < 0) -> error
  // data = entry[1] ? Main.locked(function () { try { return entry[0](args, user); } finally { Items.dropCache(); } })
  //                 : entry[0](args, user);
  // returns JSON STRING: '{"ok":true,"data":…}' or '{"ok":false,"error":"…"}'
}
```

- Returns a **JSON string** always (so Dates etc. can never make `google.script.run` silently return `null`). The client (`App.api`) parses it and rejects on `ok:false` → shown as a red toast.
- **Route entry `[fn, needsLock, roles]`:** `roles` omitted = Sales action (`CONFIG.SALES_ROLES = ['Sales']`); `'*'` = any signed-in role; an array = those roles; **`[]` = Admin only** (Admin always passes). Writes use `needsLock=true` → `LockService.getScriptLock().waitLock(25000)`; after every locked write `Items.dropCache()` runs.
- `Main.methods()` merges the Sales routes with `ProcApi.routes()`, `WhApi.routes()`, `AcctApi.routes()`, `AdminApi.routes()`.

### 5.2 Departments

`CONFIG.DEPARTMENTS[key] = { label, initial, sub, roles, boards, includes }`.

- `doGet(e)`: `user = Auth.current()`, `key = Main.pickDept(user, e.parameter.dept)` — the requested department **if the role may open it**, else the role's first allowed department (Admin → any; a Sales user asking for `?dept=admin` silently gets `sales`). Then `Index` is evaluated as a template with `t.cfg = Main.deptConfig(key, user)`.
- `Main.deptConfig` returns `{ key, label, initial, boards, includes, menu:[{key,label,initial,sub,url,enabled}] }`. `Index.html` renders `<section id="board-<name>">` per board, includes `Client` → `DeptShell` → each board file in `includes`, and sets `window.DEPT`.
- `Main.boardOf(file)` maps an include file to the board name it registers (used for `boardsFor` limiting; kept for future use).
- `boot` (route) returns `{ app, user, today, depts, defaults, pocDefault, lists:{… paymentModes}, nextQuoteNo (Sales/Admin only) }`.

### 5.3 Data access layer (owner's `Db.gs`, unchanged)

All sheet I/O goes through `Db` (see `reference/original-sales/Db.gs`):

- Columns are found **by header name** (trailing/double spaces ignored: `"Put Away "` → `"Put Away"`). Header row per tab from `TABLES[key].headerRow` (**Sales Orders = row 2**, everything else row 1).
- `Db.readAll(key)` → array of `{header: value, _row: n}`; `Db.readCols(key, [headers])` (fast partial read); `Db.append(key, [objs], fmt)`, `Db.update(key, row, obj, fmt)`, `Db.clear`, `Db.find`, `Db.meta`, `Db.lastDataRow` (last row whose **key column** is non-blank), `Db.writable` (**never writes columns ending in `(auto)`** — they are sheet formulas), `Db.setFormat_` (try/catch around `setNumberFormat` — **must stay**, see §12), `Db.safeText` (prefixes `'` to strings starting `= + - @`).
- A "blank" row = key column empty. Deleting a row = **wiping its writable cells** (`Rows.wipe`) so the key goes blank; rows are never physically removed.
- Per-execution caches: `Db._meta` (header positions) etc.

### 5.4 Caches

- `Items` product map: `CacheService.getScriptCache()`, chunked at 90,000 chars, TTL 120 s, key `hospi.items.v1.*`; dropped after every locked write; `Items.get(code)` re-reads once on a miss (so an item added by hand in the sheet is found).
- `Catalog._codes` (item code → raw sheet value) is per-execution.

### 5.5 Concurrency / ID rules

- One write at a time (script lock). IDs: **8-char lowercase hex starting with a letter** (`U.newId(takenSet)`), stored as text, never reused. Human document numbers are separate: `AE/SO/0001` (quote no = order no), `AE/PO/0001`, `AE/GRN/0001` (`Rows.nextNo(rows, header, prefix)` = highest existing + 1, 4 digits).

---

## 6. The Google Sheet (data model)

### 6.1 Conventions from the sheet's own `Data_Dictionary` tab

- Row 1 of each tab is the header (**Sales Orders: row 2**, data from row 3).
- Columns ending **`(auto)`** are formulas in the header cell, to the right of each table. **Never write them.**
- Add rows at the first empty row of the table; **do not use `appendRow`/`values.append`** (the (auto) columns make the sheet look full).
- IDs: 8-char lowercase hex, text. Document numbers (`AE/SO/0001`…) are separate.
- Dates: real dates, not text.
- Units: line quantities (`No. of Set`) are in **sets**. Stock Movement `Qty`, Warehouse Qty, Reserved, On Order are in **pieces** (sets × `Pcs / Set`).
- Prices: List Price / Offer Price are **Rs per piece, GST-exclusive**. Amount = Pcs/Set × sets × price.
- Quote → order: Quote ID becomes the Order ID; quote lines are copied to Sales Order Lines (not deleted).
- Lead → customer: create Customers row, set `Leads.Customer ID`, set Lead Status `Business Done`.
- New items: `Item Code` may be blank on Requirements / Purchase Lines / GRN Lines for items not yet in Products; add the Products row before the first put-away (Stock Movement needs an Item Code).
- Role in `Users` is one of **Admin, Sales, Procurement, Warehouse, Accounts**.

### 6.2 Tabs and columns

(`(typed)` = a Sheets "table" column with a type; see §12. Dropdown values are exact.)

- **Users:** Email, Name, Role.
- **Locations:** Location Code, QR Code, Floor, Zone, Shelf, Description. (Codes like `FL1-ZA`, `FL2-ZB-S2`.) The app never writes `QR Code`.
- **Tally_Stock:** Item Code, Closing Qty, Rate, Stock Value, HSN, GST_Rate (import; not used by the app).
- **Leads:** Lead ID, Lead Date, Lead Person Name, Lead Person Pho. No., Company/Brand Name, City, Interested Products, Lead Source (dropdown), Lead POC (dropdown), Lead Status (dropdown: Inquiry, Sampling, Quotation, Negotiation, Business Done, Business Lost), Value, Next Follow Up Date, Customer ID.
- **Requirements:** Req ID, **Req Date (typed DATE `dd/mm/yyyy`)**, Salesman (typed PEOPLE_CHIP), **Req for (dropdown Customer/Lead)**, Customer / Lead Name, Customer / Lead ID (formula-like: write name + Req for only), Need By, Supplier, **Status (dropdown Accepted/Denied; blank = awaiting)**, PO ID, SO ID, Notes, Item Code, Item Description, No. of Set; formula cols: Party (auto), Item (auto), Quote no. (auto), PO no. (auto), **Stage (auto)** = `Ordered` if PO ID filled, else Denied/Accepted from Status, blank if undecided.
- **Customers:** Customer ID, Company/Brand Name, Customer Name, WhatsApp No., GSTIN, Address, City, Salesman.
- **Quotations:** Quote ID, Quote No, Quote Date, Salesman, Quote For (dropdown), Customer / Lead ID, Customer / Lead Name, Valid Until, Payment Terms, Delivery Terms, Quote PDF, Created_At, Lost On, Lost Reason; formula Status (auto): Open / Expiring soon / Expired / Converted / Lost.
- **Quotation_lines:** Line ID, Quote ID, Item_Code, Description, Qty/Set, Set, List Price, Discount %, Offer Price, GST %, Req ID, Photo Link.
- **Sales Orders** (header row **2**): Order ID (= Quote ID), Order No., Order Date, Customer (customer **ID**), Salesman, **Status (typed dropdown: Order received / Order Packed / Billing done / Dispatched / Cancelled)**, Payment Terms, Delivery Terms, Proforma Invoice PDF, Created At, Dispatch Date, Dispatched By, Transport Booked, Tally Voucher No., **Invoice Date (typed DATE)**, **Due Date (typed DATE)**, Payment Cleared On, Invoice Amount, Transporter, LR No.; formula cols: Customer (auto), Lines (auto), Value incl. GST (auto), **Stage (auto)**, Received (auto), Balance (auto), Pay Status (auto) (values seen: "Not invoiced"). Stage (auto): `Cancelled`/`Dispatched` come from Status, else `No lines` / `To pick` (Picked count < lines) → `To pack` (Packed count < lines) → `Book transport` (Transport Booked ≠ TRUE) → `Ready to dispatch`.
- **Sales Order Lines:** Line ID, Req ID, Order ID, Item_Code, Description, Pcs / Set, No. of set, Offer Price, GST %, **Pick From (dropdown of Locations)**, Picked, Packed, Dispatched, **Dispatch Date (typed DATE `dd-mm-yyyy`)**, Dispatched By, **Dispatched Qty (typed DOUBLE, in sets)**, formulas: Taxable amount (auto), GST amount (auto), **Open Sets (auto)** = sets − Dispatched Qty (0 if line Dispatched or order Cancelled).
- **Suppliers:** Supplier ID, **Supplier Company Name** (name), Contact_Name, WhatsApp, Email, GSTIN, City, Address, Product_Categories. *Other tables store the Supplier ID, not the name — including `Purchase."Supplier Company Name"`, which holds the ID.*
- **Purchase** (PO header): Purchase ID, Purchase No, Purchase Date, Supplier Company Name (= Supplier **ID**), Delivery Date, Payment Terms, Status (`Draft`/`Sent`; only Sent POs count as On Order), PO PDF, Created By, Created At, Proforma Purchase Invoice, Generated By, Generated At.
- **Purchase Lines:** Line ID, Req ID, Purchase ID, Item Code, Description, Supplier Item Code, Supplier Item Name, Pcs / Set, No. of Set, Rate (Rs/pc excl. GST), GST %; formulas Supplier ID (auto), **Open Sets (auto)** = ordered − Σ GRN Lines `Received No. of Sets` by Purchase Line ID, and 0 unless the PO is Sent.
- **GRN:** GRN ID, GRN No, Purchase ID, Supplier, Supplier Invoice No, Invoice Date, Received Date, No. of cartons received, Received By, **Status (typed dropdown: Yet to receive / Received)**, **Bill Amount**, **Tally Purchase Voucher No.**; formulas Paid (auto), Balance (auto).
- **GRN Lines:** Line ID, GRN ID, Purchase Line ID, Item Code, Description, Supplier item code, Expected pcs / set, Expected No. of Sets, Received pcs / set, Received No. of Sets, Damaged Qty (**pieces**), **Stickered (typed dropdown Done / Left)**, Stickered Qty, Put Away (bool), Put Away By, Put_Qty (pieces), Location. One Location per line: split into two lines for two locations.
- **Stock Movement** (ledger, **add-only**): Move ID, Ref ID (GRN line / SO line / Audit count), Moved At, Item Code, **Qty (typed DOUBLE, signed pieces)**, **Location (typed dropdown of Locations)**, **Type (typed dropdown: Opening / Put-away / Dispatch / Audit adj.** — with the dot), Moved By.
- **Audit Counts:** Count ID, Counted At, Item Code, Description, Location, Counted Qty, Photo, Counted By, Status (Pending/Approved/Rejected), Product Type, Material, Size, Colour, Brand, Reviewed By, Reviewed On; formulas System Qty (auto) (= movement sum for item+location), Variance (auto).
- **Products** (~4,000 rows): Item Code, Tally Name, Stock Group, Catalog Name, Pcs / Set (defaults to 1), List Price, Customisation, Product Type, Material, Size, Colour, Brand, HSN, GST_Pct (fraction, e.g. 0.12), Photo, Photo_link, Verified (bool), Verified_By, Verified_On; formulas: Item label, Books Qty, **Warehouse Qty** (= Σ movements), Warehouse Location, **Reserved** (open SO sets × pcs), **On Order** (open PO sets × pcs, Sent POs only), **Available** (= Warehouse − Reserved), Last Purchase Rate, Last Supplier. *Reserved, On Order, Warehouse Qty are in pieces.*
- **Payments:** Payment ID, **Payment Date (typed DATE `dd/mm/yyyy`)**, **Direction (dropdown Received / Paid)**, **Ref Type (dropdown Order / GRN)**, Ref ID, **Amount (typed DOUBLE)**, **Mode (dropdown Cash / UPI / Bank Transfer / Cheque / Other)**, Reference No., Entered By, Notes; formula Ref No. (auto). *Direction: Received for orders, Paid for GRNs. A part payment is another row.*
- **Stock by Location** (formula view), **Data_Dictionary**, plus screen tabs (Home, Sales, Buy, Store, Product Master, Accounts — forms/views, not data).

### 6.3 The (auto) formulas — what the code *assumes* they do

We cannot see the formulas, only their documented intent and sample outputs. The mock re-implements: Stage (auto), Open Sets (auto) for SO and PO lines, Warehouse Qty/Reserved/On Order/Available, Audit System Qty/Variance, Requirements Stage, Customer (auto), Lines (auto), Value incl. GST (auto) (= Σ pcs × sets × price × (1+GST)). **The Accounts code deliberately does not depend on Received/Balance/Pay Status (auto)** — it computes received/balance from `Payments` itself.

---

## 7. Business workflows by department

### 7.1 Sales (owner's code; context only)
Leads → Requirements (reorder demands for a customer or lead) → Quotations → Orders (quote converts to order; PDFs via Drive). Boards: Leads, Requirements, Make Quote, Orders. `Make Quote` (`QuoteBoard.html`, `App.docForm`) is where the open bug is (§16).

### 7.2 Procurement
1. **Purchase queue** (registered as board name `requirements` so the Client's tab bubble/bell work): requirements with blank Status = *awaiting decision*. Manager **Accepts** (a modal asks for the supplier — picking the supplier *is* the confirmation; an unknown supplier can be added on the spot via `sup.save`) or **Denies**. Accepted-but-not-ordered rows are highlighted; "Make PO" starts a PO from them. **Stock top-up** (`pq.addStock`) adds a requirement with no customer (no supplier field; waits for a decision like any other).
2. **Purchase orders:** a draft PO builder (drawer) — supplier, delivery date, payment terms, lines; lines can come from accepted requirements **or be any product / free-text new item**. Save draft / **Save & send**. Sending: `Status='Sent'`, makes a PDF in Drive, **creates the GRN header + one GRN line per PO line (`Yet to receive`)** for the warehouse. Removing a draft line (or deleting the draft) puts its requirement back in the queue.
3. **Suppliers:** add/edit.

### 7.3 Warehouse
- **Receiving:** open a GRN, count (type pieces or sets), damaged pieces, stickered (+ qty), invoice no/date, cartons, then **Mark as received** (sets `Received Date`, `Status`). Items that arrived but weren't on the PO can be added.
- **Put-away:** per received line, choose location + pieces; partial put-away **splits** the line (keeps PO `Open Sets` totals right); writes a `Put-away` movement (+pieces).
- **Dispatch:** follows the sheet's Stage: pick (`Pick From`, `Picked`) → pack (`Packed`) → **book transport** (`Transport Booked`, `Transporter`, `LR No.`) → dispatch (partial shipments; negative `Dispatch` movements; stock guard refuses if the ledger doesn't hold the pieces at the pick location; sets `Status='Dispatched'` when nothing is left).
- **Stock:** read-only ledger view per item/location (+history), "New item" (`prod.create`).
- **Stock audit:** count a shelf (item, location, pieces, photo) → `Pending`; Accounts reviews.
- **Stock Movement is read-only for people** — written only by put-away, dispatch, approved audit.

### 7.4 Accounts
- **Order receipts:** *To invoice* (no Invoice Amount yet; dispatched first) → enter Tally voucher no., invoice date, invoice amount (default = order value), due date (suggested from payment terms) → sets Tally Voucher No./Invoice Date/Invoice Amount/Due Date and `Status='Billing done'` (unless Dispatched/Cancelled). *Receive money* → `Payments` row (Received/Order). *To collect* (invoiced, balance > 0.5; overdue first), *Paid*, *All*. `Payment Cleared On` is kept in sync (date of last receipt when fully paid; cleared if it becomes unpaid). Over-balance needs confirmation; cancelled orders accept only a *refund* (opposite direction).
- **Purchase receipts:** per GRN — *To bill* (received, no Bill Amount) → Bill Amount + Tally purchase voucher no. (+ supplier invoice no/date); shows PO value, value of goods received, damaged pieces; *Pay supplier* → `Payments` row (Paid/GRN); advances allowed before receipt/billing; due = supplier invoice date (or received date) + credit days from the PO payment terms.
- **Payments:** ledger (filters, totals, CSV download), *Correct* (date/amount/mode/ref/note; not the target), delete = Admin only.
- **Stock audit:** approve/reject counts (`audit.review`; Accounts + Admin). Approving writes an `Audit adj.` movement for the difference.

### 7.5 Admin
Overview (cards + "needs attention" exceptions + sheet check), Products (master data, bulk "Mark as checked", new item), Users (add/edit/remove with guards), Locations (add/edit; code immutable).

---

## 8. Server API reference (all routes)

Format: `route` — role(s) — lock? — purpose. Roles: S=Sales, P=Procurement, W=Warehouse, A=Accounts, Ad=Admin (Admin always passes); `*` = anyone signed in; "Admin only" = `[]`.

### Shared / Sales (owner's)
`boot *`, `parties *`, `products *`, `photo.upload S(lock)`, `leads.list/create/update`, `req.list/create`, `quote.nextNo/openReqs/create/createOrder/list/get/pdf/lose/reopen`, `orders.list/get/convert/pdf/cancel`.

### Procurement (`Procurement.gs`, role P)
`sup.list`, `sup.save(lock)`, `pq.list`, `pq.counts`, `pq.decide(lock)` (decision Accepted/Denied/'' + supplierId; accepting needs a supplier unless the requirement already has one), `pq.setSupplier(lock)`, `pq.addStock(lock)`, `po.list`, `po.get`, `po.save(lock)` (create/edit draft; `send:true` also sends), `po.send(lock)`, `po.delete(lock)` (drafts only), `po.pdf(lock)`.

### Warehouse (`Warehouse.gs`)
`loc.list *`, `wh.counts W`, `grn.list/get W`, `grn.receive W(lock)`, `put.list W`, `put.do W(lock)`, `stock.list/history W`, `prod.create W(lock)`, `audit.list W+A`, `audit.create W(lock)`, **`audit.review A (lock)`** (+Admin), `disp.list/get W`, `disp.save W(lock)` (pick/pack), `disp.book W(lock)`, `disp.dispatch W(lock)`.

### Accounts (`Accounts.gs`, role A)
`acc.counts`, `ord.list`, `ord.get`, `ord.bill(lock)`, `bill.list`, `bill.get`, `bill.save(lock)`, `pay.add(lock)`, `pay.list`, `pay.save(lock)`, **`pay.delete` Admin only (lock)**.

### Admin (`Admin.gs`, all Admin only)
`adm.overview`, `adm.check`, `usr.list`, `usr.save(lock)`, `usr.delete(lock)`, `loc.admin`, `loc.save(lock)`, `prd.list`, `prd.save(lock)`, `prd.verify(lock)`.

Argument/response shapes are documented in the doc-comment above each function in the `.gs` files (every route function has an `args:` comment). The front-end call sites are the best usage examples.

---

## 9. Server building blocks and conventions

- **`U`** (owner's `Util.gs`): `s` (trimmed string), `low`, `pad`, `toNum` (handles commas/₹/%), `frac` (GST/discount as a fraction: 0.12 / 12 / "12%"), `newId(takenSet)`, `idSet(rows, header)`, `isoToday()`, `dateFromIso(iso)` (→ Date at local midnight, or null), `today()`, `addDaysIso`, `iso(v)` (Date / `dd/mm/yyyy` / `yyyy-mm-dd` → `yyyy-MM-dd`, else ''), `inr`, `esc`, `firstWord`. We also use `U.r2/U.r4` (rounding) and `U.idSet`.
- **`Items`** (`Items.gs`): `map()`, `get(code)`, `pcs(code, fallback)`, `name(code, desc)`, `raw(code)` (sheet's stored value: number vs text), `dropCache()`. Product record: `{code,name,group,pcs,gst(fraction),books,wh,reserved,onOrder,avail,lastRate}`.
- **`Rows`** (`Items.gs`): `group`, `by`, `nextNo`, `wipe(key,row)`, `sets(n)` (8-decimal rounding so a part-set × pcs gives whole pieces), `serial(iso)` (**date → Sheets serial number**), `stickerOut(bool)`/`stickerIn(v)` (`Done`/`Left`), `byName`, `matches(hay, q)` (all tokens), `ids`.
- **`Ledger`** (`Warehouse.gs`): `balances()` (`{'item|loc': pieces}`), `at`, `where`, `total`, `add(entries, user)` (the **only** writer of Stock Movement; requires the item to exist in Products).
- **Pcs vs sets:** UI lets people type pieces or sets; the sheet stores sets (fractions allowed) for lines and pieces for the ledger.
- **Statuses read defensively:** e.g. GRN received = `Status === 'Received'` **or** `Received Date` non-blank; orders' stage uses the sheet's `Stage (auto)` and falls back to computing it.
- **Money rules (Accounts):** order basis = `Invoice Amount` if > 0 else `Value incl. GST (auto)` else computed from lines; received = Σ Payments where direction is the natural one minus opposite (refund); tolerance `0.5` rupee for "paid"; amounts rounded `U.r2`.
- **Error handling:** server functions `throw new Error('plain sentence for an office manager')`; `api()` converts to `{ok:false,error}`; UI shows a red toast (10 s).
- **Atomicity:** validate everything first, then write; put-away undoes its split row if the ledger write fails.

---

## 10. Front end

### 10.1 Client.html (owner's) — the `App` object
Key API (all boards use it): `App.h(tag, attrs, ...children)` (DOM builder; attrs: `class`, `text`, `on<event>`, `value/checked/disabled/…` as properties, others as attributes), `App.clear`, `App.byId`, `App.icon(name,size)`, `App.api(name,args)` (Promise), `App.toast(msg, 'ok'|'err')`, `App.run(btn, fn)` (disables button, turns errors into toasts), `App.modal({title, body, buttons})`, `App.confirm`, `App.drawer({title, wide, body, footer})` → `{open, close, el, body}`, `App.menu`, `App.badge(text, kind)`, `App.field(label, control, {required, hint, cls})`, `App.seg({options,value,onChange,cls})` (segmented/chip filters), `App.kind`, `App.table(cols, rows, emptyText)` (cols `{h, cls, f(row)}`), `App.combo({items,label,sub,…})` (type-ahead picker), `App.qty({cls, perSet, onChange})` (**linked Pieces ↔ Sets boxes**; returns `{pcs, sets, get(), setSets(n), refresh(), clear()}`), `App.qtyOf`, formats `App.inr/fmtDate/fmtShort/fmtQty/num/r2/r4/today/initials`, `App.products()/productPicker/findProduct`, `App.parties()`, `App.refreshAttn/setAttn/onAttn` (tab bubbles + bell, Sales-centric), `App.register(name, label, {init, show})`, `App.go(name)`, `App.start()`.
- **Board pattern:** each board is an IIFE in a `<script>` that calls `App.register('name', 'Tab label', { init(root), show(params) })`. `init` builds DOM once; `show` (re)loads data. Boards for a department are only included if the department's `includes` lists them; each Sales-only/Proc-only board checks `PW.active('<dept>')` and returns early otherwise.

### 10.2 DeptShell.html (ours) — `PW.*`
Loaded right after Client on **every** page (incl. Sales). It wraps `App.go` (breadcrumb "Dept / Tab" for non-Sales), `App.icon` (adds icons: purchase, suppliers, receiving, putaway, dispatch, stock, audit, orderpay, billpay, payments, overview, users, products, locations, truck, pdf), `App.refreshAttn` (per-department tab badges: procurement → `pq.counts`; warehouse → `wh.counts`; accounts → `acc.counts`; admin → noop (Overview sets its badge)). Helpers: `PW.active`, `PW.badge`, `PW.suppliers/locations` (cached lookups), `PW.supplierPicker/locationPicker`, `PW.select`, `PW.check`, `PW.chipCounts`, `PW.search` (debounced search box), `PW.rs` (Rs formatting), `PW.stat` (number card), `PW.deptUrl`, `PW.drawerTitle`, `PW.csv`, `PW.dueFrom` (payment-terms parser, mirrors the server), `PW.payDialog` (record/correct a payment), `PW.loadError`.

### 10.3 Styles
`Styles.html` is the owner's design system ("Studio" look: CSS variables, `.card .chead .step .grid .field .toolbar .seg .chips-s .count .tablewrap table.t .badge .note .stat(s) .drawer .modal .line .line-nums .dock .combo …`). `DeptStyles.html` only adds a few classes (`pw-*`), hides the Sales customer/lead search (`#gs`) on non-Sales pages, and sets `.drawer table.t{min-width:0}` (the base `table.t` has `min-width:900px`). Mobile: `@media (max-width:760px)` turns tables into stacked cards using each cell's `data-l` label.

### 10.4 Index.html
Template using `cfg` (scriptlets `<?= ?>`, `<?!= ?>`). Title/chip/menu from cfg; one `<section class="board" id="board-<name>">` per board; `window.DEPT`; includes; inline check for boards that failed to register; `App.start()`.

---

## 11. Roles, departments and access

| Role | Opens | Can call |
|---|---|---|
| Admin | all 5 departments | everything (Admin always passes role checks) |
| Sales | `sales` | Sales routes + `*` routes |
| Procurement | `procurement` | Procurement routes + `*` |
| Warehouse | `warehouse` | Warehouse routes (+ `audit.list`, `audit.create`) + `*` |
| Accounts | `accounts` | Accounts routes + `audit.list` + `audit.review` + `*` |
| anything else | nothing — "Access denied: your role (…) cannot use this app." | |

- Roles are authoritative **server-side** (`api()` check); the UI hiding is cosmetic.
- Audit review is Accounts' job (Admin also can). Warehouse counts. (Changed from an early design where Accounts opened the Warehouse page.)
- Admin-only: users, product master, locations (admin screen), payment delete.

---

## 12. Typed-column rules

Many columns are Google Sheets **"table" typed columns** (DATE, DOUBLE, DROPDOWN, PEOPLE_CHIP) — see §6.2 for which. Consequences, all learned the hard way in production:

1. **"You can't set the number format of cells in a typed column."** Writing a JavaScript `Date` through `Db.append/update` makes `Db` try `setNumberFormat('dd/mm/yyyy')`, which a typed column refuses (the owner's `Db.setFormat_` swallows this **only if its try/catch is intact**, and the Date value itself then often fails). **Fix: write typed dates as Sheets serial numbers** via `Rows.serial('yyyy-mm-dd')`; the column displays it in its own format. Done for: `Req Date` (Procurement stock top-up), `Dispatch Date` (SO line), `Payment Date`, `Invoice Date`, `Due Date`. **Still needed in the owner's own Sales code:** `ReqApi.create` writes `'Req Date': U.today()` (a Date) — see §15.
2. Untyped date columns (e.g. `Need By`, `Payment Cleared On`, GRN `Invoice Date`/`Received Date`, Purchase dates, `Moved At`) accept `Date` objects (Db sets `dd/mm/yyyy` format).
3. **Dropdown columns need exact allowed strings:** `Stickered` = `Done`/`Left` (not TRUE/FALSE); Stock Movement `Type` = `Audit adj.` (**with the dot**); `Payments.Direction`/`Ref Type`/`Mode`; `Sales Orders.Status`; `GRN.Status`; `Requirements.Status`/`Req for`.
4. Reading a typed DATE cell returns a real `Date` (use `U.iso`). `AcctApi.iso_` also accepts a plain serial number.
5. Numbers typed DOUBLE must be numbers (not strings).

The mock sheet (§13) enforces these rules (refuses Date objects in typed DATE columns, number formats on typed columns, off-list dropdown values) and returns Dates when reading typed DATE cells.

---

## 13. Test harness

Folder `harness/` (plain Node, no build). It **fakes the Apps Script runtime and the Sheet** and runs the real `.gs` files in a Node `vm`, then drives the real HTML in headless Chromium with a `google.script.run` shim.

**Requirements:** Node 20+; `playwright` resolvable (`NODE_PATH` set globally in the dev container; Chromium at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do **not** run `playwright install`).

| File | Purpose |
|---|---|
| `mock.js` | `createEnv()` → `{ ss, api(name,args,email), raw, tbl(name,headerRow), ctx, state }`. Seeds a sheet with all tabs/headers, 6 users (one per role + a bad role), products, suppliers, customers, one open sales order with 2 lines, requirements. Re-implements the (auto) formulas in `Spreadsheet.recalc()`. Typed-column enforcement in `TYPED`/`Sheet.check`. Loads, in order: the owner's `Db, Util` + repo `Config` + owner's `Lookups, RequirementsApi, LeadsApi, QuotesApi, OrdersApi, Pdf` (from `reference/original-sales/`), `stubs.gs` (fixes `QuoteApi.nextNo`), then repo `Items, Procurement, Warehouse, Accounts, Admin, Main`. Per-call `fresh()` resets per-execution caches like a real Apps Script run. |
| `test.js` | **177** server checks: roles, suppliers, purchase queue, PO lifecycle, receiving, put-away (split), stock, dispatch (partial + stock guard), audit, product cache, counts |
| `test2.js` | **230** server checks: Accounts (billing, receipts, overdue, refunds, advances, bills, ledger, delete), Admin (users with last-admin rules, locations, products, overview, sheet check), role walls, department config |
| `serve.js` | tiny HTTP server (port 8765): `/page/<dept>?as=<email>` renders the real `Index.html` + boards (templating like Apps Script) with a shim for `google.script.run`; `/api` calls the mock; `/reset` re-seeds; `/state?sheet=` dumps a sheet. Applies `Main.pickDept` like `doGet`. `?broken=<Board>` strips a board's `<script>` to test the missing-board toast. |
| `ui.js` (30), `ui2.js` (25), `ui3.js` (71) | Playwright UI suites: Procurement flow, Warehouse flow, Accounts flow, Admin flow, phone width, role walls. Screenshots go to `harness/shots/` (git-ignored). |
| `probe-quote-typing.js` | probes the Make Quote line inputs (type 20 into Pcs/set, Total pcs, Sets, List) — **passes in the harness** (see §16) |
| `stubs.gs` | one-line stub for `QuoteApi.nextNo` |

**Run:**

```bash
cd harness
node test.js && node test2.js            # server logic, fast (seconds)
node serve.js &                          # then, in another shell:
curl -s localhost:8765/reset; node ui.js
curl -s localhost:8765/reset; node ui2.js
curl -s localhost:8765/reset; node ui3.js
```

(All of them pass at the time of writing: 177 + 230 + 30 + 25 + 71.)

**Limits of the harness:** it is a *model* of Google's behaviour. It does not run Drive/PDF/Lock/Cache for real, doesn't model sheet recalculation lag, the sandboxed iframe, Windows/Chrome quirks, or the owner's *live* Sales files. `reference/original-sales/` are what the owner pasted earlier; where they differ from the live project (§16) the harness can't see the difference.

---

## 14. History

Chronological, with the lessons:

1. **Scoping.** Read the sheet via the Sheets API (schemas, typed columns via `sheets.tables`, `Data_Dictionary`). Mis-step: first wrote `Db.gs/Shared.gs/Code.gs` before seeing the owner's code; they would have overwritten the owner's `Db`/`boot`. Deleted and rebuilt on the owner's real `Db/U/Main`.
2. **Procurement + Warehouse built** (commit `89e9762`), verified with the mock (158 checks then) and Chromium.
3. **Slow/unresponsive PO form** (`9215623`): ~26 sheet reads per open. Added the `Items` cache, opened the drawer instantly and filled it in, error toasts. Also: `</script>` inside a JS string/comment ends the script — never write the literal closing tag in a board file (use `'<' + '/script>'`). Also added the missing-board toast after the owner pasted a board without its opening `<script>`.
4. **Purchase queue changes** (`1a4a3f3`): the owner asked for the supplier to be chosen in a pop-up on Accept (not a field), a "new supplier" option, and highlighting of accepted-not-ordered rows.
5. **First production error: "You can't set the number format of cells in a typed column"** on Stock top-up (`482cc23`) → §12. Same bug existed for Dispatch Date; also fixed `Stickered` Done/Left and `Audit adj.`.
6. **Accounts + Admin built** (`88bea54`): see §7. Accounts moved from "Warehouse page, audit tab only" to its own page. Combined paste file → v4.
7. **After delivery the owner reported (screenshots):**
   - Same typed-column toast on the **Sales** Requirements Quick add → the owner's own `ReqApi.create` line (§15 #1).
   - Wanted typed numbers instead of up/down arrows in the Pieces box → suggested replacing the `type:'number'` in `App.qty` with `type:'text'` (§15 #2).
   - **Make Quote line inputs won't accept typed numbers** → §16 (open).

---

## 15. Pending hand edits

Edits the owner was told to make in **their own files** (we can't see whether they did; ask):

1. **`RequirementsApi.gs` → `ReqApi.create`:** change
   `'Req ID': id, 'Req Date': U.today(), 'Salesman': user.email, 'Req for': type,`
   to
   `'Req ID': id, 'Req Date': Rows.serial(U.isoToday()), 'Salesman': user.email, 'Req for': type,`
   (requires `Items.gs` with `Rows.serial`). Fixes the typed-column toast on Sales Quick add. Verified on the mock only.
2. **`Client.html` → `App.qty` → `box()`:** replaced
   `type: 'number', min: 0, step: 'any', inputmode: 'decimal'` with `type: 'text', inputmode: 'decimal', autocomplete: 'off'` so the Pieces/Sets boxes have no spinner. **Side effect:** letters can be typed; `App.num` ignores them. `QuoteBoard`'s own `numInput()` (Pcs/set, List, Disc %, Offer, GST %) is still `type:'number'`. Alternative offered (not confirmed applied): revert to `type:'number'` and hide spinners with CSS in `Styles.html`:
   `input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}`
3. Optional: the five `OrdersBoard.html` edits in `OrdersBoard-stage-fix.txt`.
4. `Db.gs` must keep `setFormat_` with its try/catch.

---

## 16. OPEN BUG

### 16.1 Symptom (as reported, with 2 screenshots)
On the **Sales → Make Quote** screen, in "2 Items → Item 1", the owner **cannot type numbers into the quantity/number boxes**: *Pcs / set, Total pcs, Sets, List Rs/pc, Disc %, Offer Rs/pc, GST %*. The box is focused (blue ring, caret visible), but typed digits don't appear. In one screenshot, "Pcs / set" is a number input with spinner arrows (focused, empty, caret) and "Total pcs"/"Sets" show their placeholders ("Pieces", "Sets"). Items seen: `SERVING SPOON WD HC SP11` (code 105191) and `FNS MONTAVO VERONA TEA SPOON` (code 100751) — both "in stock: 0 pcs · no list price on file – enter the rate", no picture. Customer/lead = a **Lead** ("Litmus"). The bottom bar says "Item 1: enter the quantity (pieces or sets)." Deployed on the `/dev` URL (`script.google.com/macros/s/…/dev`), Chrome on Windows, DevTools open.
- **Console:** no red errors. Only: *"An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing"* (normal for Apps Script) and repeated *"Net state changed from IDLE to BUSY"* lines from a Google script (normal).
- On the **Requirements** tab "Quick add" (same `App.qty` box), the owner **could** type pieces (typed `9`; sets updated to `9`). So `App.qty` itself works there.
- The owner says the problem is with "fields which have number format (they just have the up and down arrow)", but an earlier screenshot showed the same inability in **Total pcs, which is a text box after our Client edit** (§15 #2).

### 16.2 What was tried
- Reconstructed the owner's pasted `QuoteBoard`, `Client`, etc. into `reference/original-sales/` and ran the **real Make Quote screen** in headless Chromium (`harness/probe-quote-typing.js`) with items like the owner's (blank Pcs/Set, 0 stock, no price). Typing `20` into Pcs/set, Total pcs, Sets and List **works** in every box, with both the original `App.qty` (`type:number`) and the `type:text` variant. No console errors.
- Read every `keydown/keypress/beforeinput/wheel/addEventListener` in the pasted `Client.html` and `QuoteBoard`: only Enter (save), Escape (close modals/menus), Ctrl+K (focus search), and the combo's own arrows/Enter/Escape/Tab handlers. Nothing swallows digits.
- Note the harness shows the Pcs / set box **pre-filled with `1`** for an item with blank Pcs/Set (`productFields` falls back to `1`), whereas the owner's screenshot shows it **empty**. **This is the strongest clue that the owner's live `QuoteBoard.html` (or `Client.html`) differs from the pasted copy we have.**

### 16.3 Hypotheses, ranked
1. **The owner's live `QuoteBoard.html` / `Client.html` differ from the reference copies** (they may have edited them, or applied our Client edit incorrectly — e.g. wrong `box()`, a duplicated `App.qty`, or a stray character). → *Get the live files; diff against `reference/original-sales/`.*
2. **A browser extension or environment effect** interfering with inputs in the sandboxed iframe (password manager, autofill, Grammarly-type tools, number-formatting extensions). The Requirements tab working argues against a pure environment cause, but extensions can act per-field. → *Test in Incognito with extensions disabled, and in another browser.*
3. **Focus/keyboard capture on this screen only** (e.g. an invisible overlay such as an open combo list, or a stuck capture-phase handler). → *Use the event-logging snippet below to see whether `keydown` reaches the input and whether it is `defaultPrevented`.*
4. **Cached old code:** `/dev` serves the latest *saved* code but the browser may cache; or the owner is testing `/exec` without a new version. → hard refresh; confirm deployment version.
5. An input handler that *immediately rewrites the value* (e.g. `syncUi(l)` setting `u.pcs.value = l.pcs` from stale state). Not present in the pasted code; possible in a newer live version.

### 16.4 Next steps for you
1. Ask the owner to **paste the live `QuoteBoard.html` and `Client.html`** (or at least `numInput`, `addLine`, `syncUi`, `productFields`, and `App.qty`); diff against `reference/original-sales/`.
2. Ask: does it fail on **every** item/line (including a freshly added "+ Add item" line) or only some? Can they type in **Valid until**, **Customer/lead**, and the Requirements Quick add right now?
3. Have them run this in the DevTools console **with the context selector switched to the inner app frame** (not `top`), then click Pcs/set and press `2`:

```js
['keydown','keypress','beforeinput','input'].forEach(function (t) {
  document.addEventListener(t, function (e) {
    console.log(t, 'key=' + e.key, 'data=' + e.data, 'defaultPrevented=' + e.defaultPrevented,
                'target=' + (e.target.tagName || '') + '.' + (e.target.className || ''), 'value=' + (e.target.value));
  }, true);
});
```
   - No `keydown` logged → focus/keyboard isn't reaching the page (extension, OS/IME, another frame).
   - `keydown` logged with `defaultPrevented=true` → some handler cancels it (find which: search for `preventDefault` in the live files).
   - `input` logged but `value` is empty afterwards → something rewrites the value.
4. Test in Incognito/another browser/another machine.
5. If a live-file difference is found, reproduce by dropping their `QuoteBoard.html` into `reference/original-sales/` and running `harness/probe-quote-typing.js`.

---

## 17. Verified vs not verified

**Verified locally (mock + Chromium):** all server logic in §7–§9 (roles, PO lifecycle, receiving, split put-away, dispatch incl. partial/stock guard, audit, billing, receipts, refunds, advances, overdue maths, ledger, users/locations/products rules, overview, sheet check), typed-column rules, the department pages for every role at desktop and 390 px width, Sales page still loading with `DeptShell`.

**Not verified (needs the real deployment):** PDF creation and Drive folders (PO PDF, audit photo), `LockService`, real `CacheService` chunking, real sheet recalculation of `(auto)` formulas (we modelled them), `Session.getActiveUser` behaviour per deployment type, sheet performance on the real 4,000-row Products tab (Items cache mitigates; Admin Overview reads ~12 tabs), the owner's live Sales files, any real-browser input quirk (§16).

**Known not-built:** GST/e-invoice generation, bank reconciliation, credit notes (record a refund or correct the bill instead), deleting locations/users' history, Tally import, a working **bell** outside Sales/Procurement (the bell only knows Sales-style items; tab bubbles are used instead).

---

## 18. Assumptions and judgement calls

Confirmed by the owner: Damaged Qty is in **pieces**; PO Rate is **Rs/piece excl. GST**; a **GRN is created when a PO is sent**; **dispatch requires transport booked first**; a PO may contain items that are not in the requirement list.

Assumed (tell the owner if wrong):
- Billing sets `Sales Orders.Status = Billing done`; dispatch does not wait for billing.
- Invoice needs voucher no + date + amount; supplier bill needs voucher no + amount.
- Receipts are `Received/Order`, supplier payments `Paid/GRN`; refund = opposite direction on the same reference.
- Payment and invoice dates cannot be in the future.
- Payment terms are parsed from text (`N days credit`, `N months credit`, `advance`, `After delivery`, `cash`); anything else → no suggested due date (orders: can be typed).
- A balance ≤ Rs 0.5 counts as paid.
- Only Admin edits users/products/locations; only Admin deletes payments.
- Line quantities stored in sets with up to 8 decimals; ledger in pieces.
- Accounts needs `loc.list` and `products` (both `*` routes) for the audit board.

---

## 19. Debugging playbook

- **Any "role cannot do this":** check `Users` role spelling; `Main.methods()` entry roles; `api()` error text.
- **"Unknown action: x":** the front end calls a route not in `Main.methods()` — usually an old `Main.gs` pasted, or a new `.gs` file missing (`AcctApi`/`AdminApi` are referenced from `Main.methods()` → `ReferenceError` if `Accounts.gs`/`Admin.gs` weren't pasted; that breaks **every** call, including Sales).
- **Whole app dead after a paste:** a `.gs` syntax error anywhere (Apps Script loads all files into one namespace) or a duplicate global name. Run `runDiagnostics` in the editor.
- **A tab missing / code printed on the page:** a board file lost its first/last line (see §4).
- **"typed column" / "Invalid value" toasts:** §12.
- **Toast "Column 'X' was not found on tab 'Y'":** header renamed in the sheet; `runDiagnostics` / Admin → Run sheet check lists missing columns (`REQUIRED_HEADERS`).
- **Stale numbers:** `Items` cache (≤120 s; dropped after writes) and sheet formula recalc lag.
- **Reproduce a server bug:** `harness/mock.js` + a small script: `const E = require('./mock').createEnv(); E.api('route', {args}, 'email@x.com')`; inspect `E.tbl('Sheet Name').rows`.
- **Reproduce a UI bug:** `node serve.js`, open `http://localhost:8765/page/<dept>?as=<email>` in Playwright (see `ui3.js` for patterns); screenshots in `harness/shots/`.
- **Page-level debugging in the owner's browser:** open DevTools → Console, switch the context dropdown from `top` to the app's inner frame, then `App`, `PW`, `App.boot` are available to inspect.
- **Never** write the literal closing script tag inside a board's JS (string or comment).
- **Never** write `(auto)` columns; never `appendRow`; never write a `Date` into a typed date column (use `Rows.serial`).

---

## 20. Glossary

- **GRN** — Goods Receipt Note: one per PO delivery. **PO** — Purchase Order. **SO** — Sales Order (same ID as its quote). **Req** — a requirement: an item someone (customer, lead, or stock) needs.
- **Set** — the standard packing unit; **Pcs / Set** — pieces in a set. Quantities on lines are in sets; the stock ledger is in pieces.
- **Put-away** — storing received goods in a location. **Pick/Pack/Book transport/Dispatch** — outward steps.
- **Audit count** — a physical count of an item at a location; approval adjusts the ledger by the difference (`Audit adj.`).
- **Tally** — the company's accounting software (vouchers are created there; the app records the voucher number). **HSN** — GST product classification code.
- **LR No.** — lorry receipt number from the transporter.
- **Typed column** — a Sheets "table" column with a data type/dropdown (§12).
- **(auto) column** — a formula column; never written by the app.
- **`PW:`** — marker for lines we added inside the owner's `Config.gs`/`Main.gs`.
- **Replica project** — the separate Apps Script project the owner pastes into and tests, instead of production.
