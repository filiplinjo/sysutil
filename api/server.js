'use strict';

const express    = require('express');
const dns        = require('dns').promises;
const rateLimit  = require('express-rate-limit');
const whoiser    = require('whoiser');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const allowed = ['https://sysutil.dev', 'http://localhost', 'http://127.0.0.1'];
  const origin  = req.headers.origin || '';
  if (process.env.NODE_ENV !== 'production' || allowed.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 30,               // 30 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment.' }
});
app.use('/api/', limiter);

// ── In-memory cache (5 min TTL) ───────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > 5 * 60 * 1000) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  if (cache.size > 500) cache.clear(); // simple eviction
  cache.set(key, { ts: Date.now(), data });
}

// ── Validation helpers ────────────────────────────────────────────────────────
const DOMAIN_RE = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE   = /^[0-9a-fA-F:]{2,39}$/;

function isValidDomain(s) { return DOMAIN_RE.test(s) && s.length <= 253; }
function isValidIPv4(s)   { return IPV4_RE.test(s) && s.split('.').every(n => +n <= 255); }
function isValidIPv6(s)   { return IPV6_RE.test(s); }
function isIP(s)          { return isValidIPv4(s) || isValidIPv6(s); }

// ── DNS lookup endpoint ───────────────────────────────────────────────────────
app.get('/api/dns', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase().replace(/\.$/, '');

  if (!q)                                  return res.status(400).json({ error: 'Missing parameter: q' });
  if (!isValidDomain(q) && !isIP(q))       return res.status(400).json({ error: 'Invalid domain or IP address.' });

  const cacheKey = 'dns:' + q;
  const cached   = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const records = {};

  if (isIP(q)) {
    // Reverse DNS
    try { records.PTR = await dns.reverse(q); } catch {}
  } else {
    // Forward DNS — all common types concurrently
    const tasks = [
      dns.resolve4(q).then(r  => { records.A     = r; }).catch(() => {}),
      dns.resolve6(q).then(r  => { records.AAAA  = r; }).catch(() => {}),
      dns.resolveMx(q).then(r => { records.MX    = r.sort((a,b) => a.priority - b.priority); }).catch(() => {}),
      dns.resolveNs(q).then(r => { records.NS    = r.sort(); }).catch(() => {}),
      dns.resolveTxt(q).then(r=> { records.TXT   = r.map(t => t.join('')); }).catch(() => {}),
      dns.resolveSoa(q).then(r=> { records.SOA   = r; }).catch(() => {}),
      dns.resolveCname(q).then(r=>{ records.CNAME= r; }).catch(() => {}),
      dns.resolveCaa(q).then(r => { records.CAA  = r; }).catch(() => {}),
    ];
    await Promise.allSettled(tasks);
  }

  const result = { query: q, isIP: isIP(q), records, ts: Date.now() };
  setCache(cacheKey, result);
  res.json(result);
});

// ── WHOIS lookup endpoint ─────────────────────────────────────────────────────
app.get('/api/whois', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase().replace(/\.$/, '');

  if (!q)                              return res.status(400).json({ error: 'Missing parameter: q' });
  if (!isValidDomain(q) && !isIP(q))  return res.status(400).json({ error: 'Invalid domain or IP address.' });

  const cacheKey = 'whois:' + q;
  const cached   = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    let raw;
    if (isIP(q)) {
      raw = await whoiser.ip(q, { timeout: 10000 });
    } else {
      raw = await whoiser(q, { follow: 1, timeout: 10000 });
    }

    // Pick the most complete WHOIS server response
    const servers  = Object.keys(raw).filter(k => k !== '__STATUS');
    const best     = servers.reduce((a, b) =>
      Object.keys(raw[b] || {}).length > Object.keys(raw[a] || {}).length ? b : a
    , servers[0]);
    const data     = raw[best] || {};

    // Normalise key fields (WHOIS field names vary by registrar)
    function pick(obj, ...keys) {
      for (const k of keys) {
        const v = obj[k] || obj[k.toUpperCase()] || obj[k.toLowerCase()];
        if (v) return Array.isArray(v) ? v.join(', ') : String(v);
      }
      return null;
    }

    const parsed = {
      domainName:    pick(data, 'Domain Name', 'domain', 'inetnum', 'NetRange'),
      registrar:     pick(data, 'Registrar', 'Registrar Name', 'org-name'),
      registrarUrl:  pick(data, 'Registrar URL', 'Registrar Whois Server'),
      status:        data['Domain Status'] || data['status'] || null,
      created:       pick(data, 'Creation Date', 'Created Date', 'created', 'RegDate'),
      updated:       pick(data, 'Updated Date', 'Last Updated On', 'changed', 'Updated'),
      expires:       pick(data, 'Registry Expiry Date', 'Expiry Date', 'Registrar Registration Expiration Date', 'expires'),
      nameservers:   data['Name Server'] || data['nserver'] || data['Nameservers'] || null,
      dnssec:        pick(data, 'DNSSEC', 'dnssec'),
      // IP-specific
      netname:       pick(data, 'NetName', 'netname'),
      orgName:       pick(data, 'OrgName', 'org', 'Organisation'),
      country:       pick(data, 'Country', 'country'),
      abuse:         pick(data, 'OrgAbuseEmail', 'abuse-mailbox'),
    };

    // Normalise nameservers to array
    if (parsed.nameservers) {
      parsed.nameservers = Array.isArray(parsed.nameservers)
        ? parsed.nameservers
        : String(parsed.nameservers).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    }
    // Normalise status to array
    if (parsed.status) {
      parsed.status = Array.isArray(parsed.status)
        ? parsed.status
        : String(parsed.status).split('\n').map(s => s.trim()).filter(Boolean);
    }

    const result = { query: q, parsed, server: best, ts: Date.now() };
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('WHOIS error:', err.message);
    res.status(502).json({ error: 'WHOIS lookup failed: ' + err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`SysUtil API listening on :${PORT}`));
