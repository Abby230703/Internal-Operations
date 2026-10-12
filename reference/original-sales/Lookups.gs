/** Lookups.gs - customers/leads ("parties") and the product list, shared by all boards. */

var Parties = {
  /** Customers and still-open leads, for the pickers. */
  lists: function () {
    var customers = Db.readAll('customers').map(function (r) {
      return { id: U.s(r['Customer ID']), name: U.s(r['Company/Brand Name']), city: U.s(r['City']) };
    }).filter(function (x) { return x.id && x.name; });
    var leads = Db.readAll('leads').filter(function (r) {
      return CONFIG.LEAD_CLOSED.indexOf(U.s(r['Lead Status'])) < 0;
    }).map(function (r) {
      return { id: U.s(r['Lead ID']), name: U.s(r['Company/Brand Name']), city: U.s(r['City']), status: U.s(r['Lead Status']) || 'Inquiry' };
    }).filter(function (x) { return x.id && x.name; });
    var byName = function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; };
    return { customers: customers.sort(byName), leads: leads.sort(byName) };
  },

  /** One customer or lead by ID (type = 'Customer' | 'Lead'). nameRaw is the exact text stored in the sheet. */
  find: function (type, id) {
    id = U.s(id);
    if (!id) return null;
    var r;
    if (type === 'Customer') {
      r = Db.find(Db.readAll('customers'), 'Customer ID', id);
      if (!r) return null;
      return { type: type, id: id, row: r, nameRaw: r['Company/Brand Name'], name: U.s(r['Company/Brand Name']),
               contact: U.s(r['Customer Name']), phone: U.s(r['WhatsApp No.']), city: U.s(r['City']),
               gstin: U.s(r['GSTIN']), address: U.s(r['Address']) };
    }
    if (type === 'Lead') {
      r = Db.find(Db.readAll('leads'), 'Lead ID', id);
      if (!r) return null;
      return { type: type, id: id, row: r, nameRaw: r['Company/Brand Name'], name: U.s(r['Company/Brand Name']),
               contact: U.s(r['Lead Person Name']), phone: U.s(r['Lead Person Pho. No.']), city: U.s(r['City']),
               gstin: '', address: '', status: U.s(r['Lead Status']), customerId: U.s(r['Customer ID']) };
    }
    return null;
  }
};

var Catalog = {
  _codes: null,

  /**
   * The WHOLE Products tab (every row with an Item Code), compact for the browser:
   * [code, name, pcsPerSet, listPrice, gstPercent, available, booksQty, hasPhoto (1/0), moreSearchWords].
   * name = Catalog Name, or the Tally Name when that is blank. moreSearchWords = the other name, stock group and brand,
   * so a search for "ariane" or the Tally spelling finds the item even when the Catalog Name is different.
   */
  list: function () {
    var rows = Db.readCols('products', ['Item Code', 'Tally Name', 'Catalog Name', 'Stock Group', 'Brand', 'Pcs / Set', 'List Price', 'GST_Pct',
                                        'Available (auto)', 'Books Qty (auto)', 'Photo_link']);
    var num = function (v) { var n = U.toNum(v); return isNaN(n) ? '' : n; };
    return rows.map(function (r) {
      var gst = U.toNum(r['GST_Pct']);
      if (!isNaN(gst) && gst > 0 && gst <= 1) gst = gst * 100;
      var cat = U.s(r['Catalog Name']), tally = U.s(r['Tally Name']), name = cat || tally;
      var more = [tally !== name ? tally : '', U.s(r['Stock Group']), U.s(r['Brand'])].filter(Boolean).join(' ');
      return [U.s(r['Item Code']), name, num(r['Pcs / Set']), num(r['List Price']),
              isNaN(gst) ? '' : U.r2(gst), num(r['Available (auto)']), num(r['Books Qty (auto)']), U.s(r['Photo_link']) ? 1 : 0, more];
    }).filter(function (p) { return p[0] !== ''; });
  },

  /** The item code exactly as the Products tab stores it (number or text), or null if there is no such item. */
  rawCode: function (code) {
    if (!Catalog._codes) {
      Catalog._codes = {};
      Db.readCols('products', ['Item Code']).forEach(function (r) { Catalog._codes[U.s(r['Item Code'])] = r['Item Code']; });
    }
    var t = U.s(code);
    return Object.prototype.hasOwnProperty.call(Catalog._codes, t) ? Catalog._codes[t] : null;
  },

  /** { itemCode: Drive link } for every product that has a Photo_link. */
  photoLinks: function () {
    var out = {};
    Db.readCols('products', ['Item Code', 'Photo_link']).forEach(function (r) {
      var link = U.s(r['Photo_link']);
      if (link) out[U.s(r['Item Code'])] = link;
    });
    return out;
  },

  name: function (code) {
    var t = U.s(code), hit = '';
    Db.readCols('products', ['Item Code', 'Tally Name', 'Catalog Name']).forEach(function (r) {
      if (!hit && U.s(r['Item Code']) === t) hit = U.s(r['Catalog Name']) || U.s(r['Tally Name']);
    });
    return hit;
  }
};

/**
 * Product pictures for the quotation PDF.
 *  - read: the Drive link in Products > Photo_link (or the link saved on the quote line) -> a small picture embedded in the PDF
 *  - upload: Make Quote screen, for products with no picture yet -> saved in Drive, link written to Products > Photo_link
 * Everything runs as the signed-in user, so they need at least View access to the pictures they print.
 */
var Photos = {
  BOX: 48,             // largest printed side of a picture on the PDF, in px
  MAX_ORIGINAL: 600000,  // bytes. Bigger pictures are replaced by Drive's small preview

  /** Any kind of Drive link (file, open?id=, uc?id=, folder) or a bare ID -> { id, folder } or null. */
  parse_: function (link) {
    var s = U.s(link), m;
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) {
      if (!/^https?:\/\/(?:[\w-]+\.)*(?:google\.com|googleusercontent\.com)\//i.test(s)) return null;
      if ((m = /\/folders\/([\w-]{15,})/.exec(s))) return { id: m[1], folder: true };
      if ((m = /\/d\/([\w-]{15,})/.exec(s))) return { id: m[1], folder: false };
      if ((m = /[?&]id=([\w-]{15,})/.exec(s))) return { id: m[1], folder: false };
      return null;
    }
    return /^[\w-]{20,}$/.test(s) ? { id: s, folder: false } : null;
  },

  /** Picture type from the first bytes ('' if it is not JPG / PNG / GIF). Apps Script bytes are signed, so mask them. */
  sniff_: function (b) {
    var x = function (i) { return b[i] & 255; };
    if (!b || b.length < 12) return '';
    if (x(0) === 0x89 && x(1) === 0x50 && x(2) === 0x4E && x(3) === 0x47) return 'image/png';
    if (x(0) === 0xFF && x(1) === 0xD8) return 'image/jpeg';
    if (x(0) === 0x47 && x(1) === 0x49 && x(2) === 0x46) return 'image/gif';
    return '';
  },

  /** Width and height in px read from the file header ({w:0,h:0} if unknown). */
  dims_: function (b, mime) {
    var x = function (i) { return b[i] & 255; }, i, mk;
    if (mime === 'image/png') return { w: (x(16) * 16777216) + (x(17) << 16) + (x(18) << 8) + x(19), h: (x(20) * 16777216) + (x(21) << 16) + (x(22) << 8) + x(23) };
    if (mime === 'image/gif') return { w: x(6) + (x(7) << 8), h: x(8) + (x(9) << 8) };
    i = 2;
    while (i + 9 < b.length) {
      if (x(i) !== 0xFF) { i++; continue; }
      mk = x(i + 1);
      if (mk === 0xFF) { i++; continue; }
      if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { w: (x(i + 7) << 8) + x(i + 8), h: (x(i + 5) << 8) + x(i + 6) };
      i += 2 + (x(i + 2) << 8) + x(i + 3);
    }
    return { w: 0, h: 0 };
  },

  cache_: function () { try { return CacheService.getScriptCache(); } catch (e) { return null; } },

  firstImage_: function (folder) {
    var it = folder.getFiles(), n = 0;
    while (it.hasNext() && n++ < 60) {
      var f = it.next();
      if (/^image\//i.test(String(f.getMimeType() || ''))) return f;
    }
    return null;
  },

  /** One Drive link -> { uri, w, h } (a data: picture ready for the PDF) or { error }. Small pictures are cached for 6 hours. */
  one_: function (link) {
    var p = Photos.parse_(link);
    if (!p) return { error: 'not a Google Drive link' };
    var cache = Photos.cache_(), key = 'hospi.photo.v1.' + p.id;
    if (cache) { try { var hit = cache.get(key); if (hit) return JSON.parse(hit); } catch (e0) { /* no cache */ } }
    var out;
    try {
      var file = p.folder ? Photos.firstImage_(DriveApp.getFolderById(p.id)) : DriveApp.getFileById(p.id);
      if (!file) throw new Error('no picture inside that folder');
      var bytes = null, mime = '', th = null;
      try { th = file.getThumbnail(); } catch (e1) { th = null; }     // Drive's small preview: light and always a normal picture
      if (th) { bytes = th.getBytes(); mime = Photos.sniff_(bytes); }
      if (!mime) {
        if (file.getSize() > Photos.MAX_ORIGINAL) throw new Error('the picture is too big and Drive has no preview of it');
        bytes = file.getBlob().getBytes(); mime = Photos.sniff_(bytes);
        if (!mime) throw new Error('only JPG, PNG or GIF pictures can be printed');
      }
      var d = Photos.dims_(bytes, mime);
      out = { uri: 'data:' + mime + ';base64,' + Utilities.base64Encode(bytes), w: d.w, h: d.h };
    } catch (e2) {
      var msg = String(e2 && e2.message ? e2.message : e2);
      return { error: /No item with the given ID|permission|access|not found/i.test(msg) ? 'no access to that Drive file (or it was deleted)' : msg };
    }
    if (cache && out.uri.length < 90000) { try { cache.put(key, JSON.stringify(out), 21600); } catch (e3) { /* only a speed-up */ } }
    return out;
  },

  /** links: Drive links (blanks and repeats are fine). -> { map: { link: {uri,w,h} }, failed: { link: reason } } */
  embed: function (links) {
    var map = {}, failed = {};
    links.forEach(function (link) {
      link = U.s(link);
      if (!link || map[link] || failed[link]) return;
      var r = Photos.one_(link);
      if (r.uri) map[link] = r; else failed[link] = r.error;
    });
    return { map: map, failed: failed };
  },

  folder_: function () {
    if (CONFIG.PHOTO_FOLDER_ID) return DriveApp.getFolderById(CONFIG.PHOTO_FOLDER_ID);
    var it = DriveApp.getFoldersByName(CONFIG.PHOTO_FOLDER_NAME);
    return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.PHOTO_FOLDER_NAME);
  },

  /** Put the link in Products > Photo_link if that cell is empty (or still holds the picture this user uploaded a moment ago = prev). */
  fillMaster_: function (code, url, prev) {
    var m = Db.meta('products');
    if (!m.cols['Photo_link']) return false;
    var t = U.s(code), hit = null;
    Db.readCols('products', ['Item Code', 'Photo_link']).forEach(function (r) { if (!hit && U.s(r['Item Code']) === t) hit = r; });
    if (!hit) return false;
    var cur = U.s(hit['Photo_link']);
    if (cur) {
      var pc = Photos.parse_(cur), pp = Photos.parse_(prev);
      if (!(pc && pp && pc.id === pp.id)) return false;      // someone else's picture: never overwritten
    }
    Db.update('products', hit._row, { 'Photo_link': url });
    return true;
  },

  /**
   * args: { code, name, data (base64 picture), prev }
   * Saves the picture in Drive. For a product that has no picture yet, the link is also written to Products > Photo_link,
   * so every future quote picks it up. Returns { url, master } (master = true when the Products sheet was filled).
   */
  upload: function (a) {
    var data = U.s(a.data).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!data) throw new Error('No picture was received.');
    if (data.length > 5500000) throw new Error('That picture is too large (limit about 4 MB).');
    var bytes = Utilities.base64Decode(data), mime = Photos.sniff_(bytes);
    if (!mime) throw new Error('Please use a JPG, PNG or GIF picture.');
    var code = U.s(a.code), ext = mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif' : '.jpg';
    var base = (code ? 'item-' + code : 'quote-item').replace(/[^\w.-]+/g, '_').slice(0, 40);
    var name = base + '-' + Utilities.formatDate(new Date(), Db.tz(), 'yyyyMMdd-HHmmss') + ext;
    var file = Photos.folder_().createFile(Utilities.newBlob(bytes, mime, name));
    if (CONFIG.PHOTO_SHARE_LINK) {
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* the domain may not allow public links */ }
    }
    var url = file.getUrl(), master = false;
    if (code) master = Photos.fillMaster_(code, url, a.prev);
    return { url: url, name: name, master: master };
  }
};
