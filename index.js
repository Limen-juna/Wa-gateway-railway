import express from 'express';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import nodeHtmlToImage from 'node-html-to-image';
import { Buffer } from 'buffer';
import fs from 'fs';
import path from 'path';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3001;
const ADMIN_NOMOR = process.env.ADMIN_NOMOR || '6283848133796';
const AUTH_DIR    = '/tmp/auth_info'; // pakai /tmp agar Railway bisa tulis

// ─── RESTORE SESI DARI ENV (untuk Railway agar tidak logout saat restart) ─────
// Saat pertama deploy, WA_CREDS_JSON kosong → scan QR
// Setelah scan, salin isi /tmp/auth_info/creds.json ke env var WA_CREDS_JSON di Railway
if (process.env.WA_CREDS_JSON) {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(AUTH_DIR, 'creds.json'),
      process.env.WA_CREDS_JSON
    );
    console.log('✅ Sesi WhatsApp dipulihkan dari environment variable.');
  } catch (e) {
    console.warn('⚠️  Gagal restore sesi:', e.message);
  }
}

// ─── LOGGER ───────────────────────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─── STORE ────────────────────────────────────────────────────────────────────


// ─── STATE ────────────────────────────────────────────────────────────────────
let sock        = null;
let isConnected = false;
let qrString    = null;

// ─── HELPER: format nomor ke JID ──────────────────────────────────────────────
function toJid(nomor) {
  const clean = String(nomor).replace(/[^0-9]/g, '');
  const normalized = clean.startsWith('0') ? '62' + clean.slice(1) : clean;
  return normalized + '@s.whatsapp.net';
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
    browser: ['Nota Thermal Service', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
  });

  store.bind(sock.ev);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrString = qr;
      console.log('\n📲 QR siap — buka /qr di browser untuk scan\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      qrString    = null;
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('🔴 Koneksi tutup. Reconnect:', shouldReconnect);
      if (shouldReconnect) setTimeout(connectWA, 3000);
      else console.log('⚠️  Logged out. Reset WA_CREDS_JSON di Railway lalu redeploy.');
    }

    if (connection === 'open') {
      isConnected = true;
      qrString    = null;
      console.log(`\n✅ Terhubung! Akun: ${sock.user?.id}\n`);

      // Tampilkan isi creds.json → paste ke env var WA_CREDS_JSON di Railway
      try {
        const creds = fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8');
        console.log('\n══════════════════════════════════════════════════════');
        console.log('📋 PENTING: Salin teks di bawah ini, paste ke');
        console.log('   Railway → Variables → WA_CREDS_JSON');
        console.log('   supaya sesi tidak hilang saat container restart!');
        console.log('══════════════════════════════════════════════════════');
        console.log(creds);
        console.log('══════════════════════════════════════════════════════\n');
      } catch (_) {}

      // Notif ke admin
      try {
        await sock.sendMessage(toJid(ADMIN_NOMOR), {
          text: `✅ *Baileys Nota Service* aktif!\n\nSiap kirim nota ke pelanggan.\n_${new Date().toLocaleString('id-ID')}_`
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
    return res.status(503).json({ success: false, error: 'WhatsApp belum terhubung. Buka /qr' });
  next();
}

// GET /status
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, akun: sock?.user?.id || null, qr_tersedia: !!qrString });
});

// GET /qr — tampil di browser HP untuk scan
app.get('/qr', (req, res) => {
  if (isConnected) {
    return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4">
      <h2 style="color:#16a34a">✅ WhatsApp Sudah Terhubung</h2>
      <p>Service aktif dan siap digunakan.</p>
    </body></html>`);
  }
  if (!qrString) {
    return res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>⏳ Menunggu QR Code...</h2><p>Halaman otomatis refresh...</p>
    </body></html>`);
  }
  const qrEncoded = encodeURIComponent(qrString);
  res.send(`<!DOCTYPE html><html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="refresh" content="25">
    <title>Scan QR Nota Service</title>
  </head>
  <body style="font-family:sans-serif;text-align:center;padding:20px;background:#f5f5f5;margin:0">
    <h2 style="font-size:20px;margin-bottom:6px">📲 Scan QR ini di WhatsApp</h2>
    <p style="color:#666;font-size:13px;margin-bottom:16px">
      WhatsApp → Menu (⋮) → Perangkat Tertaut → Tautkan Perangkat
    </p>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${qrEncoded}"
         style="border:6px solid white;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.12);max-width:290px"/>
    <p style="color:#999;font-size:11px;margin-top:12px">Auto refresh tiap 25 detik • QR expired tiap ~60 detik</p>
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
  if (!to || !image) return res.status(400).json({ success: false, error: 'to dan image (base64) wajib' });
  try {
    await sock.sendMessage(toJid(to), {
      image: Buffer.from(image, 'base64'),
      caption: caption || '',
      mimetype: 'image/jpeg'
    });
    res.json({ success: true, to: toJid(to) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /screenshot — dipakai node n8n render HTML → gambar
app.post('/screenshot', async (req, res) => {
  const { html, options = {} } = req.body;
  if (!html) return res.status(400).json({ success: false, error: 'html wajib' });
  try {
    const buf = await nodeHtmlToImage({
      html,
      puppeteerArgs: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
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
      puppeteerArgs: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
      type: 'jpeg',
      quality: 90,
      waitUntil: 'networkidle0',
    });
    await sock.sendMessage(toJid(to), {
      image: buf,
      caption: caption || '',
      mimetype: 'image/jpeg'
    });
    res.json({ success: true, to: toJid(to), bytes: buf.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Baileys Nota Service → port ${PORT}`);
  console.log(`   Admin: ${ADMIN_NOMOR}`);
  console.log(`\n   GET  /status\n   GET  /qr\n   POST /send-text\n   POST /send-image\n   POST /screenshot\n   POST /kirim-nota\n`);
});

connectWA();
