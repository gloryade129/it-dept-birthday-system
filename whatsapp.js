const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const { db, getSetting, setSetting } = require('./database');
const { sendAdminAlertEmail } = require('./mailer');

let sock = null;
let currentQr = null;
let isConnected = false;
let connectedUser = null;
let authState = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const authFolder = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(authFolder)) {
  fs.mkdirSync(authFolder, { recursive: true });
}

/**
 * Restore auth_info_baileys files from Database backup on cloud container startup
 */
async function restoreAuthFromDatabase() {
  try {
    const backupJson = await getSetting('whatsapp_session_backup');
    if (backupJson) {
      const filesMap = JSON.parse(backupJson);
      for (const [filename, content] of Object.entries(filesMap)) {
        const filePath = path.join(authFolder, filename);
        fs.writeFileSync(filePath, content);
      }
      console.log('✅ Restored persistent WhatsApp session keys from database backup.');
    }
  } catch (err) {
    console.warn('WhatsApp DB session restore warning:', err.message);
  }
}

/**
 * Backup auth_info_baileys files to Database settings table
 */
async function backupAuthToDatabase() {
  try {
    if (!fs.existsSync(authFolder)) return;
    const files = fs.readdirSync(authFolder);
    const filesMap = {};
    for (const f of files) {
      const filePath = path.join(authFolder, f);
      if (fs.statSync(filePath).isFile()) {
        filesMap[f] = fs.readFileSync(filePath, 'utf8');
      }
    }
    await setSetting('whatsapp_session_backup', JSON.stringify(filesMap));
  } catch (err) {
    console.warn('WhatsApp DB session backup warning:', err.message);
  }
}

/**
 * Clean phone number to WhatsApp JID format
 * Example: "08012345678" -> "2348012345678@s.whatsapp.net" (Assuming Nigerian country code 234 if starts with 0)
 */
function formatPhoneToJid(phoneStr) {
  let cleaned = phoneStr.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.slice(1);
  }
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = cleaned + '@s.whatsapp.net';
  }
  return cleaned;
}

async function connectToWhatsApp() {
  const logger = pino({ level: 'silent' });

  // Restore session keys from SQL database if container restarted
  await restoreAuthFromDatabase();

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  authState = state;

  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: true,
    auth: state,
    browser: ['IT Dept 25/26 System', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await backupAuthToDatabase();
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = await QRCode.toDataURL(qr);
      isConnected = false;
      connectedUser = null;
      console.log('⚡ New WhatsApp QR Code generated for Admin authentication.');
    }

    if (connection === 'open') {
      currentQr = null;
      isConnected = true;
      connectedUser = sock.user;
      reconnectAttempts = 0;
      console.log('✅ WhatsApp Web Client connected successfully:', sock.user?.id || sock.user?.name);
      await backupAuthToDatabase();
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`⚠️ WhatsApp connection closed (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (statusCode === DisconnectReason.loggedOut) {
        // Clear local and DB session backup if explicitly logged out
        if (fs.existsSync(authFolder)) {
          fs.rmSync(authFolder, { recursive: true, force: true });
        }
        await setSetting('whatsapp_session_backup', '');
        
        // Notify admin via Brevo email that WhatsApp session requires re-auth
        sendAdminAlertEmail(
          'WhatsApp Disconnected - Re-Authentication Required',
          'Your WhatsApp Web session for the IT Dept 25/26 Birthday System has logged out. Please visit the Admin Portal to scan a new QR code.'
        ).catch(console.error);
      }

      if (shouldReconnect) {
        // Status 440 = logged in from another device — wait longer before retry
        const delay = statusCode === 440
          ? 15000
          : Math.min(5000 * Math.pow(2, reconnectAttempts), 60000);
        reconnectAttempts++;
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
          console.log(`🔄 Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(connectToWhatsApp, delay);
        } else {
          console.warn('⚠️ Max reconnect attempts reached. Please scan QR Code again in Admin Portal.');
          reconnectAttempts = 0;
        }
      }
    }
  });

  return sock;
}

function getStatus() {
  return {
    connected: isConnected,
    qr: currentQr,
    user: connectedUser
  };
}

async function getJoinedGroups() {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected.');
  }
  const groupData = await sock.groupFetchAllParticipating();
  const groupsList = Object.values(groupData).map(g => ({
    id: g.id,
    subject: g.subject,
    participantsCount: g.participants?.length || 0
  }));
  return groupsList;
}

async function sendDirectMessage(phoneStr, textMessage) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected.');
  }
  const jid = formatPhoneToJid(phoneStr);
  const result = await sock.sendMessage(jid, { text: textMessage });
  return result;
}

async function sendGroupMessageWithImage(groupJid, textMessage, imageBuffer) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected.');
  }
  let messagePayload = { caption: textMessage };
  if (imageBuffer) {
    messagePayload.image = imageBuffer;
  } else {
    messagePayload = { text: textMessage };
  }
  const result = await sock.sendMessage(groupJid, messagePayload);
  return result;
}

/**
 * Alias used by scheduler.js — accepts file path string OR raw Buffer.
 * Automatically reads file from disk if a path string is provided.
 */
async function sendGroupMessage(groupJid, textMessage, imagePathOrBuffer) {
  let imageBuffer = null;
  if (imagePathOrBuffer) {
    if (typeof imagePathOrBuffer === 'string') {
      // It's a file path — read it into a Buffer
      try {
        imageBuffer = fs.readFileSync(imagePathOrBuffer);
      } catch (err) {
        console.warn('Could not read flyer image file:', err.message);
      }
    } else {
      imageBuffer = imagePathOrBuffer;
    }
  }
  return sendGroupMessageWithImage(groupJid, textMessage, imageBuffer);
}

module.exports = {
  connectToWhatsApp,
  getStatus,
  getJoinedGroups,
  sendDirectMessage,
  sendGroupMessage,
  sendGroupMessageWithImage
};
