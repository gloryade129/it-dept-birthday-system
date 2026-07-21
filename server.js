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
      return res.status(400).json({ error: 'Please provide all required fields (Full Name, Birth Month, Birth Day, Phone, and Email).' });
    }

    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await db.asyncRun(
      `INSERT INTO students (fullName, nickname, birthMonth, birthDay, birthYear, phone, email, photoUrl, customNote)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fullName, nickname || null, parseInt(birthMonth, 10), parseInt(birthDay, 10), birthYear ? parseInt(birthYear, 10) : null, phone, email, photoUrl, customNote || null]
    );

    const newStudent = await db.asyncGet('SELECT * FROM students WHERE id = ?', [result.lastID]);

    // Send Instant Welcome WhatsApp DM and Brevo Email Confirmation asynchronously
    sendInstantRegistrationConfirmations(newStudent).catch(err => {
      console.error('Instant registration confirmation background task error:', err);
    });

    res.status(201).json({
      message: 'Student birthday details registered successfully!',
      student: newStudent
    });
  } catch (err) {
    console.error('Error registering student:', err);
    res.status(500).json({ error: 'Failed to register student details.' });
  }
});

// -------------------------------------------------------------
// ADMIN ENDPOINTS
// -------------------------------------------------------------

/**
 * Get WhatsApp Connection & QR Code Status
 */
app.get('/api/whatsapp/status', (req, res) => {
  res.json(getStatus());
});

/**
 * Get Joined WhatsApp Groups
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
 * Get All Registered Students
 */
app.get('/api/students', async (req, res) => {
  try {
    const students = await db.asyncAll('SELECT * FROM students ORDER BY birthMonth ASC, birthDay ASC');
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch students.' });
  }
});

/**
 * Update Student Details
 */
app.put('/api/students/:id', upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, nickname, birthMonth, birthDay, birthYear, phone, email, customNote } = req.body;

    let photoUrlUpdate = '';
    const params = [fullName, nickname, parseInt(birthMonth, 10), parseInt(birthDay, 10), birthYear ? parseInt(birthYear, 10) : null, phone, email, customNote];

    if (req.file) {
      photoUrlUpdate = ', photoUrl = ?';
      params.push(`/uploads/${req.file.filename}`);
    }

    params.push(id);

    await db.asyncRun(
      `UPDATE students SET fullName = ?, nickname = ?, birthMonth = ?, birthDay = ?, birthYear = ?, phone = ?, email = ?, customNote = ? ${photoUrlUpdate} WHERE id = ?`,
      params
    );

    const updated = await db.asyncGet('SELECT * FROM students WHERE id = ?', [id]);
    res.json({ message: 'Student updated successfully', student: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update student.' });
  }
});

/**
 * Delete Student
 */
app.delete('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.asyncRun('DELETE FROM students WHERE id = ?', [id]);
    res.json({ message: 'Student deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student.' });
  }
});

/**
 * Get System Settings
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
 * Update System Settings
 */
app.post('/api/settings', async (req, res) => {
  try {
    const settingsObj = req.body;
    for (const [key, val] of Object.entries(settingsObj)) {
      await setSetting(key, val);
    }
    res.json({ message: 'Settings saved successfully!' });
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

  app.listen(PORT, () => {
    console.log(`=============================================================`);
    console.log(`🚀 IT Dept 25/26 Birthday Automation System Server Running!`);
    console.log(`🌐 Student Form:  http://localhost:${PORT}/index.html`);
    console.log(`🔑 Admin Portal: http://localhost:${PORT}/admin.html`);
    console.log(`=============================================================`);
  });
}

startServer();
