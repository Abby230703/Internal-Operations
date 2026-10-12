# Hospi Ops: Procurement and Warehouse

Adds two departments to the existing Sales app. Same web app, one URL per department:

| URL | Who | Tabs |
|---|---|---|
| `…/exec` or `…/exec?dept=sales` | Sales | Leads, Requirements, Make Quote, Orders (unchanged) |
| `…/exec?dept=procurement` | Procurement | Purchase queue, Purchase orders, Suppliers |
| `…/exec?dept=warehouse` | Warehouse | Receiving, Put-away, Dispatch, Stock, Stock audit |

`Users` tab roles decide who can open what: **Admin** opens all three, **Sales / Procurement / Warehouse** open their own, **Accounts** opens the Warehouse page and sees only *Stock audit* (to review counts) until an Accounts department exists. The department menu in the header links between them.

## Files

New: `Items.gs`, `Procurement.gs`, `Warehouse.gs`, `DeptShell.html`, `DeptStyles.html`, and the eight boards
`ProcQueueBoard`, `PurchaseOrdersBoard`, `SuppliersBoard`, `ReceivingBoard`, `PutAwayBoard`, `DispatchBoard`, `StockBoard`, `AuditBoard` (`.html`).

Changed (your files, with the edits marked `PW:` in the code):

- `Config.gs`: new roles, `DEPARTMENTS`, PO/audit Drive folder settings, 8 new tables in `TABLES` and `REQUIRED_HEADERS`.
- `Main.gs`: `doGet(e)` picks the department; `api()` checks each action's roles (an action with no roles is a Sales action; `'*'` = everyone; Admin always passes); `methods()` merges the new actions; `boot` skips the Sales-only quote number for other roles; `Auth` accepts the new roles.
- `Index.html`: one template for all departments (title, department chip, menu, board sections and file list come from `Main.deptConfig`).

**Not touched:** `Client.html`, `Styles.html`, the four Sales boards, and every other Sales `.gs` file. `DeptShell.html` loads right after `Client.html` and only wraps `App.go` (breadcrumb), `App.icon` (new icons) and `App.refreshAttn` (badges) on the non-Sales pages.

## Install

1. Copy the new files into the Apps Script project and replace `Config.gs`, `Main.gs`, `Index.html` with the versions here (if you changed those since, re-apply the `PW:` edits instead).
2. Do not copy the old kanban script (the file with `SHEET_NAME = 'Sales_Leads'`, `onOpen`, `showDashboard`) into the replica. It opens the `Index` template without `cfg`, so it no longer works with the shared page, and the Sales app does not use it.
3. In the `Users` tab give people their role: `Procurement`, `Warehouse`, `Accounts` (spelled exactly).
4. Optional but recommended: make one shared Drive folder each for PO PDFs and audit photos and paste the IDs into `PO_PDF_FOLDER_ID` / `AUDIT_PHOTO_FOLDER_ID` (otherwise each user's own Drive gets a `PO_PDFs` / `Audit Queue_Images` folder).
5. Run `runDiagnostics` once. It now also checks the 8 new tabs and the extra Sales Orders / Order Lines columns (`Transport Booked`, `Transporter`, `LR No.`, `Pick From`, `Picked`, `Packed`, `Dispatched Qty`…).
6. Deploy as before (Execute as: user accessing the web app). Redeploy a new version.

## How it works

**Procurement.** Sales requirements arrive in the Purchase queue (blank status). The purchase manager accepts or denies each one (`Requirements.Status`), picks the supplier, and uses *Make PO*. A PO is a draft until *Send*: sending sets `Status = Sent` (this is what makes it "On Order"), makes the PDF, and opens the goods receipt (GRN + one line per PO line, "Yet to receive") for the Warehouse. Removing a line from a draft, or deleting a draft, puts its requirement back in the queue. *Stock top-up* lets Procurement raise a need with no customer behind it; it starts as Accepted.

**Warehouse, inward.** *Receiving*: count the delivery (pieces or sets), note damaged pieces, sticker, then *Mark as received* (this fills `Received Date`). An item that arrived but was not on the PO can be added. *Put-away*: choose a location and pieces per line; part put-away splits the line so the PO's `Open Sets` stays correct.

**Warehouse, outward.** *Dispatch* follows the sheet's own `Stage (auto)`: pick (`Picked` + `Pick From`) → pack (`Packed`) → **book transport** (`Transport Booked` + `Transporter`) → dispatch (partial shipments allowed; `Dispatched Qty`, line `Dispatched`, and the order's `Status = Dispatched` when nothing is left).

**Stock Movement is read-only for people.** The app writes it in exactly three places: put-away (+), dispatch (−), approved audit (`Audit adj`). *Stock* only reads it. A dispatch is refused if the ledger does not hold the pieces at the pick location.

**Audit.** Warehouse counts a shelf (item, location, pieces, optional photo). Accounts approves (the ledger is adjusted by the difference) or rejects (nothing changes). Admin can do both.

## Assumptions (confirmed)

- `Damaged Qty` is in **pieces**; PO `Rate` is **Rs per piece, GST-exclusive** (same as the Prices convention).
- Receiving and put-away quantities are stored in **sets** (fractions allowed); the ledger is in **pieces**.
- A GRN is created when a PO is **sent**, not when it is drafted.
- Dispatch requires transport to be booked first (the sheet only reaches "Ready to dispatch" after that).
- Lines without an item code can be dispatched, but no stock is reduced for them (the ledger needs an item code).
- A PO does not need a requirement behind it: in the PO builder, *+ Add item* adds any product (or a brand-new item name) for the chosen supplier. Requirements are only a shortcut (they appear under the supplier and can be added with one click).

## Noticed in the Sales code (not changed)

- `OrdersBoard`: `STAGES` / `stageIdx` did not know `To pack` or `Ready to dispatch`, which the sheet produces, so those orders showed step 1 in the progress bar. The five edits that fix it are in `OrdersBoard-stage-fix.txt` (apply them to your existing file). `Part dispatched` is never produced by the sheet.
- Product list, parties and the item pickers are reused as they are.

## Checked, and what still needs a real deployment

Checked locally against a mock of the sheet that re-implements the `(auto)` formulas (PO/SO open sets, order stage, warehouse qty, reserved, audit system qty): 158 server checks (roles, PO lifecycle, receive, split put-away, dispatch incl. partial and stock guard, audit approve/reject) and a Chromium run of the real pages for every role (desktop and phone width).

Not verifiable outside Google, so test once after deploying: PDF creation and Drive folders (PO PDF, audit photo), `LockService`, and sign-in by email. Suggested smoke test: as Procurement accept a requirement → make and send a PO → open its PDF; as Warehouse receive it, put it away, then pick/pack/book/dispatch a Sales order; add an audit count; as Accounts approve it.

## Limits / next steps

- Each action re-reads the tabs it needs (the Products tab is read on most lists). Fine at today's size; cache with `CacheService` if lists feel slow.
- Tab bubbles carry the counts (Procurement: requirements awaiting decision and draft POs; Warehouse: deliveries to receive, lines to put away, orders to ship, counts to review). The bell only knows the Sales-style items, so it works on the Procurement page (requirements awaiting decision) and stays empty on the Warehouse page.
- Accounts' own screens (purchase receipts, order receipts) are not built.
