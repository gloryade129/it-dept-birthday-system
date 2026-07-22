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
  let cleaned = (phoneStr || '').replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.slice(1);
  } else if (cleaned.length === 10) {
    cleaned = '234' + cleaned;
  }
  if (!cleaned.endsWith('@s.whatsapp.net')) {
    cleaned = cleaned + '@s.whatsapp.net';
  }
  return cleaned;
}

/**
 * Robustly extract & format group JID string to Baileys @g.us format
 * Handles cases where user stored "Testing 1 (120363427150795692@g.us)" or raw JID
 */
function formatGroupJid(groupStr) {
  let cleaned = (groupStr || '').trim();
  if (!cleaned) return '';
  
  // Extract pure JID pattern like 120363427150795692@g.us or 2348012345-1612345@g.us
  const jidMatch = cleaned.match(/([a-zA-Z0-9._-]+@g\.us)/);
  if (jidMatch) {
    return jidMatch[1];
  }
  if (!cleaned.endsWith('@g.us')) {
    cleaned = cleaned + '@g.us';
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

async function sendDirectMessage(phoneStr, textMessage, imagePathOrBuffer) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected. Please scan QR Code in Admin Portal.');
  }

  const jid = formatPhoneToJid(phoneStr);

  // Check if trying to send to the logged-in account itself
  const connectedId = (sock.user?.id || '').split('@')[0].split(':')[0];
  const targetId = jid.split('@')[0];

  if (connectedId && targetId && connectedId === targetId) {
    console.log(`ℹ️ Recipient ${phoneStr} is the logged-in WhatsApp account itself. Skipping self-DM to prevent WhatsApp multi-device encryption placeholders.`);
    return { status: 'skipped_self' };
  }

  let imageBuffer = null;

  if (imagePathOrBuffer) {
    if (typeof imagePathOrBuffer === 'string') {
      try {
        if (fs.existsSync(imagePathOrBuffer)) {
          imageBuffer = fs.readFileSync(imagePathOrBuffer);
        }
      } catch (err) {
        console.warn('Could not read image file for WhatsApp DM:', err.message);
      }
    } else if (Buffer.isBuffer(imagePathOrBuffer)) {
      imageBuffer = imagePathOrBuffer;
    }
  }

  if (imageBuffer) {
    try {
      console.log(`📤 Sending direct WhatsApp message with graphic flyer image attachment to ${jid}...`);
      const res = await sock.sendMessage(jid, {
        image: imageBuffer,
        caption: textMessage
      });
      console.log(`✅ Direct WhatsApp message with graphic flyer sent cleanly to ${jid}`);
      return res;
    } catch (imgErr) {
      console.warn(`⚠️ Direct message image attachment dispatch failed (${imgErr.message}). Falling back to text-only DM...`);
    }
  }

  console.log(`📤 Sending text-only direct WhatsApp message to ${jid}...`);
  const result = await sock.sendMessage(jid, { text: textMessage });
  console.log(`✅ Direct WhatsApp message sent cleanly to ${jid}`);
  return result;
}

/**
 * Send WhatsApp Group Announcement with Flyer Image attachment and failsafe
 */
async function sendGroupMessage(groupJidStr, textMessage, imagePathOrBuffer) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected. Please scan QR Code in Admin Portal.');
  }

  const groupJid = formatGroupJid(groupJidStr);
  if (!groupJid) {
    throw new Error(`Invalid WhatsApp Group JID: "${groupJidStr}". Please re-select the target group in Admin Portal.`);
  }

  let imageBuffer = null;
  if (imagePathOrBuffer) {
    if (typeof imagePathOrBuffer === 'string') {
      try {
        if (fs.existsSync(imagePathOrBuffer)) {
          imageBuffer = fs.readFileSync(imagePathOrBuffer);
        }
      } catch (err) {
        console.warn('Could not read flyer image file for group message:', err.message);
      }
    } else if (Buffer.isBuffer(imagePathOrBuffer)) {
      imageBuffer = imagePathOrBuffer;
    }
  }

  // 1. Try sending message with PNG/JPEG image attachment
  if (imageBuffer) {
    try {
      console.log(`📤 Sending WhatsApp Group announcement with flyer image to JID "${groupJid}"...`);
      const res = await sock.sendMessage(groupJid, {
        image: imageBuffer,
        caption: textMessage
      });
      console.log(`✅ WhatsApp Group announcement with flyer sent cleanly to JID "${groupJid}"`);
      return res;
    } catch (imgErr) {
      console.warn(`⚠️ Group image dispatch failed (${imgErr.message}). Falling back to text-only group announcement...`);
    }
  }

  // 2. Failsafe: Text-only group announcement
  console.log(`📤 Sending text-only WhatsApp Group announcement to JID "${groupJid}"...`);
  const textRes = await sock.sendMessage(groupJid, { text: textMessage });
  console.log(`✅ WhatsApp Group text announcement sent cleanly to JID "${groupJid}"`);
  return textRes;
}

module.exports = {
  connectToWhatsApp,
  getStatus,
  getJoinedGroups,
  sendDirectMessage,
  sendGroupMessage
};
