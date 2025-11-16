// server.js
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// --- Load config from environment variables ---
const {
  FB_PROJECT_ID,
  FB_CLIENT_EMAIL,
  FB_PRIVATE_KEY,
  FB_DATABASE_URL,
  ADMIN_API_KEY
} = process.env;

if (!FB_PROJECT_ID || !FB_CLIENT_EMAIL || !FB_PRIVATE_KEY || !FB_DATABASE_URL || !ADMIN_API_KEY) {
  console.error('Missing one or more required environment variables.');
  console.error('Required: FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY, FB_DATABASE_URL, ADMIN_API_KEY');
  process.exit(1);
}

// Some hosts store \n in env vars; fix that
const privateKey = FB_PRIVATE_KEY.replace(/\\n/g, '\n');

// --- Firebase Admin init ---
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FB_PROJECT_ID,
    clientEmail: FB_CLIENT_EMAIL,
    privateKey
  }),
  databaseURL: FB_DATABASE_URL
});

// --- Express app ---
const app = express();
app.use(cors());          // allow calls from your dashboard page
app.use(express.json());

// Simple health check
app.get('/', (req, res) => {
  res.send('OK');
});

// Middleware: require admin API key
function requireAdminKey(req, res, next) {
  const key = req.headers['x-admin-api-key'] || req.query.key;
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /drivers  -> list all Firebase Auth users
app.get('/drivers', requireAdminKey, async (req, res) => {
  try {
    const users = [];
    let nextPageToken;

    do {
      const result = await admin.auth().listUsers(1000, nextPageToken);
      result.users.forEach(u => {
        users.push({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          phoneNumber: u.phoneNumber,
          disabled: u.disabled,
          creationTime: u.metadata.creationTime,
          lastSignInTime: u.metadata.lastSignInTime
        });
      });
      nextPageToken = result.pageToken;
    } while (nextPageToken);

    res.json({ users });
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// DELETE /drivers/:uid  -> delete a driver
app.delete('/drivers/:uid', requireAdminKey, async (req, res) => {
  try {
    await admin.auth().deleteUser(req.params.uid);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Riteway Admin API listening on port ${PORT}`);
});
