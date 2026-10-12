/** LeadsApi.gs - backend for the Leads board. */

var LeadsApi = {
  out_: function (r) {
    var v = U.toNum(r['Value']);
    return {
      id: U.s(r['Lead ID']), row: r._row, date: U.iso(r['Lead Date']),
      contact: U.s(r['Lead Person Name']), phone: U.s(r['Lead Person Pho. No.']),
      company: U.s(r['Company/Brand Name']), city: U.s(r['City']), products: U.s(r['Interested Products']),
      source: U.s(r['Lead Source']), owner: U.s(r['Lead POC']), status: U.s(r['Lead Status']) || 'Inquiry',
      value: isNaN(v) ? '' : v, followUp: U.iso(r['Next Follow Up Date']), customerId: U.s(r['Customer ID'])
    };
  },

  /** args: { filter: Open|All|Business Done|Business Lost, search } */
  list: function (a) {
    var filter = U.s(a.filter) || 'Open', q = U.low(a.search);
    var all = Db.readAll('leads').map(LeadsApi.out_);
    var rows = all.filter(function (l) {
      var closed = CONFIG.LEAD_CLOSED.indexOf(l.status) >= 0;
      if (filter === 'Open' && closed) return false;
      if (filter === 'Business Done' && l.status !== 'Business Done' && l.status !== 'Converted') return false;
      if (filter === 'Business Lost' && l.status !== 'Business Lost' && l.status !== 'Lost') return false;
      if (q && [l.company, l.contact, l.phone, l.city, l.products].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (x, y) { return y.date > x.date ? 1 : y.date < x.date ? -1 : y.row - x.row; });
    return { total: all.length, shown: rows.length, rows: rows.slice(0, CONFIG.MAX_ROWS) };
  },

  /** args: { company*, contact, phone, city, products, source, owner, value, followUp, force } */
  create: function (a, user) {
    var company = U.s(a.company).replace(/\s+/g, ' ');
    if (!company) throw new Error('Company / brand name is required.');
    if (company.length > 120) throw new Error('Company name is too long.');
    var phone = U.s(a.phone);
    if (phone && !/^[0-9+\-()\s]{5,20}$/.test(phone)) throw new Error('Phone number looks wrong. Use digits only.');
    var source = U.s(a.source), owner = U.s(a.owner);
    if (source && CONFIG.LEAD_SOURCES.indexOf(source) < 0) throw new Error('Unknown lead source.');
    if (owner && CONFIG.LEAD_POCS.indexOf(owner) < 0) throw new Error('Unknown lead owner.');
    var value = '';
    if (U.s(a.value) !== '') {
      value = U.toNum(a.value);
      if (isNaN(value) || value < 0) throw new Error('Expected value must be a number.');
    }
    var follow = '';
    if (U.s(a.followUp)) {
      follow = U.dateFromIso(a.followUp);
      if (!follow) throw new Error('Follow-up date is not valid.');
      if (U.iso(follow) < U.isoToday()) throw new Error('Follow-up date cannot be in the past.');
    }

    var norm = function (s) { return U.low(s).replace(/\s+/g, ' '); }, key = norm(company), dup = '';
    Db.readAll('customers').forEach(function (r) { if (!dup && norm(r['Company/Brand Name']) === key) dup = 'a customer'; });
    var leads = Db.readAll('leads');
    leads.forEach(function (r) {
      if (!dup && norm(r['Company/Brand Name']) === key && CONFIG.LEAD_CLOSED.indexOf(U.s(r['Lead Status'])) < 0) dup = 'an open lead';
    });
    if (dup && !a.force) return { needsConfirm: true, message: '"' + company + '" already exists as ' + dup + '. Save it as a new lead anyway?' };

    var taken = U.idSet(leads, 'Lead ID', U.idSet(Db.readAll('customers'), 'Customer ID'));
    var id = U.newId(taken);
    Db.append('leads', [{
      'Lead ID': id, 'Lead Date': U.today(), 'Lead Person Name': U.s(a.contact), 'Lead Person Pho. No.': phone,
      'Company/Brand Name': company, 'City': U.s(a.city), 'Interested Products': U.s(a.products),
      'Lead Source': source, 'Lead POC': owner, 'Lead Status': 'Inquiry', 'Value': value, 'Next Follow Up Date': follow
    }], { 'Lead Person Pho. No.': '@' });
    return { id: id };
  },

  /** args: { id, status?, followUp? }  (followUp '' clears it) */
  update: function (a) {
    var row = Db.find(Db.readAll('leads'), 'Lead ID', a.id);
    if (!row) throw new Error('Lead not found.');
    var changes = {}, fmt = {};
    if (a.status !== undefined && a.status !== null && U.s(a.status) !== '') {
      if (CONFIG.LEAD_STATUSES.indexOf(U.s(a.status)) < 0) throw new Error('Unknown status.');
      changes['Lead Status'] = U.s(a.status);
    }
    if (a.followUp !== undefined && a.followUp !== null) {
      if (U.s(a.followUp) === '') changes['Next Follow Up Date'] = '';
      else {
        var d = U.dateFromIso(a.followUp);
        if (!d) throw new Error('Follow-up date is not valid.');
        changes['Next Follow Up Date'] = d;
      }
    }
    if (!Object.keys(changes).length) return { id: U.s(a.id) };
    Db.update('leads', row._row, changes, fmt);
    return { id: U.s(a.id) };
  }
};
