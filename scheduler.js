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
  const mIndex = parseInt(month, 10) - 1;
  const mName = monthNames[mIndex] || 'Special Month';
  return `${mName} ${day}`;
}

/**
 * Extract normalized student fields handling both PostgreSQL (lowercase) and SQLite (camelCase)
 */
function normalizeStudent(s) {
  if (!s) return null;
  const fullName = s.fullName || s.fullname || '';
  const nickname = s.nickname || (fullName ? fullName.split(' ')[0] : 'Friend');
  const birthMonth = s.birthMonth || s.birthmonth;
  const birthDay = s.birthDay || s.birthday;
  const phone = s.phone || '';
  const email = s.email || '';
  const photoUrl = s.photoUrl || s.photourl || null;
  const id = s.id;

  return {
    id,
    fullName,
    nickname,
    birthMonth,
    birthDay,
    phone,
    email,
    photoUrl
  };
}

/**
 * Send Instant Welcome DM and Email upon form submission (100% Automated)
 */
async function sendInstantRegistrationConfirmations(studentId, studentData) {
  const rawStudent = studentData || studentId;
  const student = normalizeStudent(typeof rawStudent === 'object' ? rawStudent : { id: studentId });
  const settings = await getAllSettings();

  const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);
  const id = student.id || studentId;

  const templateData = {
    fullName: student.fullName,
    nickname: student.nickname,
    birthDate: birthDateStr,
    phone: student.phone,
    email: student.email,
    department: 'Information Technology 25/26'
  };

  // 1. Instant WhatsApp Welcome DM
  try {
    const rawTemplate = settings.welcomeDmTemplate || 'Hi {nickname}, welcome to the IT Dept 25/26 Birthday Network! 👋\n\nYour birthday details ({birthDate}) have been recorded successfully. Expect automated birthday wishes, a custom graphic flyer, and group celebration on your special day! 🎁✨';
    const welcomeText = renderTemplate(rawTemplate, templateData);
    
    if (student.phone) {
      await sendDirectMessage(student.phone, welcomeText);
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
        [id, new Date().getFullYear(), 'welcome_dm', 'success', null]
      );
      console.log(`✅ Automated Welcome DM sent to ${student.fullName}`);
    }
  } catch (err) {
    console.error(`❌ Automated Welcome DM Failed for ${student.fullName}:`, err.message);
    await db.asyncRun(
      'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
      [id, new Date().getFullYear(), 'welcome_dm', 'failed', err.message]
    );
  }

  // 2. Instant Brevo Welcome Email
  try {
    if (student.email) {
      const rawSubject = settings.welcomeEmailSubject || 'Welcome to IT Dept 25/26 Birthday Registry';
      const rawTemplate = settings.welcomeEmailTemplate || '<p>Dear {fullName}, welcome to IT Dept 25/26 Birthday Network!</p>';
      const subject = renderTemplate(rawSubject, templateData);
      const html = renderTemplate(rawTemplate, templateData);
      await sendEmail({ to: student.email, subject, html });
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
        [id, new Date().getFullYear(), 'welcome_email', 'success', null]
      );
      console.log(`✅ Automated Welcome Email sent to ${student.fullName}`);
    }
  } catch (err) {
    console.error(`❌ Automated Welcome Email Failed for ${student.fullName}:`, err.message);
    await db.asyncRun(
      'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
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

  const rawCelebrants = await db.asyncAll(
    'SELECT * FROM students WHERE birthmonth = ? AND birthday = ?',
    [month, day]
  );

  if (rawCelebrants.length === 0) {
    console.log(`ℹ️ [Midnight Job] No celebrants recorded for today (${month}/${day}).`);
    return;
  }

  console.log(`🎉 Found ${rawCelebrants.length} celebrant(s) for today (${month}/${day})! Dispatching midnight wishes...`);
  const settings = await getAllSettings();

  for (const rawS of rawCelebrants) {
    const student = normalizeStudent(rawS);
    const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);

    const templateData = {
      fullName: student.fullName,
      nickname: student.nickname,
      birthDate: birthDateStr,
      phone: student.phone,
      email: student.email,
      department: 'Information Technology 25/26'
    };

    // Check if DM sent already today
    const dmLog = await db.asyncGet(
      'SELECT id FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = \'dm\' AND status = \'success\'',
      [student.id, year]
    );

    if (!dmLog) {
      try {
        const rawDmTpl = settings.birthdayDmTemplate || 'Happy Birthday, {nickname}! 🎉🎂\n\nOn behalf of the IT Dept 25/26 Set, we celebrate you today! 🎈';
        const text = renderTemplate(rawDmTpl, templateData);
        await sendDirectMessage(student.phone, text);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
          [student.id, year, 'dm', 'success']
        );
        console.log(`✅ Midnight WhatsApp DM sent automatically to ${student.fullName} (${student.phone})`);
      } catch (err) {
        console.error(`❌ Midnight WhatsApp DM failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
          [student.id, year, 'dm', 'failed', err.message]
        );
      }
    } else {
      console.log(`ℹ️ WhatsApp DM already sent to ${student.fullName} for year ${year}`);
    }

    // Check if Email sent already today
    const emailLog = await db.asyncGet(
      'SELECT id FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = \'email\' AND status = \'success\'',
      [student.id, year]
    );

    if (!emailLog) {
      try {
        const rawSub = settings.birthdayEmailSubject || 'Happy Birthday from IT Dept 25/26!';
        const rawTpl = settings.birthdayEmailTemplate || '<p>Happy Birthday, {fullName}!</p>';
        const subject = renderTemplate(rawSub, templateData);
        const html = renderTemplate(rawTpl, templateData);
        await sendEmail({ to: student.email, subject, html });
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
          [student.id, year, 'email', 'success']
        );
        console.log(`✅ Midnight Brevo Email sent automatically to ${student.fullName} (${student.email})`);
      } catch (err) {
        console.error(`❌ Midnight Brevo Email failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
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

  const rawCelebrants = await db.asyncAll(
    'SELECT * FROM students WHERE birthmonth = ? AND birthday = ?',
    [month, day]
  );

  if (rawCelebrants.length === 0) {
    console.log(`ℹ️ [Morning Group Job] No group announcements needed for today (${month}/${day}).`);
    return;
  }

  const settings = await getAllSettings();
  const adminPhone = settings.adminPhone || '09168047236';

  for (const rawS of rawCelebrants) {
    const student = normalizeStudent(rawS);

    const groupLog = await db.asyncGet(
      'SELECT id FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = \'group\' AND status = \'success\'',
      [student.id, year]
    );

    if (!groupLog) {
      try {
        const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);
        const templateData = {
          fullName: student.fullName,
          nickname: student.nickname,
          birthDate: birthDateStr,
          phone: student.phone,
          email: student.email,
          department: 'Information Technology 25/26'
        };

        const rawGroupTpl = settings.birthdayGroupTemplate || '🎂 IT DEPT 25/26 BIRTHDAY ANNOUNCEMENT 🎂\n\nToday we celebrate *{fullName}* ({nickname})! 🎉🎈';
        const text = renderTemplate(rawGroupTpl, templateData);
        
        let userPhotoPath = null;
        if (student.photoUrl) {
          userPhotoPath = path.join(__dirname, 'public', student.photoUrl);
        }

        // Generate dynamic branded birthday graphic flyer PNG image
        const flyerPath = await generateBirthdayFlyer({
          fullName: student.fullName,
          nickname: student.nickname,
          birthDate: birthDateStr,
          photoPath: userPhotoPath
        });

        // 1. Deliver Group Announcement & Graphic Flyer directly to Class Rep WhatsApp DM (09168047236) for 1-tap forwarding
        await sendDirectMessage(adminPhone, text, flyerPath);
        console.log(`✅ Morning Graphic Flyer & Group Announcement delivered to Class Rep WhatsApp DM (${adminPhone}) ready to forward!`);

        // 2. Also attempt direct group dispatch if group JID configured
        const groupJid = settings.targetGroupJid;
        if (groupJid) {
          try {
            await sendGroupMessage(groupJid, text, flyerPath);
          } catch (gErr) {
            console.warn(`⚠️ Group direct dispatch notice (${gErr.message}). Announcement delivered to Class Rep DM!`);
          }
        }

        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
          [student.id, year, 'group', 'success']
        );
      } catch (err) {
        console.error(`❌ Group Announcement failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
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
  const rawStudent = await db.asyncGet('SELECT * FROM students WHERE id = ?', [studentId]);
  if (!rawStudent) throw new Error('Student not found.');

  const student = normalizeStudent(rawStudent);
  const settings = await getAllSettings();
  const year = new Date().getFullYear();
  const results = {};

  const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);
  const templateData = {
    fullName: student.fullName,
    nickname: student.nickname,
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
      const rawDmTpl = settings.birthdayDmTemplate || 'Happy Birthday, {nickname}! 🎉🎂\n\nOn behalf of the IT Dept 25/26 Set, we celebrate you today! 🎈';
      const text = renderTemplate(rawDmTpl, templateData);
      await sendDirectMessage(student.phone, text);
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
        [student.id, year, 'dm', 'success']
      );
      results.dm = { status: 'success' };
    } catch (err) {
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
        [student.id, year, 'dm', 'failed', err.message]
      );
      results.dm = { status: 'failed', error: err.message };
    }
  }

  if (channels.includes('email')) {
    try {
      const rawSub = settings.birthdayEmailSubject || 'Happy Birthday from IT Dept 25/26!';
      const rawTpl = settings.birthdayEmailTemplate || '<p>Happy Birthday, {fullName}!</p>';
      const subject = renderTemplate(rawSub, templateData);
      const html = renderTemplate(rawTpl, templateData);
      await sendEmail({ to: student.email, subject, html });
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
        [student.id, year, 'email', 'success']
      );
      results.email = { status: 'success' };
    } catch (err) {
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
        [student.id, year, 'email', 'failed', err.message]
      );
      results.email = { status: 'failed', error: err.message };
    }
  }

  if (channels.includes('group')) {
    try {
      const rawGroupTpl = settings.birthdayGroupTemplate || '🎂 IT DEPT 25/26 BIRTHDAY ANNOUNCEMENT 🎂\n\nToday we celebrate *{fullName}* ({nickname})! 🎉🎈';
      const text = renderTemplate(rawGroupTpl, templateData);
      const adminPhone = settings.adminPhone || '09168047236';

      const flyerPath = await generateBirthdayFlyer({
        fullName: student.fullName,
        nickname: student.nickname,
        birthDate: birthDateStr,
        photoPath: userPhotoPath
      });

      // 1. Deliver Group Announcement & Graphic Flyer directly to Class Rep WhatsApp DM (09168047236) for 1-tap forwarding
      await sendDirectMessage(adminPhone, text, flyerPath);
      console.log(`✅ Graphic Flyer & Group Announcement delivered to Class Rep WhatsApp DM (${adminPhone}) ready to forward!`);

      // 2. Also attempt direct group dispatch if group JID configured
      const groupJid = settings.targetGroupJid;
      if (groupJid) {
        try {
          await sendGroupMessage(groupJid, text, flyerPath);
        } catch (gErr) {
          console.warn(`⚠️ Group direct dispatch notice (${gErr.message}). Announcement delivered to Class Rep DM!`);
        }
      }

      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status) VALUES (?, ?, ?, ?)',
        [student.id, year, 'group', 'success']
      );
      results.group = { status: 'success' };
    } catch (err) {
      await db.asyncRun(
        'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
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
