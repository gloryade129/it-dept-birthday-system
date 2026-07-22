const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const usePostgres = !!process.env.DATABASE_URL;
let pgPool = null;
let sqliteDb = null;

if (usePostgres) {
  console.log('🐘 Initializing Cloud PostgreSQL Database Engine...');
  try {
    const isSslEnabled = process.env.DATABASE_SSL === 'true';
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isSslEnabled ? { rejectUnauthorized: false } : false
    });
  } catch (err) {
    console.error('PostgreSQL init error:', err.message);
  }
} else {
  console.log('📂 Initializing Local SQLite Database Engine...');
  try {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = path.join(__dirname, 'data', 'birthday_system.db');
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    sqliteDb = new sqlite3.Database(dbPath);
  } catch (err) {
    console.warn('⚠️ SQLite native bindings not available in container. Set DATABASE_URL for Cloud PostgreSQL.');
  }
}

// Convert SQL parameters from SQLite style (?) to PostgreSQL style ($1, $2, ...)
function formatSqlForPg(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

const db = {
  asyncRun: function (sql, params = []) {
    if (usePostgres && pgPool) {
      return new Promise(async (resolve, reject) => {
        try {
          let pgSql = formatSqlForPg(sql);
          const trimmed = pgSql.trim().toUpperCase();
          // Only append RETURNING * for pure INSERT statements (not CREATE TABLE, etc.)
          if (trimmed.startsWith('INSERT') && !trimmed.includes('RETURNING')) {
            pgSql += ' RETURNING *';
          }
          const res = await pgPool.query(pgSql, params);
          const firstRow = res.rows && res.rows[0] ? res.rows[0] : {};
          const lastID = firstRow.id || null;
          resolve({ lastID, rowCount: res.rowCount });
        } catch (err) {
          reject(err);
        }
      });
    } else if (sqliteDb) {
      return new Promise((resolve, reject) => {
        sqliteDb.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    } else {
      console.warn('⚠️ Database query skipped (No active DB connection).');
      return Promise.resolve({ lastID: null, rowCount: 0 });
    }
  },

  asyncGet: function (sql, params = []) {
    if (usePostgres && pgPool) {
      return new Promise(async (resolve, reject) => {
        try {
          const pgSql = formatSqlForPg(sql);
          const res = await pgPool.query(pgSql, params);
          resolve(res.rows[0] || null);
        } catch (err) {
          reject(err);
        }
      });
    } else if (sqliteDb) {
      return new Promise((resolve, reject) => {
        sqliteDb.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });
    } else {
      return Promise.resolve(null);
    }
  },

  asyncAll: function (sql, params = []) {
    if (usePostgres && pgPool) {
      return new Promise(async (resolve, reject) => {
        try {
          const pgSql = formatSqlForPg(sql);
          const res = await pgPool.query(pgSql, params);
          resolve(res.rows);
        } catch (err) {
          reject(err);
        }
      });
    } else if (sqliteDb) {
      return new Promise((resolve, reject) => {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
    } else {
      return Promise.resolve([]);
    }
  }
};

async function initDatabase() {
  if (!usePostgres && !sqliteDb) {
    console.warn('⚠️ Skipping DB table initialization: No active PostgreSQL connection string (DATABASE_URL) and SQLite native module is disabled in cloud container.');
    return;
  }

  try {
    if (usePostgres && pgPool) {
      await db.asyncRun(`
        CREATE TABLE IF NOT EXISTS students (
          id SERIAL PRIMARY KEY,
          fullname VARCHAR(255) NOT NULL,
          nickname VARCHAR(255),
          birthmonth INTEGER NOT NULL,
          birthday INTEGER NOT NULL,
          birthyear INTEGER,
          phone VARCHAR(50) NOT NULL,
          email VARCHAR(255) NOT NULL,
          photourl TEXT,
          customnote TEXT,
          createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.asyncRun(`
        CREATE TABLE IF NOT EXISTS dispatch_logs (
          id SERIAL PRIMARY KEY,
          studentid INTEGER NOT NULL,
          year INTEGER NOT NULL,
          channel VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          attemptedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          errormessage TEXT
        )
      `);

      await db.asyncRun(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT
        )
      `);
    } else if (sqliteDb) {
      await db.asyncRun(`
        CREATE TABLE IF NOT EXISTS students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fullname TEXT NOT NULL,
          nickname TEXT,
          birthmonth INTEGER NOT NULL,
          birthday INTEGER NOT NULL,
          birthyear INTEGER,
          phone TEXT NOT NULL,
          email TEXT NOT NULL,
          photourl TEXT,
          customnote TEXT,
          createdat DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.asyncRun(`
        CREATE TABLE IF NOT EXISTS dispatch_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          studentid INTEGER NOT NULL,
          year INTEGER NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL,
          attemptedat DATETIME DEFAULT CURRENT_TIMESTAMP,
          errormessage TEXT,
          FOREIGN KEY(studentId) REFERENCES students(id) ON DELETE CASCADE
        )
      `);

      await db.asyncRun(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);
    }

    // Initialize default settings if not exists
    const defaults = {
      adminPhone: '09168047236',
      targetGroupJid: '',
      targetGroupName: '',
      midnightTime: '00:00',
      morningTime: '09:00',
      welcomeDmTemplate: 'Hi {nickname}, Welcome to the IT Department 25/26 Birthday Registry.\n\nWe have recorded your birthday as {birthDate}. You will receive special birthday wishes on your special day!',
      welcomeEmailSubject: 'Welcome to IT Dept 25/26 Birthday Registry',
      welcomeEmailTemplate: `
        <div style="font-family: 'Poppins', 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #080c14; color: #f1f5f9; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
          <h2 style="color: #38bdf8; text-align: center; font-size: 22px; font-weight: 700;">Welcome to IT Dept 25/26</h2>
          <p>Dear <strong>{fullName}</strong>,</p>
          <p>Your details have been successfully registered in the <strong>Information Technology Department 25/26 Set Birthday Registry</strong>.</p>
          <div style="background: #0f172a; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #38bdf8;">
            <p style="margin: 4px 0;"><strong>Name:</strong> {fullName} ({nickname})</p>
            <p style="margin: 4px 0;"><strong>Birthday:</strong> {birthDate}</p>
            <p style="margin: 4px 0;"><strong>WhatsApp:</strong> {phone}</p>
          </div>
          <p>When your special day comes, expect warm birthday wishes in your WhatsApp DM, an official announcement in our department group, and a birthday card in your inbox.</p>
          <p style="color: #94a3b8; font-size: 13px; text-align: center; margin-top: 30px;">Information Technology Department 25/26 Set</p>
        </div>
      `,
      birthdayDmTemplate: 'Happy Birthday, {nickname}!\n\nOn behalf of the Information Technology Department 25/26 Set, we celebrate you today! May your year be filled with success, joy, peace, and great achievements!',
      birthdayGroupTemplate: 'IT DEPT 25/26 BIRTHDAY ANNOUNCEMENT\n\nToday we celebrate our department member, *{fullName}* ({nickname})!\n\nJoin us in showering {nickname} with warm wishes and celebration today!',
      birthdayEmailSubject: 'Happy Birthday from IT Dept 25/26!',
      birthdayEmailTemplate: `
        <div style="font-family: 'Poppins', 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #080c14 0%, #0f172a 100%); color: #f1f5f9; border-radius: 20px; padding: 40px; border: 1px solid #38bdf8; text-align: center;">
          <h1 style="color: #fbbf24; font-size: 28px; font-weight: 700; margin-bottom: 8px;">Happy Birthday, {nickname}!</h1>
          <p style="color: #38bdf8; font-size: 16px; margin-top: 0;">IT Department 25/26 Set Celebrates You</p>
          
          <div style="background: rgba(255, 255, 255, 0.04); padding: 24px; border-radius: 16px; margin: 24px 0;">
            <p style="font-size: 15px; line-height: 1.6; color: #e2e8f0;">
              Dear <strong>{fullName}</strong>,<br/><br/>
              On this special day of yours, the entire Information Technology Department 25/26 set wishes you a magnificent birthday filled with joy, wisdom, sound health, and outstanding achievements.
            </p>
          </div>
          
          <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #1e293b; color: #94a3b8; font-size: 13px;">
            <p>With best wishes,<br/><strong>IT Department 25/26 Executive & Class Committee</strong></p>
          </div>
        </div>
      `
    };

    const insertPromises = Object.entries(defaults).map(async ([key, value]) => {
      try {
        if (usePostgres) {
          await db.asyncRun('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
        } else if (sqliteDb) {
          await db.asyncRun('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
        }
      } catch (e) {
        // Ignore single key collision
      }
    });
    await Promise.all(insertPromises);

    console.log(`✅ ${usePostgres ? 'PostgreSQL' : 'SQLite'} Database initialized successfully.`);
  } catch (err) {
    console.error('Database Table Init Error:', err.message);
  }
}

async function getSetting(key) {
  const row = await db.asyncGet('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  if (usePostgres && pgPool) {
    await db.asyncRun('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
  } else if (sqliteDb) {
    await db.asyncRun('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
}

async function getAllSettings() {
  const rows = await db.asyncAll('SELECT key, value FROM settings');
  const settingsObj = {};
  rows.forEach(r => settingsObj[r.key] = r.value);
  return settingsObj;
}

module.exports = {
  db,
  initDatabase,
  getSetting,
  setSetting,
  getAllSettings
};

