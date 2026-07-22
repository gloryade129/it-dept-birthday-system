const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const { db, initDatabase, getSetting, setSetting, getAllSettings } = require('./database');
const { connectToWhatsApp, getStatus, getJoinedGroups } = require('./whatsapp');
const { initSchedulers, sendInstantRegistrationConfirmations, triggerManualDispatch } = require('./scheduler');
const { sendEmail, renderTemplate } = require('./mailer');


const app = express();
const PORT = process.env.PORT || 3000;

// Trust Pxxl/nginx reverse proxy (required for correct IP & protocol forwarding)
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoints — must come BEFORE static middleware so Pxxl proxy rollover probe gets instant JSON 200
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'IT Dept 25/26 Birthday Automation', uptime: process.uptime() });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'IT Dept 25/26 Birthday Automation', uptime: process.uptime() });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));



// Setup file uploads for student photos
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'photo-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// PUBLIC ENDPOINTS
// -------------------------------------------------------------

/**
 * Public Form Submission: Register Student Birthday
 */
app.post('/api/students', upload.single('photo'), async (req, res) => {
  try {
    const { fullName, nickname, birthMonth, birthDay, birthYear, phone, email, customNote } = req.body;

    if (!fullName || !birthMonth || !birthDay || !phone || !email) {
      return res.status(400).json({ error: 'Full name, birth month, birth day, phone, and email are required.' });
    }

    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await db.asyncRun(
      `INSERT INTO students (fullname, nickname, birthmonth, birthday, birthyear, phone, email, photourl, customnote) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fullName, nickname || null, parseInt(birthMonth), parseInt(birthDay), birthYear ? parseInt(birthYear) : null, phone, email, photoUrl, customNote || null]
    );

    const studentId = result.lastID;

    // Send instant welcome confirmation (WhatsApp DM + Email)
    sendInstantRegistrationConfirmations(studentId, {
      fullName,
      nickname: nickname || fullName.split(' ')[0],
      birthMonth,
      birthDay,
      phone,
      email,
      photoUrl
    }).catch(err => console.error('Registration instant confirmation error:', err));

    res.status(201).json({
      message: 'Student birthday registered successfully!',
      studentId,
      fullName
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: err.message || 'Failed to register student birthday.' });
  }
});

/**
 * Get Public List of Registered Celebrants
 */
app.get('/api/students', async (req, res) => {
  try {
    const students = await db.asyncAll(`
      SELECT 
        id,
        fullname, 
        nickname, 
        birthmonth, 
        birthday, 
        birthyear, 
        phone, 
        email, 
        photourl, 
        customnote, 
        createdat
      FROM students 
      ORDER BY birthmonth ASC, birthday ASC
    `);
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch registered students.' });
  }
});


// -------------------------------------------------------------
// ADMIN ENDPOINTS
// -------------------------------------------------------------

/**
 * Delete Student Record
 */
app.delete('/api/students/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.asyncRun('DELETE FROM students WHERE id = ?', [id]);
    res.json({ message: 'Student record deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student.' });
  }
});

/**
 * WhatsApp Connection Status
 */
app.get('/api/whatsapp/status', (req, res) => {
  res.json(getStatus());
});

/**
 * Force WhatsApp Reconnection & Fresh QR Generation
 */
app.post('/api/whatsapp/reconnect', async (req, res) => {
  try {
    reconnectWhatsApp().catch(err => console.error('WhatsApp manual reconnect error:', err));
    res.json({ message: 'WhatsApp QR Code generation triggered.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get joined WhatsApp Groups
 */
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const groups = await getJoinedGroups();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get Admin Settings
 */
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

/**
 * Save Admin Settings
 */
app.post('/api/settings', async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await setSetting(key, value);
    }
    res.json({ message: 'Settings saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

/**
 * Get Dispatch Audit Logs
 */
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await db.asyncAll(`
      SELECT 
        dl.id, dl.studentid, dl.year, dl.channel, dl.status, dl.attemptedat, dl.errormessage,
        s.fullname, s.nickname, s.phone, s.email
      FROM dispatch_logs dl 
      LEFT JOIN students s ON dl.studentid = s.id 
      ORDER BY dl.attemptedat DESC 
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

/**
 * Return Celebrant Uploaded Photo as base64 & Group Caption for Admin Portal
 */
app.get('/api/flyer/:studentId', async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId);
    const rawStudent = await db.asyncGet('SELECT * FROM students WHERE id = ?', [studentId]);
    if (!rawStudent) return res.status(404).json({ error: 'Student not found.' });

    const fullName = rawStudent.fullName || rawStudent.fullname || '';
    const nickname = rawStudent.nickname || (fullName ? fullName.split(' ')[0] : 'Friend');
    const birthMonth = rawStudent.birthMonth || rawStudent.birthmonth;
    const birthDay = rawStudent.birthDay || rawStudent.birthday;
    const photoUrl = rawStudent.photoUrl || rawStudent.photourl;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const birthDateStr = `${monthNames[parseInt(birthMonth, 10) - 1]} ${birthDay}`;

    let photoBase64 = null;
    if (photoUrl) {
      const cleanPath = photoUrl.replace(/^[/\\]+/, '');
      const fullPath = path.join(__dirname, 'public', cleanPath);
      if (fs.existsSync(fullPath)) {
        const fileBuf = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        photoBase64 = `data:${mime};base64,${fileBuf.toString('base64')}`;
      }
    }

    const settings = await getAllSettings();
    const templateData = {
      fullName,
      nickname,
      birthDate: birthDateStr,
      phone: rawStudent.phone || '',
      email: rawStudent.email || '',
      department: 'Information Technology 25/26'
    };

    const rawGroupTpl = settings.birthdayGroupTemplate || '🎂 IT DEPT 25/26 BIRTHDAY ANNOUNCEMENT 🎂\n\nToday we celebrate *{fullName}* ({nickname})! 🎉🎈';
    const caption = renderTemplate(rawGroupTpl, templateData);

    res.json({
      flyerBase64: photoBase64,
      caption,
      fullName,
      nickname,
      photoUrl
    });
  } catch (err) {
    console.error('Photo Preview API Error:', err);
    res.status(500).json({ error: 'Failed to retrieve celebrant photo preview.' });
  }
});


/**
 * Manual Trigger Birthday Wishes
 */
app.post('/api/manual-trigger', async (req, res) => {
  try {
    const { studentId, channels } = req.body;
    if (!studentId) return res.status(400).json({ error: 'Student ID required.' });
    const result = await triggerManualDispatch(studentId, channels || ['dm', 'email', 'group']);
    res.json({ message: 'Manual dispatch completed.', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express HTTP Server FIRST so Pxxl Proxy Health Checks Pass Instantly
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=============================================================`);
  console.log(`🚀 IT Dept 25/26 Birthday Automation System Server Running!`);
  console.log(`🌐 Host: 0.0.0.0 | Port: ${PORT}`);
  console.log(`=============================================================`);

  // Initialize DB, WhatsApp client, and Schedulers in background
  initDatabase().then(() => {
    initSchedulers();
    connectToWhatsApp().catch(err => console.error('WhatsApp init error:', err.message));
  }).catch(err => {
    console.error('Database init warning:', err.message);
  });
});

// Graceful shutdown for Pxxl container rollover (SIGTERM signal)
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received — shutting down gracefully for Pxxl rollover...');
  server.close(() => {
    console.log('✅ HTTP server closed cleanly.');
    process.exit(0);
  });
  // Force exit after 10s if connections don't drain
  setTimeout(() => process.exit(0), 10000);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

