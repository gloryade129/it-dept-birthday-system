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

let sock = null;
let currentQr = null;
let isConnected = false;
let connectedUser = null;
let authState = null;

const authFolder = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(authFolder)) {
  fs.mkdirSync(authFolder, { recursive: true });
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

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = await QRCode.toDataURL(qr);
      isConnected = false;
      console.log('⚡ New WhatsApp QR Code generated for Admin UI.');
    }

    if (connection === 'open') {
      currentQr = null;
      isConnected = true;
      connectedUser = sock.user;
      console.log('✅ WhatsApp Client Connected! Logged in as:', connectedUser?.id || connectedUser?.name);
    }

    if (connection === 'close') {
      isConnected = false;
      connectedUser = null;
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log('⚠️ WhatsApp Connection Closed. Reconnecting:', shouldReconnect);
      
      if (!shouldReconnect) {
        console.log('❌ WhatsApp session logged out. Admin email notification triggered.');
        currentQr = null;
        try {
          const { sendEmail } = require('./mailer');
          const { getSetting } = require('./database');
          const adminEmail = await getSetting('brevoSenderEmail') || process.env.BREVO_SENDER_EMAIL;
          if (adminEmail) {
            sendEmail({
              to: adminEmail,
              subject: '⚠️ ACTION REQUIRED: WhatsApp Disconnected - IT Dept 25/26 System',
              html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #ffffff; border-radius: 12px;">
                  <h2 style="color: #ef4444;">⚠️ WhatsApp Web Session Disconnected</h2>
                  <p>The WhatsApp automation engine for <strong>IT Department 25/26 Set</strong> has been unlinked.</p>
                  <p>Please open the Admin Portal immediately to scan the new QR Code and re-authenticate:</p>
                  <p><a href="http://localhost:3000/admin.html" style="color: #38bdf8; font-weight: bold;">Open Admin Control Panel</a></p>
                </div>
              `
            }).catch(console.error);
          }
        } catch (err) {
          console.error('Failed to send disconnect email:', err.message);
        }
      } else {
        setTimeout(connectToWhatsApp, 5000);
      }
    }
  });
}

function getStatus() {
  return {
    connected: isConnected,
    user: connectedUser,
    qr: currentQr
  };
}

async function getJoinedGroups() {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected.');
  }
  const groupData = await sock.groupFetchAllParticipating();
  const groups = Object.values(groupData).map(g => ({
    id: g.id,
    subject: g.subject,
    participantsCount: g.participants ? g.participants.length : 0
  }));
  return groups;
}

async function sendDirectMessage(phone, text, photoPath = null) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected.');
  }

  const jid = formatPhoneToJid(phone);

  if (photoPath && fs.existsSync(photoPath)) {
    const imageBuffer = fs.readFileSync(photoPath);
    await sock.sendMessage(jid, {
      image: imageBuffer,
      caption: text
    });
  } else {
    await sock.sendMessage(jid, { text });
  }

  console.log(`📱 WhatsApp DM sent to ${phone} (${jid})`);
}

async function sendGroupMessage(groupJid, text, photoPath = null) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp client is not connected.');
  }

  if (!groupJid) {
    throw new Error('Target WhatsApp Announcement Group is not configured.');
  }

  if (photoPath && fs.existsSync(photoPath)) {
    const imageBuffer = fs.readFileSync(photoPath);
    await sock.sendMessage(groupJid, {
      image: imageBuffer,
      caption: text
    });
  } else {
    await sock.sendMessage(groupJid, { text });
  }

  console.log(`📣 WhatsApp Group Message sent to ${groupJid}`);
}

module.exports = {
  connectToWhatsApp,
  getStatus,
  getJoinedGroups,
  sendDirectMessage,
  sendGroupMessage,
  formatPhoneToJid
};
