const cron = require('node-cron');
const { db, getSetting, getAllSettings } = require('./database');
const { sendDirectMessage, sendGroupMessage } = require('./whatsapp');
const { sendEmail, renderTemplate } = require('./mailer');
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
 * Build rich template parameters object containing photoHtml, fullPhotoUrl, and student fields
 */
function buildTemplateData(student) {
  const birthDateStr = formatBirthDate(student.birthMonth, student.birthDay);
  const fullName = student.fullName || '';
  const nickname = student.nickname || (fullName ? fullName.split(' ')[0] : 'Friend');
  const photoUrl = student.photoUrl || '';

  const baseUrl = process.env.APP_URL || 'https://it-dept-birthday-system.pxxl.run';
  let fullPhotoUrl = '';
  let photoHtml = '';

  if (photoUrl) {
    fullPhotoUrl = photoUrl.startsWith('http') ? photoUrl : `${baseUrl}${photoUrl.startsWith('/') ? '' : '/'}${photoUrl}`;
    photoHtml = `<div style="text-align: center; margin: 20px 0;"><img src="${fullPhotoUrl}" alt="${fullName}" style="width: 140px; height: 140px; border-radius: 50%; object-fit: cover; border: 4px solid #38bdf8; box-shadow: 0 10px 25px rgba(56, 189, 248, 0.35); display: inline-block;" /></div>`;
  } else {
    const parts = fullName.split(' ').filter(Boolean);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts.length === 1 ? parts[0].substring(0, 2).toUpperCase() : 'IT';
    photoHtml = `<div style="text-align: center; margin: 20px 0;"><div style="width: 110px; height: 110px; border-radius: 50%; background: linear-gradient(135deg, #38bdf8, #6366f1); display: inline-flex; align-items: center; justify-content: center; font-size: 38px; font-weight: 700; color: #ffffff; margin: 0 auto; box-shadow: 0 10px 25px rgba(99, 102, 241, 0.3);">${initials}</div></div>`;
  }

  return {
    fullName,
    nickname,
    birthDate: birthDateStr,
    phone: student.phone || '',
    email: student.email || '',
    photoUrl: fullPhotoUrl || photoUrl,
    photoHtml,
    department: 'Information Technology 25/26'
  };
}

/**
 * Send Instant Welcome DM and Email upon form submission (100% Automated)
 */
async function sendInstantRegistrationConfirmations(studentId, studentData) {
  const rawStudent = studentData || studentId;
  const student = normalizeStudent(typeof rawStudent === 'object' ? rawStudent : { id: studentId });
  const settings = await getAllSettings();

  const id = student.id || studentId;
  const templateData = buildTemplateData(student);

  // 1. Instant WhatsApp Welcome DM (Registration Copy)
  try {
    const defaultWelcomeDm = 'Hi {nickname}, welcome to the IT Dept 25/26 Birthday Network! 👋\n\nHere is a copy of your registered details:\n👤 Name: {fullName} ({nickname})\n🎂 Date of Birth: {birthDate}\n📱 WhatsApp: {phone}\n✉️ Email: {email}\n\nOn your special day, expect automated birthday wishes, an official group announcement with your photo, and a celebration email card! 🎁✨';
    const rawTemplate = settings.welcomeDmTemplate || defaultWelcomeDm;
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

  // 2. Instant Email Welcome Confirmation (Registration Copy)
  try {
    if (student.email) {
      const defaultWelcomeEmail = `<div style="font-family: 'Poppins', 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #080c14; color: #f1f5f9; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
  <h2 style="color: #38bdf8; text-align: center; font-size: 22px; font-weight: 700; margin-bottom: 4px;">Registration Confirmation Copy 📋</h2>
  <p style="text-align: center; color: #94a3b8; font-size: 14px; margin-top: 0;">Information Technology Department 25/26 Birthday Network</p>
  
  {photoHtml}

  <p>Dear <strong>{fullName}</strong>,</p>
  <p>Your birthday details have been successfully registered in the <strong>IT Department 25/26 Set Registry</strong>. Here is a copy of your submitted details for your records:</p>
  
  <div style="background: #0f172a; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #38bdf8;">
    <p style="margin: 6px 0;"><strong>Full Name:</strong> {fullName}</p>
    <p style="margin: 6px 0;"><strong>Preferred Nickname:</strong> {nickname}</p>
    <p style="margin: 6px 0;"><strong>Date of Birth:</strong> {birthDate}</p>
    <p style="margin: 6px 0;"><strong>WhatsApp Phone:</strong> {phone}</p>
    <p style="margin: 6px 0;"><strong>Email Address:</strong> {email}</p>
  </div>
  
  <p style="font-size: 14px; color: #cbd5e1;">When your special day comes, expect warm birthday wishes in your WhatsApp DM, an official announcement with your photo in our class group, and a birthday card in your inbox!</p>
  
  <p style="color: #94a3b8; font-size: 13px; text-align: center; margin-top: 30px; border-top: 1px solid #1e293b; padding-top: 16px;">
    Information Technology Department 25/26 Set
  </p>
</div>`;

      const rawSubject = settings.welcomeEmailSubject || 'Registration Confirmation Copy — IT Dept 25/26';
      const rawTemplate = settings.welcomeEmailTemplate || defaultWelcomeEmail;
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
    const templateData = buildTemplateData(student);

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
        const templateData = buildTemplateData(student);

        const rawGroupTpl = settings.birthdayGroupTemplate || '🎂 IT DEPT 25/26 BIRTHDAY ANNOUNCEMENT 🎂\n\nToday we celebrate *{fullName}* ({nickname})! 🎉🎈';
        const text = renderTemplate(rawGroupTpl, templateData);
        
        const photoUrl = student.photoUrl || student.photourl;
        let celebrantPhotoPath = null;
        if (photoUrl) {
          const cleanPath = photoUrl.replace(/^[/\\]+/, '');
          const fullPath = path.join(__dirname, 'public', cleanPath);
          if (fs.existsSync(fullPath)) {
            celebrantPhotoPath = fullPath;
          }
        }

        // Deliver Group Announcement & Celebrant Uploaded Photo directly to Class Rep WhatsApp DM (09168047236) for 1-tap forwarding
        await sendDirectMessage(adminPhone, text, celebrantPhotoPath);
        console.log(`✅ Morning Group Announcement + Celebrant Photo delivered to Class Rep WhatsApp DM (${adminPhone})!`);

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
  const templateData = buildTemplateData(student);

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

      const photoUrl = student.photoUrl || student.photourl;
      let celebrantPhotoPath = null;
      if (photoUrl) {
        const cleanPath = photoUrl.replace(/^[/\\]+/, '');
        const fullPath = path.join(__dirname, 'public', cleanPath);
        if (fs.existsSync(fullPath)) {
          celebrantPhotoPath = fullPath;
        }
      }

      // Deliver Group Announcement & Celebrant Uploaded Photo directly to Class Rep WhatsApp DM (09168047236) for 1-tap forwarding
      await sendDirectMessage(adminPhone, text, celebrantPhotoPath);
      console.log(`✅ Group Announcement + Celebrant Photo delivered to Class Rep WhatsApp DM (${adminPhone})!`);

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

/**
 * Re-send Missed WhatsApp Welcome DMs to registered students
 */
async function resendMissedWelcomeDms() {
  console.log('🔄 Checking database for students missing WhatsApp Welcome DMs...');
  const students = await db.asyncAll('SELECT * FROM students ORDER BY id ASC');
  const settings = await getAllSettings();
  
  let sentCount = 0;
  let failCount = 0;
  const currentYear = new Date().getFullYear();

  for (const rawStudent of students) {
    const student = normalizeStudent(rawStudent);
    const id = student.id;

    // Check if welcome_dm was already successfully sent
    const successfulDmLog = await db.asyncGet(
      'SELECT * FROM dispatch_logs WHERE studentid = ? AND year = ? AND channel = ? AND status = ?',
      [id, currentYear, 'welcome_dm', 'success']
    );

    if (!successfulDmLog && student.phone) {
      console.log(`📤 Re-sending WhatsApp Welcome DM to ${student.fullName} (${student.phone})...`);
      const templateData = buildTemplateData(student);
      const defaultWelcomeDm = 'Hi {nickname}, welcome to the IT Dept 25/26 Birthday Network! 👋\n\nHere is a copy of your registered details:\n👤 Name: {fullName} ({nickname})\n🎂 Date of Birth: {birthDate}\n📱 WhatsApp: {phone}\n✉️ Email: {email}\n\nOn your special day, expect automated birthday wishes, an official group announcement with your photo, and a celebration email card! 🎁✨';
      const rawTemplate = settings.welcomeDmTemplate || defaultWelcomeDm;
      const welcomeText = renderTemplate(rawTemplate, templateData);

      try {
        await sendDirectMessage(student.phone, welcomeText);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
          [id, currentYear, 'welcome_dm', 'success', null]
        );
        console.log(`✅ Welcome DM successfully re-sent to ${student.fullName}`);
        sentCount++;
      } catch (err) {
        console.error(`❌ Re-send Welcome DM failed for ${student.fullName}:`, err.message);
        await db.asyncRun(
          'INSERT INTO dispatch_logs (studentid, year, channel, status, errormessage) VALUES (?, ?, ?, ?, ?)',
          [id, currentYear, 'welcome_dm', 'failed', err.message]
        );
        failCount++;
      }
    }
  }

  return { totalStudents: students.length, sentCount, failCount };
}

module.exports = {
  initSchedulers,
  sendInstantRegistrationConfirmations,
  runMidnightBirthdayDispatches,
  runMorningGroupDispatches,
  resendMissedWelcomeDms,
  triggerManualDispatch
};
