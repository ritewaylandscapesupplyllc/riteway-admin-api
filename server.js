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

// Safety check
if (!FB_PROJECT_ID || !FB_CLIENT_EMAIL || !FB_PRIVATE_KEY || !FB_DATABASE_URL || !ADMIN_API_KEY) {
  console.error('Missing one or more required environment variables.');
  console.error('Required: FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY, FB_DATABASE_URL, ADMIN_API_KEY');
  process.exit(1);
}

// Some hosts store \n in env vars as literal "\\n"
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

const app = express();
app.use(cors());
app.use(express.json());

// --- Simple API key protection ---
function requireApiKey(req, res, next) {
  const key = req.headers['x-admin-api-key'];
  if (!key || key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Health check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'riteway-admin-api' });
});

// --- List drivers (Firebase Auth users) ---
app.get('/drivers', requireApiKey, async (req, res) => {
  try {
    const users = [];
    let nextPageToken;

    do {
      const result = await admin.auth().listUsers(1000, nextPageToken);
      result.users.forEach(userRecord => {
        users.push({
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName || null,
          disabled: userRecord.disabled,
          metadata: {
            creationTime: userRecord.metadata.creationTime,
            lastSignInTime: userRecord.metadata.lastSignInTime
          }
        });
      });
      nextPageToken = result.pageToken;
    } while (nextPageToken);

    res.json({ count: users.length, users });
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// --- Get a single driver details (Auth + optional profile in DB) ---
app.get('/drivers/:uid', requireApiKey, async (req, res) => {
  const { uid } = req.params;
  try {
    const userRecord = await admin.auth().getUser(uid);
    const authData = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName || null,
      disabled: userRecord.disabled,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime
      }
    };

    // Optional: pull profile/ uploads later
    // For now, just try to read a profile node
    const profileSnap = await admin.database().ref('driverProfiles/' + uid).once('value');
    const profile = profileSnap.val() || null;

    res.json({ auth: authData, profile });
  } catch (err) {
    console.error('Error getting user:', err);
    if (err.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Failed to fetch driver' });
  }
});

// --- Delete driver (Auth + optional DB) ---
app.delete('/drivers/:uid', requireApiKey, async (req, res) => {
  const { uid } = req.params;
  try {
    // Delete from Firebase Authentication
    await admin.auth().deleteUser(uid);

    // Optionally delete related DB nodes
    const updates = {};
    updates['/driverProfiles/' + uid] = null;
    updates['/driverUploads/' + uid] = null;
    // Add more paths later if needed

    await admin.database().ref().update(updates);

    res.json({ success: true, uid });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete driver' });
  }
});

// --- Port ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Riteway Admin API listening on port ${PORT}`);
});