import express from 'express';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import nodeHtmlToImage from 'node-html-to-image';
import { Buffer } from 'buffer';
import fs from 'fs';
import path from 'path';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3001;
const ADMIN_NOMOR = process.env.ADMIN_NOMOR || '6283848133796';
const AUTH_DIR    = '/tmp/auth_info';

// ─── RESTORE SESI DARI ENV ────────────────────────────────────────────────────
// Setelah scan QR pertama kali, salin log creds.json ke env var WA_CREDS_JSON
// di Railway agar sesi tidak hilang saat container restart
if (process.env.WA_CREDS_JSON) {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), process.env.WA_CREDS_JSON);
    console.log('✅ Sesi dipulihkan dari WA_CREDS_JSON');
  } catch (e) {
    console.warn('⚠️  Gagal restore sesi:', e.message);
  }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let sock        = null;
let isConnected = false;
let qrString    = null;

const logger = pino({ level: 'silent' });

// ─── HELPER ───────────────────────────────────────────────────────────────────
function toJid(nomor) {
  const clean = String(nomor).replace(/[^0-9]/g, '');
  const n = clean.startsWith('0') ? '62' + clean.slice(1) : clean;
  return n + '@s.whatsapp.net';
}

// ─── CONNECT ──────────────────────────────────────────────────────────────────
async function connectWA() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`🟢 Baileys v${version.join('.')} — menghubungkan...`);

  sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ['Nota Service', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 30_000,
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrString = qr;
      console.log('📲 QR siap — buka /qr di browser');
    }

    if (connection === 'close') {
      isConnected = false;
      qrString    = null;
      const code  = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log(`🔴 Koneksi tutup (${code}). Reconnect: ${reconnect}`);
      if (reconnect) setTimeout(connectWA, 5000);
      else console.log('⚠️  Logged out — reset WA_CREDS_JSON lalu redeploy.');
    }

    if (connection === 'open') {
      isConnected = true;
      qrString    = null;
      console.log(`✅ Terhubung — ${sock.user?.id}`);

      // Print creds.json ke log → copy ke env var WA_CREDS_JSON di Railway
      try {
        const creds = fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8');
        console.log('\n════════ COPY INI KE WA_CREDS_JSON DI RAILWAY ════════');
        console.log(creds);
        console.log('════════════════════════════════════════════════════\n');
      } catch (_) {}

      // Notif ke admin
      try {
        await sock.sendMessage(toJid(ADMIN_NOMOR), {
          text: `✅ *Nota Service aktif!*\n${new Date().toLocaleString('id-ID')}`
        });
      } catch (_) {}
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// ─── EXPRESS ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

function requireConnected(req, res, next) {
  if (!isConnected || !sock)
    return res.status(503).json({ success: false, error: 'WA belum terhubung. Buka /qr dulu.' });
  next();
}

// GET / — health check (Railway pakai ini untuk cek service hidup)
app.get('/', (req, res) => {
  res.json({ status: 'ok', connected: isConnected });
});

// GET /status
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, akun: sock?.user?.id || null, qr_tersedia: !!qrString });
});

// GET /qr — tampil QR di browser HP untuk scan
app.get('/qr', (req, res) => {
  if (isConnected) {
    return res.send(`<!DOCTYPE html><html>
    <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4">
      <h2 style="color:#16a34a">✅ WhatsApp Sudah Terhubung</h2>
      <p>Service aktif. Nomor: ${sock?.user?.id?.split(':')[0] || ''}</p>
    </body></html>`);
  }
  if (!qrString) {
    return res.send(`<!DOCTYPE html><html>
    <head><meta http-equiv="refresh" content="3">
    <meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>⏳ Menunggu QR...</h2><p>Otomatis refresh dalam 3 detik</p>
    </body></html>`);
  }
  const qrEncoded = encodeURIComponent(qrString);
  res.send(`<!DOCTYPE html><html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="refresh" content="25">
    <title>Scan QR</title>
  </head>
  <body style="margin:0;font-family:sans-serif;text-align:center;padding:20px;background:#f5f5f5">
    <h2 style="font-size:18px;margin-bottom:8px">📲 Scan QR di WhatsApp</h2>
    <p style="color:#666;font-size:13px;margin-bottom:16px">
      WhatsApp → Menu ⋮ → Perangkat Tertaut → Tautkan Perangkat
    </p>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${qrEncoded}"
         style="border:6px solid #fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.15)"/>
    <p style="color:#aaa;font-size:11px;margin-top:12px">Refresh tiap 25 dtk · QR expired ~60 dtk</p>
  </body></html>`);
});

// POST /send-text
app.post('/send-text', requireConnected, async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ success: false, error: 'to dan text wajib' });
  try {
    await sock.sendMessage(toJid(to), { text });
    res.json({ success: true, to: toJid(to) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /send-image
app.post('/send-image', requireConnected, async (req, res) => {
  const { to, image, caption } = req.body;
  if (!to || !image) return res.status(400).json({ success: false, error: 'to dan image wajib' });
  try {
    await sock.sendMessage(toJid(to), {
      image: Buffer.from(image, 'base64'),
      caption: caption || '',
      mimetype: 'image/jpeg',
    });
    res.json({ success: true, to: toJid(to) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /screenshot — render HTML → gambar JPEG (binary)
app.post('/screenshot', async (req, res) => {
  const { html, options = {} } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'html wajib' });
  try {
    const buf = await nodeHtmlToImage({
      html,
      puppeteerArgs: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
      type: options.type || 'jpeg',
      quality: options.quality || 90,
      waitUntil: 'networkidle0',
    });
    res.set('Content-Type', `image/${options.type || 'jpeg'}`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /kirim-nota — all-in-one: render HTML + kirim ke WA
app.post('/kirim-nota', requireConnected, async (req, res) => {
  const { to, html, caption } = req.body;
  if (!to || !html) return res.status(400).json({ success: false, error: 'to dan html wajib' });
  try {
    const buf = await nodeHtmlToImage({
      html,
      puppeteerArgs: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
      type: 'jpeg',
      quality: 90,
      waitUntil: 'networkidle0',
    });
    await sock.sendMessage(toJid(to), {
      image: buf,
      caption: caption || '',
      mimetype: 'image/jpeg',
    });
    res.json({ success: true, to: toJid(to), bytes: buf.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Nota Service jalan di port ${PORT}`);
});

connectWA();
