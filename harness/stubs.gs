/* Test-only: the real Sales server files (OrdersApi, Pdf, QuotesApi, LeadsApi...) are loaded as they are, except that the
   next quote number is fixed so the sheet mock does not need the whole Quotations/Orders layout. */
QuoteApi.nextNo = function () { return 'AE/SO/0099'; };
