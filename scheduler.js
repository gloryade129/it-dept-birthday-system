const cron = require('node-cron');
const { db, getSetting, getAllSettings } = require('./database');
const { sendDirectMessage, sendGroupMessage } = require('./whatsapp');
const { sendEmail, renderTemplate } = require('./mailer');
const { generateBirthdayFlyer } = require('./flyerGenerator');
const path = require('path');
const fs = require('fs');

/**
 * Format birthDate string (e.g. "June 15")
 */
function formatBirthDate(month, day) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${monthNames[month - 1]} ${day}`;
}

/**
 * Send Instant Welcome DM and Email upon form submission (100% Automated)
 */
async function sendInstantRegistrationConfirmations(studentId, studentData) {
  const student = studentData || studentId; // Support both (student) and (id, data) call styles
  const settings = await getAllSettings();
  const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);

  const id = typeof studentId === 'number' ? studentId : student.id;

  const templateData = {
    fullName: student.fullName || '',
    nickname: student.nickname || (student.fullName ? student.fullName.split(' ')[0] : 'Friend'),
    birthDate: birthDateStr,
    phone: student.phone || '',
    email: student.email || '',
    department: 'Information Technology 25/26'
  };

  // 1. Instant WhatsApp Welcome DM
  try {
    const welcomeText = renderTemplate(settings.welcomeDmTemplate, templateData);
    await sendDirectMessage(student.phone, welcomeText);
    await db.asyncRun(
      'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
      [id, new Date().getFullYear(), 'welcome_dm', 'success', null]
    );
    console.log(`✅ Automated Welcome DM sent to ${student.fullName}`);
  } catch (err) {
    console.error(`❌ Automated Welcome DM Failed for ${student.fullName}:`, err.message);
    await db.asyncRun(
      'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
      [id, new Date().getFullYear(), 'welcome_dm', 'failed', err.message]
    );
  }

  // 2. Instant Brevo Welcome Email
  try {
    const subject = renderTemplate(settings.welcomeEmailSubject, templateData);
    const html = renderTemplate(settings.welcomeEmailTemplate, templateData);
    await sendEmail({ to: student.email, subject, html });
    await db.asyncRun(
      'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
      [id, new Date().getFullYear(), 'welcome_email', 'success', null]
    );
    console.log(`✅ Automated Welcome Email sent to ${student.fullName}`);
  } catch (err) {
    console.error(`❌ Automated Welcome Email Failed for ${student.fullName}:`, err.message);
    await db.asyncRun(
      'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
      [id, new Date().getFullYear(), 'welcome_email', 'failed', err.message]
    );
  }
}

/**
 * 12:00 AM Midnight Automatic Birthday DM & Email Dispatches (100% Automated)
 */
async function runMidnightBirthdayDispatches() {
  console.log(`🌙 [${new Date().toLocaleString()}] Running 100% Automated Midnight Birthday Job...`);
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();

  const celebrants = await db.asyncAll(
    'SELECT * FROM students WHERE birthmonth = ? AND birthday = ?',
    [month, day]
  );

  if (celebrants.length === 0) {
    console.log(`ℹ️ [Midnight Job] No celebrants recorded for today (${month}/${day}).`);
    return;
  }

  console.log(`🎉 Found ${celebrants.length} celebrant(s) for today (${month}/${day})! Dispatching midnight wishes...`);
  const settings = await getAllSettings();

  for (const student of celebrants) {
    const templateData = {
      fullName: student.fullName,
      nickname: student.nickname || student.fullName.split(' ')[0],
      birthDate: formatBirthDate(student.birthMonth, student.birthDay),
      phone: student.phone,
      email: student.email,
      department: 'Information Technology 25/26'
    };

    // Check if DM sent already today
    const dmLog = await db.asyncGet(
      'SELECT id FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = "dm" AND status = "success"',
      [student.id, year]
    );

    if (!dmLog) {
      try {
        const text = renderTemplate(settings.birthdayDmTemplate, templateData);
        let photoPath = null;
        if (student.photoUrl) {
          photoPath = path.join(__dirname, 'public', student.photoUrl);
        }
        await sendDirectMessage(student.phone, text, photoPath);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
          [student.id, year, 'dm', 'success']
        );
        console.log(`✅ Midnight WhatsApp DM sent automatically to ${student.fullName} (${student.phone})`);
      } catch (err) {
        console.error(`❌ Midnight WhatsApp DM failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
          [student.id, year, 'dm', 'failed', err.message]
        );
      }
    } else {
      console.log(`ℹ️ WhatsApp DM already sent to ${student.fullName} for year ${year}`);
    }

    // Check if Email sent already today
    const emailLog = await db.asyncGet(
      'SELECT id FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = "email" AND status = "success"',
      [student.id, year]
    );

    if (!emailLog) {
      try {
        const subject = renderTemplate(settings.birthdayEmailSubject, templateData);
        const html = renderTemplate(settings.birthdayEmailTemplate, templateData);
        await sendEmail({ to: student.email, subject, html });
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
          [student.id, year, 'email', 'success']
        );
        console.log(`✅ Midnight Brevo Email sent automatically to ${student.fullName} (${student.email})`);
      } catch (err) {
        console.error(`❌ Midnight Brevo Email failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
          [student.id, year, 'email', 'failed', err.message]
        );
      }
    } else {
      console.log(`ℹ️ Brevo Email already sent to ${student.fullName} for year ${year}`);
    }
  }
}

/**
 * 9:00 AM Morning Automatic WhatsApp Group Announcement with Dynamic Flyer (100% Automated)
 */
async function runMorningGroupDispatches() {
  console.log(`☀️ [${new Date().toLocaleString()}] Running 100% Automated 9:00 AM Group Job...`);
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();

  const celebrants = await db.asyncAll(
    'SELECT * FROM students WHERE birthmonth = ? AND birthday = ?',
    [month, day]
  );

  if (celebrants.length === 0) {
    console.log(`ℹ️ [Morning Group Job] No group announcements needed for today (${month}/${day}).`);
    return;
  }

  const settings = await getAllSettings();
  const groupJid = settings.targetGroupJid;

  if (!groupJid) {
    console.warn('⚠️ Target WhatsApp Announcement Group JID is not set in settings. Skipping group announcement.');
    return;
  }

  for (const student of celebrants) {
    const groupLog = await db.asyncGet(
      'SELECT id FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = "group" AND status = "success"',
      [student.id, year]
    );

    if (!groupLog) {
      try {
        const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);
        const templateData = {
          fullName: student.fullName,
          nickname: student.nickname || student.fullName.split(' ')[0],
          birthDate: birthDateStr,
          phone: student.phone,
          email: student.email,
          department: 'Information Technology 25/26'
        };

        const text = renderTemplate(settings.birthdayGroupTemplate, templateData);
        let userPhotoPath = null;
        if (student.photoUrl) {
          userPhotoPath = path.join(__dirname, 'public', student.photoUrl);
        }

        // Generate dynamic branded birthday graphic flyer image
        const flyerPath = await generateBirthdayFlyer({
          fullName: student.fullName,
          nickname: student.nickname,
          birthDate: birthDateStr,
          photoPath: userPhotoPath
        });

        await sendGroupMessage(groupJid, text, flyerPath);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
          [student.id, year, 'group', 'success']
        );
        console.log(`✅ 9:00 AM Group Announcement & Dynamic Flyer posted automatically for ${student.fullName} to group ${groupJid}`);
      } catch (err) {
        console.error(`❌ Group Announcement failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
          [student.id, year, 'group', 'failed', err.message]
        );
      }
    } else {
      console.log(`ℹ️ 9:00 AM Group announcement already posted for ${student.fullName} for year ${year}`);
    }
  }
}

/**
 * Manual Admin Trigger/Override for testing or manual re-dispatch
 */
async function triggerManualDispatch(studentId, channels = ['dm', 'email', 'group']) {
  const student = await db.asyncGet('SELECT * FROM students WHERE id = ?', [studentId]);
  if (!student) throw new Error('Student not found.');

  const settings = await getAllSettings();
  const year = new Date().getFullYear();
  const results = {};

  const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);
  const templateData = {
    fullName: student.fullName,
    nickname: student.nickname || student.fullName.split(' ')[0],
    birthDate: birthDateStr,
    phone: student.phone,
    email: student.email,
    department: 'Information Technology 25/26'
  };

  let userPhotoPath = null;
  if (student.photoUrl) {
    userPhotoPath = path.join(__dirname, 'public', student.photoUrl);
  }

  if (channels.includes('dm')) {
    try {
      const text = renderTemplate(settings.birthdayDmTemplate, templateData);
      await sendDirectMessage(student.phone, text, userPhotoPath);
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
        [student.id, year, 'dm', 'success']
      );
      results.dm = { status: 'success' };
    } catch (err) {
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
        [student.id, year, 'dm', 'failed', err.message]
      );
      results.dm = { status: 'failed', error: err.message };
    }
  }

  if (channels.includes('email')) {
    try {
      const subject = renderTemplate(settings.birthdayEmailSubject, templateData);
      const html = renderTemplate(settings.birthdayEmailTemplate, templateData);
      await sendEmail({ to: student.email, subject, html });
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
        [student.id, year, 'email', 'success']
      );
      results.email = { status: 'success' };
    } catch (err) {
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
        [student.id, year, 'email', 'failed', err.message]
      );
      results.email = { status: 'failed', error: err.message };
    }
  }

  if (channels.includes('group')) {
    try {
      const text = renderTemplate(settings.birthdayGroupTemplate, templateData);
      const groupJid = settings.targetGroupJid;
      if (!groupJid) throw new Error('WhatsApp Announcement group not configured.');

      const flyerPath = await generateBirthdayFlyer({
        fullName: student.fullName,
        nickname: student.nickname,
        birthDate: birthDateStr,
        photoPath: userPhotoPath
      });

      await sendGroupMessage(groupJid, text, flyerPath);
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
        [student.id, year, 'group', 'success']
      );
      results.group = { status: 'success' };
    } catch (err) {
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errorMessage) VALUES (?, ?, ?, ?, ?)',
        [student.id, year, 'group', 'failed', err.message]
      );
      results.group = { status: 'failed', error: err.message };
    }
  }

  return results;
}

/**
 * Initialize 100% Automated Node Cron Schedulers
 */
function initSchedulers() {
  // Midnight 12:00 AM Primary Job (0 0 * * *)
  cron.schedule('0 0 * * *', () => {
    runMidnightBirthdayDispatches().catch(console.error);
  });

  // Midnight 00:15 AM Fail-safe Retry Job (15 0 * * *)
  cron.schedule('15 0 * * *', () => {
    console.log('🔄 Running 00:15 AM Fail-safe Retry Check for Midnight Dispatches...');
    runMidnightBirthdayDispatches().catch(console.error);
  });

  // Morning 9:00 AM Primary Group Job (0 9 * * *)
  cron.schedule('0 9 * * *', () => {
    runMorningGroupDispatches().catch(console.error);
  });

  // Morning 09:15 AM Fail-safe Retry Job (15 9 * * *)
  cron.schedule('15 9 * * *', () => {
    console.log('🔄 Running 09:15 AM Fail-safe Retry Check for Group Dispatches...');
    runMorningGroupDispatches().catch(console.error);
  });

  console.log('⏰ 100% Automated Birthday Schedulers Active:');
  console.log('   - 00:00 AM: Midnight Private WhatsApp DM & Brevo Email Dispatch');
  console.log('   - 00:15 AM: Fail-safe Automatic Retry for Midnight Dispatches');
  console.log('   - 09:00 AM: Morning Group Announcement with Dynamic Graphic Flyer');
  console.log('   - 09:15 AM: Fail-safe Automatic Retry for Group Dispatches');
}

module.exports = {
  initSchedulers,
  sendInstantRegistrationConfirmations,
  runMidnightBirthdayDispatches,
  runMorningGroupDispatches,
  triggerManualDispatch
};

