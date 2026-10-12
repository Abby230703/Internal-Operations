/** RequirementsApi.gs - backend for the Requirements board (reorder demands).
 *
 * A requirement shows exactly one of three statuses:
 *   Accepted - the purchase manager picked Accepted in the Status column of the Requirements tab
 *   Denied   - the purchase manager picked Denied there
 *   Ordered  - a purchase order was raised (the PO ID cell is filled)
 * Sales never sets the status. Until the purchase manager decides, the status is blank (shown as "Awaiting decision").
 * Old values are understood too: Dropped = Denied, Open = blank.
 */

var ReqApi = {
  DENIED_: ['denied', 'dropped', 'cancelled', 'canceled', 'rejected'],
  ACCEPTED_: ['accepted', 'approved'],

  /** 'Ordered' | 'Denied' | 'Accepted' | '' (not decided yet) */
  statusOf_: function (r) {
    if (U.s(r['PO ID'])) return 'Ordered';                    // a PO beats everything else
    var st = U.low(r['Status']);
    if (st === 'ordered') return 'Ordered';
    if (ReqApi.DENIED_.indexOf(st) >= 0) return 'Denied';
    if (ReqApi.ACCEPTED_.indexOf(st) >= 0) return 'Accepted';
    return '';
  },

  out_: function (r) {
    var sets = U.toNum(r['No. of Set']);
    var code = U.s(r['Item Code']), desc = U.s(r['Item Description']);
    return {
      id: U.s(r['Req ID']), row: r._row, date: U.iso(r['Req Date']),
      forType: U.s(r['Req for']), partyId: U.s(r['Customer / Lead ID']),
      party: U.s(r['Party (auto)']) || U.s(r['Customer / Lead Name']),
      itemCode: code, itemDesc: desc, item: U.s(r['Item (auto)']) || (code ? code : desc),
      sets: isNaN(sets) ? '' : sets, needBy: U.iso(r['Need By']), notes: U.s(r['Notes']),
      status: ReqApi.statusOf_(r), quoteNo: U.s(r['Quote no. (auto)']), poNo: U.s(r['PO no. (auto)']),
      soId: U.s(r['SO ID']), poId: U.s(r['PO ID'])
    };
  },

  /** args: { filter: All|Accepted|Denied|Ordered|Not quoted yet, search }   (old names Open, Quoted, Dropped still work) */
  list: function (a) {
    var filter = U.s(a.filter) || 'All', q = U.low(a.search);
    if (filter === 'Dropped') filter = 'Denied';
    var all = Db.readAll('requirements').map(ReqApi.out_);
    var rows = all.filter(function (r) {
      var quoted = !!(r.quoteNo || r.soId), denied = r.status === 'Denied';
      if (filter === 'Open' && denied) return false;
      if (filter === 'Not quoted yet' && (quoted || denied)) return false;
      if (filter === 'Quoted' && !quoted) return false;
      if ((filter === 'Accepted' || filter === 'Denied' || filter === 'Ordered') && r.status !== filter) return false;
      if (q && [r.party, r.item, r.notes].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (x, y) { return y.date > x.date ? 1 : y.date < x.date ? -1 : y.row - x.row; });
    return { total: all.length, shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS) };
  },

  /** args: { forType, partyId, itemCode, itemDesc, sets, needBy, notes }  (sets may be a fraction) */
  create: function (a, user) {
    var type = U.s(a.forType);
    if (type !== 'Customer' && type !== 'Lead') throw new Error('Choose Customer or Lead.');
    var party = Parties.find(type, a.partyId);
    if (!party) throw new Error('Pick the ' + type.toLowerCase() + ' from the list.');
    var sets = U.toNum(a.sets);
    // the browser turns pieces into sets (pieces / pieces-per-set), so a part-set is stored as a fraction
    if (!(sets > 0)) throw new Error('Enter the quantity (pieces or sets).');
    var code = U.s(a.itemCode), desc = U.s(a.itemDesc), rawCode = '';
    if (code) {
      rawCode = Catalog.rawCode(code);
      if (rawCode === null) throw new Error('Item code ' + code + ' is not in Products.');
      desc = '';
    } else if (!desc) {
      throw new Error('Pick an item, or type the name of the new item.');
    }
    var needBy = '';
    if (U.s(a.needBy)) {
      needBy = U.dateFromIso(a.needBy);
      if (!needBy) throw new Error('"Need by" date is not valid.');
    }
    var id = U.newId(U.idSet(Db.readAll('requirements'), 'Req ID'));
    // Status stays empty: the purchase manager decides Accepted / Denied
    Db.append('requirements', [{
      'Req ID': id, 'Req Date': U.today(), 'Salesman': user.email, 'Req for': type,
      'Customer / Lead Name': party.nameRaw, 'Need By': needBy, 'Notes': U.s(a.notes),
      'Item Code': rawCode, 'Item Description': desc, 'No. of Set': sets
    }]);
    return { id: id };
  }
};
