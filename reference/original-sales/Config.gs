/**
 * HOSPI OPS - SALES                                            Config.gs
 * ---------------------------------------------------------------------
 * The only file you should need to edit for names, lists and defaults.
 * Keep this file plain data: nothing here may call code from other files.
 */

var CONFIG = {
  // "Copy of Hospi Solutions - Ops Backend"
  SPREADSHEET_ID: '1SD9Uyn7EsN9QycQZNqIg0-8x67axiSQOzryWnEJa1Zc',

  APP_TITLE: 'Hospi Ops',

  // Users tab > Role. Only these roles can open the Sales app.
  ALLOWED_ROLES: ['Admin', 'Sales'],

  QUOTE_PREFIX: 'AE/SO/',        // quote no. and order no. share this series
  QUOTE_VALID_DAYS: 7,           // default validity when "Valid until" is left blank
  FOLLOWUP_DEFAULT_DAYS: 7,      // default "next follow-up" for a new lead
  MAX_ROWS: 300,                 // max rows a board loads at once

  // Quote PDFs. Leave PDF_FOLDER_ID blank to use a "Quote_PDFs" folder in the
  // signed-in user's own Drive. Better: create ONE shared folder, give every
  // sales user Editor access, and paste its ID here.
  PDF_FOLDER_ID: '',
  PDF_FOLDER_NAME: 'Quote_PDFs',
  PDF_SHARE_LINK: false,         // true = anyone with the link can view the PDF

  // Product photos on the quotation PDF. They are read from Products > Photo_link (a Google Drive link).
  // When a product has no link, the Make Quote screen lets the user upload one: it is saved in this Drive folder
  // and its link is written into Products > Photo_link. Leave PHOTO_FOLDER_ID blank to use a "Product_Photos" folder
  // in the signed-in user's own Drive; better: create ONE shared folder (Editor access for every sales user) and paste its ID.
  PHOTO_FOLDER_ID: '',
  PHOTO_FOLDER_NAME: 'Product_Photos',
  PHOTO_SHARE_LINK: true,        // true = uploaded pictures open for anyone with the link, so every sales user's PDF can use them

  // ---- PDFs (quotation and sales order) - laid out like the Google Doc template ----
  // The 4 division logos are copied from the first 4 pictures in this Google Doc, in order. Every sales user
  // needs at least View access to it. Leave blank to print the PDFs without logos.
  LOGO_DOC_ID: '19yUOQN7NrXTtLB8cBF4823EHYs52_Wbya4R8_jdW8og',
  DIVISIONS: ['Textile Division', 'Packaging Division', 'Dustbin Division', 'Hospitality Division'],
  COMPANY: {
    name: 'ABHILASHA ENTERPRISES', tagline: 'Since 2003 - A Legacy',
    address: '197/A-197/B, Ambika Industrial Society - 2, Udhana Magdalla Road, Surat, Gujarat, 395017',
    phone: '+91 99241 11098 | +91 98246 85168', gstin: '24ABOFA6566G1Z7'
  },
  BANK: { name: 'KOTAK MAHINDRA BANK', branch: 'K.G Point, Ghod Dod Road, Surat.', account: '4513136706', ifsc: 'KKBK0000871' },

  // Terms & Conditions printed on the PDFs. {validUntil}, {payment} come from the document itself.
  // "order" is the wording on a sales order; leave it out to reuse the quotation wording.
  TERMS: [
    { t: 'PRICING POLICY',
      quote: 'All quoted prices are subject to change without prior notice and remain valid only until {validUntil}.',
      order: 'All prices are as confirmed in this sales order.' },
    { t: 'PAYMENT TERMS',
      quote: '{payment}. Production commences only upon receipt of the specified advance payment, if any.' },
    { t: 'QUALITY ASSURANCE & RETURNS',
      quote: 'Quality inspection of all glass, metal, and plastic products is mandatory at delivery - no damage claims, returns, or replacements will be accepted after 24 hours of delivery.' },
    { t: 'DELIVERY TIMELINE',
      quote: 'General items: as per the delivery terms above; Customized orders: minimum 15-20 working days; Import orders: 55 - 65 days from advance payment.' },
    { t: 'CUSTOMIZED ORDER PRODUCTION PROTOCOL',
      quote: 'Production begins only after written approval and cannot be modified, cancelled, or paused once initiated - client must verify all specifications before final approval.' },
    { t: 'DELIVERY TERMS & CONDITIONS',
      quote: 'Ex-Factory delivery from Gandhi Kutir, Bhatar, Olive Circle, Udhna-Magdalla Road, Surat - 395007 with transportation charges additional.' },
    { t: 'GENERAL CONDITIONS',
      quote: 'These terms supersede all previous agreements, modifications require written consent, and disputes are subject to Surat jurisdiction only.' }
  ],

  // Choices in the "Mark as lost" window (Orders tab > Quotes waiting for a decision)
  LOST_REASONS: ['No response', 'Price too high', 'Bought elsewhere', 'Not needed any more', 'Other'],

  // Same lists as the dropdowns in the Leads table
  LEAD_SOURCES: ['Instagram', 'Indiamart', 'Whatsapp', 'Walk In', 'Reference'],
  LEAD_POCS: ['Laxmi', 'Komal', 'Hemali', 'Ashok', 'Ankur', 'Ajay'],
  LEAD_STATUSES: ['Inquiry', 'Sampling', 'Quotation', 'Negotiation', 'Business Done', 'Business Lost'],
  // Statuses that mean "no longer open" (the two old screen values are kept for safety)
  LEAD_CLOSED: ['Business Done', 'Business Lost', 'Converted', 'Lost'],

  PAYMENT_TERMS: ['100% advance', '50% advance', '40% advance', '20% advance', 'After delivery',
                  '15 days credit', '30 days credit', '45 days credit', '3 months credit'],
  DELIVERY_TERMS: ['1 week', '2 weeks', '3 weeks', 'Porter', 'Transporter', 'Ex-warehouse']
};

/**
 * Tabs the Sales app touches.
 *   sheet     = tab name
 *   headerRow = row holding the column names (Sales Orders uses row 2)
 *   key       = column that is always filled on a real row (used to find the last row)
 *   readonly  = extra columns the app must never write (formula columns).
 * Columns whose header ends with "(auto)" are always treated as read-only.
 * Header matching ignores trailing/double spaces ("Lead ID " = "Lead ID").
 */
var TABLES = {
  users:        { sheet: 'Users',             headerRow: 1, key: 'Email' },
  leads:        { sheet: 'Leads',             headerRow: 1, key: 'Lead ID' },
  customers:    { sheet: 'Customers',         headerRow: 1, key: 'Customer ID' },
  requirements: { sheet: 'Requirements',      headerRow: 1, key: 'Req ID', readonly: ['Customer / Lead ID'] },
  quotations:   { sheet: 'Quotations',        headerRow: 1, key: 'Quote ID' },
  quoteLines:   { sheet: 'Quotation_lines',   headerRow: 1, key: 'Line ID' },
  orders:       { sheet: 'Sales Orders',      headerRow: 2, key: 'Order ID' },
  orderLines:   { sheet: 'Sales Order Lines', headerRow: 1, key: 'Line ID' },
  products:     { sheet: 'Products',          headerRow: 1, key: 'Item Code' }
};

/** Headers the code relies on. runDiagnostics() checks them against the sheet. */
var REQUIRED_HEADERS = {
  users: ['Email', 'Name', 'Role'],
  leads: ['Lead ID', 'Lead Date', 'Lead Person Name', 'Lead Person Pho. No.', 'Company/Brand Name', 'City',
          'Interested Products', 'Lead Source', 'Lead POC', 'Lead Status', 'Value', 'Next Follow Up Date', 'Customer ID'],
  customers: ['Customer ID', 'Company/Brand Name', 'Customer Name', 'WhatsApp No.', 'GSTIN', 'Address', 'City', 'Salesman'],
  requirements: ['Req ID', 'Req Date', 'Salesman', 'Req for', 'Customer / Lead Name', 'Customer / Lead ID', 'Need By',
                 'Status', 'PO ID', 'SO ID', 'Notes', 'Item Code', 'Item Description', 'No. of Set',
                 'Party (auto)', 'Item (auto)', 'Quote no. (auto)', 'PO no. (auto)', 'Stage (auto)'],
  quotations: ['Quote ID', 'Quote No', 'Quote Date', 'Salesman', 'Quote For', 'Customer / Lead ID', 'Customer / Lead Name',
               'Valid Until', 'Payment Terms', 'Delivery Terms', 'Quote PDF', 'Created_At', 'Lost On', 'Lost Reason'],
  quoteLines: ['Line ID', 'Quote ID', 'Item_Code', 'Description', 'Qty/Set', 'Set', 'List Price', 'Discount %',
               'Offer Price', 'GST %', 'Req ID', 'Photo Link'],
  orders: ['Order ID', 'Order No.', 'Order Date', 'Customer', 'Salesman', 'Status', 'Payment Terms', 'Delivery Terms',
           'Proforma Invoice PDF', 'Created At', 'Tally Voucher No.', 'Dispatch Date', 'Stage (auto)'],
  orderLines: ['Line ID', 'Req ID', 'Order ID', 'Item_Code', 'Description', 'Pcs / Set', 'No. of set', 'Offer Price', 'GST %'],
  products: ['Item Code', 'Tally Name', 'Catalog Name', 'Pcs / Set', 'List Price', 'GST_Pct', 'Photo_link']
};
