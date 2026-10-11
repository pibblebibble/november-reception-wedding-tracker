const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const sourcePath = path.join(root, '.private-data.local.json');
const encryptedPath = path.join(root, 'private-data.json');
const passphrase = process.env.PRIVATE_DATA_PASSPHRASE || '';
const command = process.argv[2] || 'encrypt';

if (!passphrase) {
  throw new Error('Set PRIVATE_DATA_PASSPHRASE before running this script.');
}

function readLiteral(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find ${label} in index.html.`);
  return vm.runInNewContext(`(${match[1]})`, Object.create(null));
}

function placeholder(id, title) {
  return `  <section class="view private-placeholder-view" id="${id}" data-private-view>\n    <div class="page-head"><button class="back" type="button" onclick="showView('home')">Overview</button><h2>${title}</h2><p>Private wedding data. Enter the private passphrase to continue.</p></div>\n  </section>\n\n`;
}

function extractPrivateData() {
  let html = fs.readFileSync(indexPath, 'utf8');
  const guestStart = html.indexOf('  <section class="view" id="guests">');
  const attendanceStart = html.indexOf('  <section class="view" id="attendance">');
  const seatingStart = html.indexOf('  <section class="view" id="seating">');
  const pendingStart = html.indexOf('  <section class="view" id="pending">');
  if ([guestStart, attendanceStart, seatingStart, pendingStart].some(index => index < 0)) {
    throw new Error('Private sections were not found or have already been extracted.');
  }

  const payload = {
    version: 1,
    sections: {
      guests: html.slice(guestStart, attendanceStart),
      attendance: html.slice(attendanceStart, seatingStart),
      seating: html.slice(seatingStart, pendingStart)
    },
    defaultSeating: readLiteral(html, /const DEFAULT_SEATING=(\[[\s\S]*?\]);\r?\nconst SEATING_GUEST_ROSTER/, 'DEFAULT_SEATING'),
    babyChairGuests: readLiteral(html, /const BABY_CHAIR_GUESTS=new Set\((\[[^\]]*\])\);/, 'BABY_CHAIR_GUESTS')
  };

  html = html.slice(0, guestStart)
    + placeholder('guests', 'Guest List')
    + placeholder('attendance', 'Attendance Sheets')
    + placeholder('seating', 'Seat Planner')
    + html.slice(pendingStart);
  html = html.replace(
    /const DEFAULT_SEATING=\[[\s\S]*?\];\r?\nconst SEATING_GUEST_ROSTER=Object\.freeze\(DEFAULT_SEATING\.flat\(\)\.filter\(Boolean\)\);\r?\nconst BABY_CHAIR_GUESTS=new Set\(\[[^\]]*\]\);/,
    'let DEFAULT_SEATING=[];\nlet SEATING_GUEST_ROSTER=Object.freeze([]);\nlet BABY_CHAIR_GUESTS=new Set();'
  );

  fs.writeFileSync(sourcePath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(indexPath, html);
  return payload;
}

function encryptPrivateData(payload) {
  const iterations = 600000;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const envelope = {
    version: 1,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
  fs.writeFileSync(encryptedPath, `${JSON.stringify(envelope, null, 2)}\n`);
}

const payload = command === 'extract'
  ? extractPrivateData()
  : JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
encryptPrivateData(payload);
console.log(`Encrypted private data written to ${path.relative(root, encryptedPath)}.`);
