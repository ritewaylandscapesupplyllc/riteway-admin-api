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

const db = admin.database();

// --- Express app ---
const app = express();
app.use(cors());          // allow calls from your dashboard pages
app.use(express.json());

// Simple health check
app.get('/', (req, res) => {
  res.send('OK');
});

// Middleware: require admin API key
function requireAdminKey(req, res, next) {
  // Accept either header name so both pages work
  const key =
    req.headers['x-admin-api-key'] ||
    req.headers['x-admin-key'] ||
    req.query.key;

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

// GET /driver-details?uid=... -> driver profile + loads + tickets + ratings
app.get('/driver-details', requireAdminKey, async (req, res) => {
  const uid = req.query.uid;

  if (!uid) {
    return res.status(400).json({ error: 'Missing uid query parameter' });
  }

  try {
    // 1) Basic auth user info
    const userRecord = await admin.auth().getUser(uid);

    // 2) Pull all deliveries and filter by this driver
    const deliveriesSnap = await db.ref('deliveries').once('value');
    const deliveriesVal = deliveriesSnap.val() || {};

    const loads = [];
    Object.entries(deliveriesVal).forEach(([id, obj]) => {
      const details = obj.details || {};
      const status = obj.status || 'pending';

      // Current / future matching options
      const assignedEmail = (details.assignedDriverEmail || '').toLowerCase();
      const assignedUid = details.assignedDriverUid || null;

      if (
        (userRecord.email && assignedEmail === userRecord.email.toLowerCase()) ||
        assignedUid === uid
      ) {
        loads.push({
          id,
          status,
          customerName: details.customerName || '',
          address: details.address || '',
          items: details.items || '',
          yards: details.yards || 0,
          revenue: details.revenue || 0,
          profit: details.profit || 0,
          createdAt: obj.createdAt || null
        });
      }
    });

    // 3) Future: scale ticket uploads (driver app will write here later)
    const ticketsSnap = await db.ref('scaleTickets').child(uid).once('value');
    const ticketsVal = ticketsSnap.val() || {};
    const tickets = Object.entries(ticketsVal).map(([id, t]) => ({
      id,
      url: t.url || '',
      fileName: t.fileName || '',
      uploadedAt: t.uploadedAt || null,
      loadId: t.loadId || null,
    }));

    // 4) Future: ratings / comments from customer tracker
    const ratingsSnap = await db.ref('driverRatings').child(uid).once('value');
    const ratingsVal = ratingsSnap.val() || {};
    const ratings = Object.entries(ratingsVal).map(([id, r]) => ({
      id,
      rating: r.rating || null,            // 1–5 stars
      comment: r.comment || '',
      customerName: r.customerName || '',
      loadId: r.loadId || null,
      createdAt: r.createdAt || null,
    }));

    // Calculate simple stats
    let avgRating = null;
    if (ratings.length) {
      const sum = ratings.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
      avgRating = sum / ratings.length;
    }

    res.json({
      user: {
        uid: userRecord.uid,
        email: userRecord.email || null,
        displayName: userRecord.displayName || null,
        phoneNumber: userRecord.phoneNumber || null,
        disabled: userRecord.disabled || false,
        creationTime: userRecord.metadata?.creationTime || null,
        lastSignInTime: userRecord.metadata?.lastSignInTime || null,
      },
      loads,
      tickets,
      ratings,
      stats: {
        totalLoads: loads.length,
        totalTickets: tickets.length,
        totalRatings: ratings.length,
        avgRating,
      }
    });
  } catch (err) {
    console.error('Error in /driver-details:', err);
    res.status(500).json({ error: 'Failed to load driver details', details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Riteway Admin API listening on port ${PORT}`);
});