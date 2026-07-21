const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const { db, initDatabase, getSetting, setSetting, getAllSettings } = require('./database');
const { connectToWhatsApp, getStatus, getJoinedGroups } = require('./whatsapp');
const { initSchedulers, sendInstantRegistrationConfirmations, triggerManualDispatch } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoints for Cloud Load Balancers & Pxxl Router
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'IT Dept 25/26 Birthday Automation', uptime: process.uptime() });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'IT Dept 25/26 Birthday Automation', uptime: process.uptime() });
});

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
      `INSERT INTO students (fullName, nickname, birthMonth, birthDay, birthYear, phone, email, photoUrl, customNote) 
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
      email
    }).catch(err => console.error('Registration instant confirmation error:', err));

    res.status(201).json({
      message: 'Student birthday registered successfully!',
      studentId,
      fullName
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: 'Failed to register student birthday.' });
  }
});

/**
 * Get Public List of Registered Celebrants
 */
app.get('/api/students', async (req, res) => {
  try {
    const students = await db.asyncAll(`
      SELECT id, fullName, nickname, birthMonth, birthDay, birthYear, phone, email, photoUrl, customNote, createdAt 
      FROM students 
      ORDER BY birthMonth ASC, birthDay ASC
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
      SELECT dl.*, s.fullName, s.nickname, s.phone, s.email 
      FROM dispatch_logs dl 
      LEFT JOIN students s ON dl.studentId = s.id 
      ORDER BY dl.attemptedAt DESC 
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs.' });
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

// Initialize DB, WhatsApp client, and Schedulers on startup
async function startServer() {
  await initDatabase();
  initSchedulers();
  connectToWhatsApp().catch(err => console.error('WhatsApp init error:', err));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================================`);
    console.log(`🚀 IT Dept 25/26 Birthday Automation System Server Running!`);
    console.log(`🌐 Host: 0.0.0.0 | Port: ${PORT}`);
    console.log(`=============================================================`);
  });
}

startServer();
