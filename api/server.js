'use strict';

const express    = require('express');
const dns        = require('dns').promises;
const rateLimit  = require('express-rate-limit');
const whoiser    = require('whoiser');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust nginx reverse proxy — required for express-rate-limit to work correctly
app.set('trust proxy', 1);

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const AI_MODEL   = process.env.AI_MODEL   || 'llama3.1:70b';

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '32kb' }));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const allowed = ['https://sysutil.dev', 'http://localhost', 'http://127.0.0.1'];
  const origin  = req.headers.origin || '';
  if (process.env.NODE_ENV !== 'production' || allowed.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Rate limiters ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment.' }
});
// AI endpoints get a stricter limit — model inference is expensive
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'AI rate limit reached — max 10 requests per minute.' }
});

app.use('/api/', limiter);
app.use('/api/ai/', aiLimiter);

// ── In-memory cache (5 min TTL) ───────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > 5 * 60 * 1000) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  if (cache.size > 500) cache.clear();
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

// ── Ollama helper ─────────────────────────────────────────────────────────────
function extractJSON(text) {
  // Direct parse first
  try { return JSON.parse(text.trim()); } catch {}
  // Pull out first {...} block (model sometimes wraps in markdown)
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function ollamaJSON(system, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:   AI_MODEL,
        system,
        prompt,
        stream:  false,
        format:  'json',
        options: { temperature: 0.1, top_p: 0.9 }
      })
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json();
    return extractJSON(data.response);
  } finally {
    clearTimeout(timer);
  }
}

// ── AI: Cron expression from description ─────────────────────────────────────
app.post('/api/ai/cron', async (req, res) => {
  const desc = (req.body?.description || '').trim().slice(0, 300);
  if (!desc) return res.status(400).json({ error: 'Missing: description' });

  const cacheKey = 'ai:cron:' + desc;
  const cached = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await ollamaJSON(
      `You are a cron expression expert. Given a schedule description, respond ONLY with a JSON object using this exact structure:
{"expression":"<5-field cron>","readable":"<plain English of schedule>","fields":{"minute":"<value — explain it>","hour":"<value — explain it>","dom":"<value — explain it>","month":"<value — explain it>","dow":"<value — explain it>"}}
Do not include any text outside the JSON.`,
      desc
    );
    if (!result?.expression) return res.status(502).json({ error: 'Model returned unexpected output. Try rephrasing.' });
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('AI/cron error:', e.message);
    res.status(502).json({ error: e.name === 'AbortError' ? 'Request timed out — model may be loading.' : e.message });
  }
});

// ── AI: Regex from description ────────────────────────────────────────────────
app.post('/api/ai/regex', async (req, res) => {
  const desc = (req.body?.description || '').trim().slice(0, 300);
  if (!desc) return res.status(400).json({ error: 'Missing: description' });

  const cacheKey = 'ai:regex:' + desc;
  const cached = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await ollamaJSON(
      `You are a regex expert for developers. Given a description of what to match, respond ONLY with a JSON object:
{"pattern":"<regex without delimiters>","flags":"<flags like g,i,m or empty string>","readable":"<one sentence of what it matches>","breakdown":[{"token":"<regex part>","meaning":"<plain English>"}],"examples":["<string that would match>","<another example>"]}
Do not include any text outside the JSON.`,
      desc
    );
    if (!result?.pattern) return res.status(502).json({ error: 'Model returned unexpected output. Try rephrasing.' });
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('AI/regex error:', e.message);
    res.status(502).json({ error: e.name === 'AbortError' ? 'Request timed out — model may be loading.' : e.message });
  }
});

// ── AI: Explain a Linux/shell command ────────────────────────────────────────
app.post('/api/ai/command', async (req, res) => {
  const command = (req.body?.command || '').trim().slice(0, 500);
  if (!command) return res.status(400).json({ error: 'Missing: command' });

  const cacheKey = 'ai:cmd:' + command;
  const cached = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await ollamaJSON(
      `You are a Linux and bash expert. Given a shell command or pipeline, respond ONLY with a JSON object:
{"summary":"<one sentence of what the whole command does>","parts":[{"token":"<word, flag, or operator>","type":"command|flag|argument|pipe|redirect|operator","description":"<plain English of what this part does>"}],"danger":null,"tip":null}
Set "danger" to a warning string if the command is destructive, irreversible, or risky (e.g. rm -rf, dd, chmod 777). Set "tip" to a useful pro-tip if applicable. Otherwise leave them null.
Do not include any text outside the JSON.`,
      command
    );
    if (!result?.summary) return res.status(502).json({ error: 'Model returned unexpected output.' });
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('AI/command error:', e.message);
    res.status(502).json({ error: e.name === 'AbortError' ? 'Request timed out — model may be loading.' : e.message });
  }
});

// ── AI: Explain an error message or stack trace ───────────────────────────────
app.post('/api/ai/error', async (req, res) => {
  const error = (req.body?.error || '').trim().slice(0, 2000);
  if (!error) return res.status(400).json({ error: 'Missing: error' });

  const cacheKey = 'ai:err:' + error.slice(0, 200);
  const cached = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const result = await ollamaJSON(
      `You are a software debugging expert. Given an error message or stack trace, respond ONLY with a JSON object:
{"title":"<short error name or type>","cause":"<plain English explanation of what caused this>","solutions":["<actionable fix step 1>","<fix step 2>","<fix step 3 if needed>"],"prevention":"<how to avoid this in future, or null>"}
Be specific and practical. Do not include any text outside the JSON.`,
      error
    );
    if (!result?.cause) return res.status(502).json({ error: 'Model returned unexpected output.' });
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('AI/error error:', e.message);
    res.status(502).json({ error: e.name === 'AbortError' ? 'Request timed out — model may be loading.' : e.message });
  }
});

// ── DNS lookup ────────────────────────────────────────────────────────────────
app.get('/api/dns', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase().replace(/\.$/, '');

  if (!q)                            return res.status(400).json({ error: 'Missing parameter: q' });
  if (!isValidDomain(q) && !isIP(q)) return res.status(400).json({ error: 'Invalid domain or IP address.' });

  const cacheKey = 'dns:' + q;
  const cached   = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const records = {};

  if (isIP(q)) {
    try { records.PTR = await dns.reverse(q); } catch {}
  } else {
    await Promise.allSettled([
      dns.resolve4(q).then(r   => { records.A     = r; }).catch(() => {}),
      dns.resolve6(q).then(r   => { records.AAAA  = r; }).catch(() => {}),
      dns.resolveMx(q).then(r  => { records.MX    = r.sort((a,b) => a.priority - b.priority); }).catch(() => {}),
      dns.resolveNs(q).then(r  => { records.NS    = r.sort(); }).catch(() => {}),
      dns.resolveTxt(q).then(r => { records.TXT   = r.map(t => t.join('')); }).catch(() => {}),
      dns.resolveSoa(q).then(r => { records.SOA   = r; }).catch(() => {}),
      dns.resolveCname(q).then(r=>{ records.CNAME = r; }).catch(() => {}),
      dns.resolveCaa(q).then(r => { records.CAA   = r; }).catch(() => {}),
    ]);
  }

  const result = { query: q, isIP: isIP(q), records, ts: Date.now() };
  setCache(cacheKey, result);
  res.json(result);
});

// ── WHOIS lookup ──────────────────────────────────────────────────────────────
app.get('/api/whois', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase().replace(/\.$/, '');

  if (!q)                              return res.status(400).json({ error: 'Missing parameter: q' });
  if (!isValidDomain(q) && !isIP(q))  return res.status(400).json({ error: 'Invalid domain or IP address.' });

  const cacheKey = 'whois:' + q;
  const cached   = getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const raw = isIP(q)
      ? await whoiser.ip(q, { timeout: 10000 })
      : await whoiser(q, { follow: 1, timeout: 10000 });

    const servers = Object.keys(raw).filter(k => k !== '__STATUS');
    const best    = servers.reduce((a, b) =>
      Object.keys(raw[b] || {}).length > Object.keys(raw[a] || {}).length ? b : a
    , servers[0]);
    const data = raw[best] || {};

    function pick(obj, ...keys) {
      for (const k of keys) {
        const v = obj[k] || obj[k.toUpperCase()] || obj[k.toLowerCase()];
        if (v) return Array.isArray(v) ? v.join(', ') : String(v);
      }
      return null;
    }

    const parsed = {
      domainName:   pick(data, 'Domain Name', 'domain', 'inetnum', 'NetRange'),
      registrar:    pick(data, 'Registrar', 'Registrar Name', 'org-name'),
      registrarUrl: pick(data, 'Registrar URL', 'Registrar Whois Server'),
      status:       data['Domain Status'] || data['status'] || null,
      created:      pick(data, 'Creation Date', 'Created Date', 'created', 'RegDate'),
      updated:      pick(data, 'Updated Date', 'Last Updated On', 'changed', 'Updated'),
      expires:      pick(data, 'Registry Expiry Date', 'Expiry Date', 'Registrar Registration Expiration Date', 'expires'),
      nameservers:  data['Name Server'] || data['nserver'] || data['Nameservers'] || null,
      dnssec:       pick(data, 'DNSSEC', 'dnssec'),
      netname:      pick(data, 'NetName', 'netname'),
      orgName:      pick(data, 'OrgName', 'org', 'Organisation'),
      country:      pick(data, 'Country', 'country'),
      abuse:        pick(data, 'OrgAbuseEmail', 'abuse-mailbox'),
    };

    if (parsed.nameservers) {
      parsed.nameservers = Array.isArray(parsed.nameservers)
        ? parsed.nameservers
        : String(parsed.nameservers).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    }
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
app.get('/api/health', (_, res) => res.json({ ok: true, model: AI_MODEL, uptime: process.uptime() }));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`SysUtil API listening on :${PORT}  model=${AI_MODEL}`));
