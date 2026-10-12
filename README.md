# Hospi Ops: Procurement, Warehouse, Accounts and Admin

Adds four departments to the existing Sales app. Same web app, one URL per department:

| URL | Who | Tabs |
|---|---|---|
| `…/exec` or `…/exec?dept=sales` | Sales | Leads, Requirements, Make Quote, Orders (unchanged) |
| `…/exec?dept=procurement` | Procurement | Purchase queue, Purchase orders, Suppliers |
| `…/exec?dept=warehouse` | Warehouse | Receiving, Put-away, Dispatch, Stock, Stock audit |
| `…/exec?dept=accounts` | Accounts | Order receipts, Purchase receipts, Payments, Stock audit (review) |
| `…/exec?dept=admin` | Admin | Overview, Products, Users, Locations |

`Users` tab roles decide who can open what: **Admin** opens all five; **Sales / Procurement / Warehouse / Accounts** open their own department. Someone who types another department's URL simply gets their own. The department menu in the header links between the departments a person may open.

> Change from the first version: **Accounts now has its own page.** Before, an Accounts user opened the Warehouse page and saw only *Stock audit*. They now open `?dept=accounts`, which still has *Stock audit* (reviewing counts) and adds the money screens. The Warehouse page is for the Warehouse role (and Admin) only.

## Files

New server files: `Items.gs`, `Procurement.gs`, `Warehouse.gs`, `Accounts.gs`, `Admin.gs`.

New HTML files: `DeptShell.html`, `DeptStyles.html` and the boards

- Procurement: `ProcQueueBoard`, `PurchaseOrdersBoard`, `SuppliersBoard`
- Warehouse: `ReceivingBoard`, `PutAwayBoard`, `DispatchBoard`, `StockBoard`, `AuditBoard` (also used by Accounts)
- Accounts: `OrderReceiptsBoard`, `PurchaseReceiptsBoard`, `PaymentsBoard`
- Admin: `OverviewBoard`, `ProductsBoard`, `UsersBoard`, `LocationsBoard`

Changed (your files, with the edits marked `PW:` in the code):

- `Config.gs`: roles, `DEPARTMENTS` (five), `PAYMENT_MODES`, PO/audit Drive folder settings, the new tables in `TABLES` and `REQUIRED_HEADERS` (including `Payments`).
- `Main.gs`: `doGet(e)` picks the department; `api()` checks each action's roles (an action with no roles is a Sales action; `'*'` = everyone; an empty list `[]` = Admin only; Admin always passes); `methods()` merges the new actions; `boot` skips the Sales-only quote number for other roles and carries the payment modes.
- `Index.html`: one template for all departments (title, department chip, menu, board sections and file list come from `Main.deptConfig`).

**Not touched:** `Client.html`, `Styles.html`, the four Sales boards, and every other Sales `.gs` file. `DeptShell.html` loads right after `Client.html` and only wraps `App.go` (breadcrumb), `App.icon` (new icons) and `App.refreshAttn` (badges) on the non-Sales pages.

## Install

1. Copy the new files into the Apps Script project and replace `Config.gs`, `Main.gs`, `Index.html`, `DeptShell.html`, `DeptStyles.html` and `AuditBoard.html` with the versions here (if you changed `Config`/`Main`/`Index` since, re-apply the `PW:` edits instead).
2. Do not copy the old kanban script (the file with `SHEET_NAME = 'Sales_Leads'`, `onOpen`, `showDashboard`) into the replica. It opens the `Index` template without `cfg`, so it no longer works with the shared page, and the Sales app does not use it.
3. In the `Users` tab give people their role: `Procurement`, `Warehouse`, `Accounts`, `Sales`, `Admin` (spelled exactly). From now on Admin can also do this on the **Users** tab of the Admin page.
4. Optional but recommended: make one shared Drive folder each for PO PDFs and audit photos and paste the IDs into `PO_PDF_FOLDER_ID` / `AUDIT_PHOTO_FOLDER_ID`.
5. Run `runDiagnostics` once (or press *Run sheet check* on the Admin Overview). It checks every tab and column the app uses, including `Payments` and the billing columns on `Sales Orders` and `GRN`.
6. Deploy as before (Execute as: user accessing the web app). Redeploy a new version.

## How it works

### Procurement

Sales requirements arrive in the Purchase queue (blank status). The purchase manager accepts or denies each one (`Requirements.Status`). *Accept* opens a pop-up where the supplier is chosen (or a new one added on the spot); choosing the supplier is what confirms the acceptance. Accepted items that are not on a PO yet are highlighted, and *Make PO* puts them on one. A PO is a draft until *Send*: sending sets `Status = Sent` (this is what makes it "On Order"), makes the PDF, and opens the goods receipt (GRN + one line per PO line, "Yet to receive") for the Warehouse. Removing a line from a draft, or deleting a draft, puts its requirement back in the queue. *Stock top-up* lets Procurement raise a need with no customer behind it.

### Warehouse

**Inward.** *Receiving*: count the delivery (pieces or sets), note damaged pieces, sticker, then *Mark as received* (this fills `Received Date`). An item that arrived but was not on the PO can be added. *Put-away*: choose a location and pieces per line; part put-away splits the line so the PO's `Open Sets` stays correct.

**Outward.** *Dispatch* follows the sheet's own `Stage (auto)`: pick → pack → **book transport** → dispatch (partial shipments allowed; the order's `Status = Dispatched` when nothing is left).

**Stock Movement is read-only for people.** The app writes it in exactly three places: put-away (+), dispatch (−), approved audit (`Audit adj.`). A dispatch is refused if the ledger does not hold the pieces at the pick location.

**Audit.** Warehouse counts a shelf (item, location, pieces, optional photo). Accounts approves (the ledger is adjusted by the difference) or rejects (nothing changes).

### Accounts

**Order receipts.** One row per sales order. *To invoice* lists orders that have no invoice yet (dispatched ones first). Make the invoice in Tally, then open the order and enter the **Tally voucher no., invoice date, invoice amount** and (optionally) the **due date**; it is suggested from the order's payment terms ("30 days credit" → invoice date + 30 days; "100% advance" / "After delivery" → the invoice date). Saving writes `Tally Voucher No.`, `Invoice Date`, `Invoice Amount`, `Due Date` and sets `Status = Billing done` (unless the order is already Dispatched or Cancelled). Then *Receive money* adds a row to `Payments` (Direction *Received*, Ref Type *Order*). A part payment is another receipt. *To collect* lists invoiced orders with a balance, **overdue ones first**; *Paid* lists the settled ones.
  - An order is worth its **Invoice Amount** once billed, before that its value including GST (from the order lines). Received and Balance are worked out from `Payments`.
  - When the balance reaches zero the app fills `Payment Cleared On` with the date of the last receipt; if a correction makes it unpaid again, it is cleared.
  - Receiving more than the balance asks for confirmation. A cancelled order can only take a *refund*.

**Purchase receipts.** One row per delivery (GRN). When goods are received, *To bill* lists it. Enter the supplier's bill: **Bill amount, Tally purchase voucher no.** (and, if needed, correct the supplier invoice no./date). The screen shows the value of the order and of the goods received, and warns about damaged pieces so credit can be asked from the supplier. *Pay supplier* adds a `Payments` row (Direction *Paid*, Ref Type *GRN*). A payment can be made before the goods arrive (an advance) or before the bill is entered. The due date comes from the PO's payment terms, counted from the supplier invoice date (or the received date). *To pay* lists open bills with overdue ones first.

**Payments.** The whole ledger, newest first: money in and money out, with totals, a date range and a *Download* (CSV for a spreadsheet). *Correct* changes the date, amount, mode, reference or note of an entry (what it was for cannot change). Only an **Admin can delete** a payment. Nothing else ever overwrites a payment.

**Stock audit.** Accounts reviews the counts here (approve / reject), the same screen the warehouse counts on.

### Admin

- **Overview.** A card per department (what is waiting) and a *Needs attention* list: purchase orders past their delivery date, accepted requirements past their need-by date, orders dispatched but not invoiced, overdue customer payments and supplier bills, deliveries received over a week ago and not billed, stock counts waiting over a week, items promised beyond the stock, books-vs-warehouse differences, items in the warehouse without GST or HSN, roles nobody has, users whose role the app does not know. *Run sheet check* is the `runDiagnostics` check for every tab. Read-only: each item links to the department that owns it.
- **Products.** The product master: catalog name, stock group, pieces per set, list price, GST %, HSN, type, material, size, colour, brand, customisation, picture link, and a *Details checked* mark (`Verified`, `Verified_By`, `Verified_On`). *Needs details* lists items missing a catalog name, HSN, GST or list price. Tick several and *Mark as checked* in one go. *New item* adds a product before the next Tally import. The Tally name and item code come from the import and are not edited; the stock numbers are formulas and are only shown.
- **Users.** Add, edit and remove people and set their role (the `Users` tab). Emails are stored in lower case. You cannot remove or demote yourself and there is always at least one Admin. A person whose role the app does not know is flagged ("cannot sign in").
- **Locations.** Add locations and edit floor, zone, shelf and description. A location **code never changes** once it exists (stock, orders and counts refer to it); the `QR Code` column is not touched. The list shows how much stock sits at each location.

## Assumptions (confirmed)

- `Damaged Qty` is in **pieces**; PO `Rate` is **Rs per piece, GST-exclusive** (same as the Prices convention).
- Receiving and put-away quantities are stored in **sets** (fractions allowed); the ledger is in **pieces**.
- A GRN is created when a PO is **sent**, not when it is drafted.
- Dispatch requires transport to be booked first.
- A PO does not need a requirement behind it: in the PO builder, *+ Add item* adds any product (or a brand-new item name).

Assumptions made for Accounts and Admin (tell me if the business works differently):

- A bill needs both the Tally voucher number and the amount; an order invoice needs the voucher number, date and amount.
- Billing sets `Sales Orders.Status = Billing done`. Dispatch does not wait for billing.
- Customer receipts are `Direction = Received / Ref Type = Order`; supplier payments are `Paid / GRN`. A *refund* is the opposite direction on the same reference.
- A payment date cannot be in the future; an invoice date cannot be in the future.
- Payment terms are read from text: `N days credit`, `N months credit`, `… advance`, `After delivery`. Anything else gives no suggested due date (it can still be typed in for an order).
- Admin-only: users, products, locations. Warehouse people cannot edit locations from the app (no screen for it); Procurement cannot edit products.

## Typed (table) columns in the sheet

Several columns are typed Sheets "table" columns (dates, drop-downs, numbers). The sheet refuses a number format on them, so the app never writes a JavaScript Date into `Req Date`, `Dispatch Date`, `Payment Date`, `Invoice Date` or `Due Date`: it writes the date as its serial number (`Rows.serial` in `Items.gs`), and the column shows it in its own date format. Drop-downs are written with exactly the allowed values (`Done` / `Left` for `Stickered`, `Audit adj.` for the audit movement type, `Received` / `Paid`, `Order` / `GRN` and the five modes for `Payments`). `Db.gs` must keep its `setFormat_` guard (try/catch around `setNumberFormat`).

## Noticed in the Sales code (not changed)

- `OrdersBoard`: `STAGES` / `stageIdx` did not know `To pack` or `Ready to dispatch`, which the sheet produces, so those orders showed step 1 in the progress bar. The five edits that fix it are in `OrdersBoard-stage-fix.txt`.

## Checked, and what still needs a real deployment

Checked locally against a mock of the sheet that re-implements the `(auto)` formulas and enforces the typed-column rules (no number formats on typed columns, Dates refused in typed date columns, drop-down values): 177 server checks for Procurement and Warehouse, 230 for Accounts and Admin (roles, billing, part and over payments, refunds, cancelled orders, advances, due and overdue dates, `Payment Cleared On`, corrections and deletes, GRN bills, ledger totals and filters, users and the last-Admin rules, locations, products, overview), and Chromium runs of the real pages for every role, at desktop and phone width.

Not verifiable outside Google, so test once after deploying: PDF creation and Drive folders, `LockService`, and sign-in by email. Suggested smoke test: as Procurement accept a requirement → make and send a PO; as Warehouse receive it and put it away; as Accounts open *Purchase receipts*, enter the bill and pay part of it; as Sales convert a quote to an order; as Accounts open *Order receipts*, invoice it and receive a part payment; check the `Payments` tab and `Payment Cleared On` after the second payment; as Admin open *Overview* and *Run sheet check*.

## If something looks wrong

- **A tab is missing, or code is printed on the page.** A board file lost its first line (`<script>`) or its last line (`</script>`) when it was pasted. The page shows a red message naming the tab that did not load. Open that file in Apps Script and check the first and last line. Every board file starts with `<script>` and ends with `</script>`; `DeptStyles` starts with `<style>` and ends with `</style>`.
- **"You can't set the number format of cells in a typed column".** A date was written as a Date object into a typed date column. Check that `Items.gs` has `Rows.serial` and that the code writes dates with it (see above). If it appears on the Sales side, use `Rows.serial(U.isoToday())` for `Req Date` in `ReqApi.create`.
- **"Your role (…) cannot do this."** The person's role is not allowed that action. Roles are on the `Users` tab.
- **A button seems to do nothing.** Lists read the sheet when opened; the first open after a few minutes can take a few seconds on a large Products tab. If something genuinely fails, a red message appears at the bottom right.

## Limits / next steps

- Each action re-reads the tabs it needs. The Products tab is cached for 2 minutes and the cache is dropped after every write. The Admin Overview reads about a dozen tabs, so it takes a few seconds.
- Tab bubbles carry the counts (Procurement: requirements awaiting decision and draft POs; Warehouse: deliveries to receive, lines to put away, orders to ship, counts to review; Accounts: orders to invoice + overdue, deliveries to bill + overdue, counts to review; Admin: items that look wrong). The bell only knows the Sales-style items, so it works on the Procurement page and stays empty elsewhere.
- Not built: GST/e-invoice generation, bank reconciliation, credit notes (record a refund or correct the bill amount instead), deleting locations or users' history, import of Tally stock.
