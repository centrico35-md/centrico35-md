import 'dotenv/config';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';

const PREFIX = process.env.PREFIX || '!';
const AUTH_DIR = process.env.AUTH_DIR || './auth';
const MEDIA_DIR = process.env.MEDIA_DIR || './media';
const admins = new Set((process.env.ADMIN_NUMBERS || '').split(',').map(x => x.trim()).filter(Boolean));
const rate = new Map();

const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({
  chatId: String, sender: String, text: String, type: String, timestamp: Date
}, { timestamps: true }));

async function saveMessage(m) {
  if (process.env.LOG_MESSAGES !== 'false') {
    await Message.create({ chatId: m.key.remoteJid, sender: m.key.participant || m.key.remoteJid, text: m.message?.conversation || m.message?.extendedTextMessage?.text || '', type: Object.keys(m.message || {})[0] || 'unknown', timestamp: new Date() });
  }
}

function allowed(sender) {
  const now = Date.now();
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 10000);
  const max = Number(process.env.RATE_LIMIT_MAX || 8);
  const item = rate.get(sender) || { start: now, count: 0 };
  if (now - item.start > windowMs) { item.start = now; item.count = 0; }
  item.count++; rate.set(sender, item);
  return item.count <= max;
}

function senderOf(m) { return (m.key.participant || m.key.remoteJid || '').split('@')[0]; }
function isGroup(m) { return (m.key.remoteJid || '').endsWith('@g.us'); }
function isAdmin(m) { return admins.has(senderOf(m)); }

async function mediaToDisk(sock, m) {
  const msg = m.message || {};
  const type = ['imageMessage','videoMessage','audioMessage','documentMessage'].find(k => msg[k]);
  if (!type) return;
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const stream = await downloadContentFromMessage(msg[type], type.replace('Message',''));
  const ext = type === 'imageMessage' ? 'jpg' : type === 'videoMessage' ? 'mp4' : type === 'audioMessage' ? 'ogg' : 'bin';
  const file = path.join(MEDIA_DIR, `${Date.now()}-${senderOf(m)}.${ext}`);
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  await fs.writeFile(file, Buffer.concat(chunks));
  return file;
}

async function start() {
  await fs.mkdir(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false, markOnlineOnConnect: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('CENTRICO-MD connected.');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) setTimeout(start, 3000); else console.error('Logged out; delete auth and pair again.');
    }
  });
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    const text = action === 'add' ? `👋 Welcome @${participants[0].split('@')[0]}!` : action === 'remove' ? `Goodbye @${participants[0].split('@')[0]}!` : '';
    if (text) await sock.sendMessage(id, { text, mentions: participants });
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;
      try {
        await saveMessage(m);
        const sender = senderOf(m); if (!allowed(sender)) continue;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
        if (m.message.imageMessage || m.message.videoMessage || m.message.audioMessage || m.message.documentMessage) await mediaToDisk(sock, m);
        if (!text.startsWith(PREFIX)) {
          if (/^(hi|hello|hey)$/i.test(text.trim())) await sock.sendPresenceUpdate('composing', m.key.remoteJid), await sock.sendMessage(m.key.remoteJid, { text: '👋 Hello! Send !help for commands.' });
          continue;
        }
        const [cmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/); const chat = m.key.remoteJid;
        if (cmd === 'help') await sock.sendMessage(chat, { text: `╭━━〔 CENTRICO-MD 〕━━⬣\n│ ${PREFIX}help\n│ ${PREFIX}info\n│ ${PREFIX}ping\n│ ${PREFIX}tagall (admin)\n│ ${PREFIX}kick @user (admin)\n╰━━━━━━━━━━━━⬣` });
        else if (cmd === 'ping') await sock.sendMessage(chat, { text: '🏓 Pong!' });
        else if (cmd === 'info') await sock.sendMessage(chat, { text: `🤖 CENTRICO-MD\n⚡ Prefix: ${PREFIX}\n📦 Baileys MD bot` });
        else if (cmd === 'tagall' && isGroup(m) && isAdmin(m)) { const meta = await sock.groupMetadata(chat); await sock.sendMessage(chat, { text: meta.participants.map(p => `@${p.id.split('@')[0]}`).join(' '), mentions: meta.participants.map(p => p.id) }); }
        else if (cmd === 'kick' && isGroup(m) && isAdmin(m)) { const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid || []; if (mentioned.length) await sock.groupParticipantsUpdate(chat, mentioned, 'remove'); }
        else if (cmd === 'kick' || cmd === 'tagall') await sock.sendMessage(chat, { text: '❌ Admin permission required.' });
      } catch (err) { console.error('Message error:', err); }
    }
  });
  return sock;
}

if (process.env.MONGODB_URI) mongoose.connect(process.env.MONGODB_URI).then(() => console.log('MongoDB connected.')).catch(console.error);
start().catch(console.error);
process.on('SIGINT', async () => { await mongoose.disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await mongoose.disconnect(); process.exit(0); });
