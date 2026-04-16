const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
 
const app = express();
 
app.use(cors({ origin: '*' }));
app.use(express.json());
 
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = 'clarasta';
let cachedClient = null;
 
async function connectDB() {
  if (cachedClient) return cachedClient.db(DB_NAME);
  const client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
  });
  await client.connect();
  cachedClient = client;
  return client.db(DB_NAME);
}
 
app.get('/', (req, res) => res.json({ message: 'Clarasta API running!' }));
 
app.get('/api/health', async (req, res) => {
  try {
    const db = await connectDB();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (e) {
    res.json({ status: 'ok', db: 'disconnected', error: e.message, timestamp: new Date().toISOString() });
  }
});
 
// ── PARENT SIGNUP ──
app.post('/api/parent/signup', async (req, res) => {
  try {
    const { name, whatsapp, society, childClass, subject } = req.body;
    if (!name || !whatsapp || !society || !childClass || !subject)
      return res.status(400).json({ success: false, message: 'Sab fields bharo!' });
    const db = await connectDB();
    const result = await db.collection('parents').insertOne({
      name, whatsapp, society, childClass, subject,
      status: 'pending', createdAt: new Date()
    });
    res.json({ success: true, message: 'Request aa gaya!', id: result.insertedId });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
 
// ── PARENT LOGIN ──
app.post('/api/parent/login', async (req, res) => {
  try {
    const { whatsapp } = req.body;
    if (!whatsapp) return res.status(400).json({ success: false, message: 'WhatsApp number required!' });
    const db = await connectDB();
    const parent = await db.collection('parents').findOne({ whatsapp });
    if (!parent) return res.status(404).json({ success: false, message: 'No account found with this number. Please register first.' });
    res.json({ success: true, message: 'Login successful!', user: { id: parent._id, name: parent.name, whatsapp: parent.whatsapp, society: parent.society, childClass: parent.childClass, subject: parent.subject, status: parent.status, assignedTutorName: parent.assignedTutorName || null, assignedTutorWhatsapp: parent.assignedTutorWhatsapp || null, role: 'parent' } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── TUTOR LOGIN ──
app.post('/api/tutor/login', async (req, res) => {
  try {
    const { whatsapp } = req.body;
    if (!whatsapp) return res.status(400).json({ success: false, message: 'WhatsApp number required!' });
    const db = await connectDB();
    const tutor = await db.collection('tutors').findOne({ whatsapp });
    if (!tutor) return res.status(404).json({ success: false, message: 'No tutor account found with this number. Please register first.' });
    res.json({ success: true, message: 'Login successful!', user: { id: tutor._id, name: tutor.name, whatsapp: tutor.whatsapp, college: tutor.college, branch: tutor.branch, subjects: tutor.subjects, society: tutor.society, verified: tutor.verified, rating: tutor.rating, totalSessions: tutor.totalSessions, role: 'tutor' } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── TUTOR SIGNUP ──
app.post('/api/tutor/signup', async (req, res) => {
  try {
    const { name, whatsapp, college, branch, subjects, society } = req.body;
    if (!name || !whatsapp || !college || !branch || !subjects || !society)
      return res.status(400).json({ success: false, message: 'Sab fields bharo!' });
    const db = await connectDB();
    const existing = await db.collection('tutors').findOne({ whatsapp });
    if (existing) return res.status(409).json({ success: false, message: 'Already registered!' });
    const result = await db.collection('tutors').insertOne({
      name, whatsapp, college, branch,
      subjects: typeof subjects === 'string' ? subjects.split(',').map(s => s.trim()) : subjects,
      society, verified: false, rating: null, totalSessions: 0, createdAt: new Date()
    });
    res.json({ success: true, message: 'Profile submit ho gaya!', id: result.insertedId });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
 
// ── PUBLIC TUTOR LIST ──
app.get('/api/tutors', async (req, res) => {
  try {
    const { society, subject } = req.query;
    const db = await connectDB();
    const query = { verified: true };
    if (society && society !== 'All Societies') query.society = { $regex: society, $options: 'i' };
    if (subject && subject !== 'All Subjects') query.subjects = { $regex: subject, $options: 'i' };
    const tutors = await db.collection('tutors').find(query, { projection: { whatsapp: 0 } }).toArray();
    res.json({ success: true, count: tutors.length, data: tutors });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
 
// ─────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_SECRET || 'clarasta2025admin';
function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY)
    return res.status(401).json({ message: 'Unauthorized!' });
  next();
}
 
// ── ENHANCED DASHBOARD ──
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    const [
      totalParents, pendingParents, matchedParents, activeSessions,
      totalTutors, verifiedTutors,
      recentParents, recentTutors
    ] = await Promise.all([
      db.collection('parents').countDocuments(),
      db.collection('parents').countDocuments({ status: 'pending' }),
      db.collection('parents').countDocuments({ status: 'matched' }),
      db.collection('parents').countDocuments({ status: 'active' }),
      db.collection('tutors').countDocuments(),
      db.collection('tutors').countDocuments({ verified: true }),
      db.collection('parents').find().sort({ createdAt: -1 }).limit(100).toArray(),
      db.collection('tutors').find().sort({ createdAt: -1 }).limit(100).toArray()
    ]);
    res.json({
      success: true,
      stats: { totalParents, pendingParents, matchedParents, activeSessions, totalTutors, verifiedTutors },
      recentParents,
      recentTutors
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
 
// ── VERIFY TUTOR ──
app.patch('/api/admin/tutor/:id/verify', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    await db.collection('tutors').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { verified: true, verifiedAt: new Date() } }
    );
    res.json({ success: true, message: 'Tutor verified!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── UNVERIFY TUTOR ──
app.patch('/api/admin/tutor/:id/unverify', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    await db.collection('tutors').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { verified: false } }
    );
    res.json({ success: true, message: 'Tutor unverified!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE TUTOR ──
app.delete('/api/admin/tutor/:id', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    await db.collection('tutors').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: 'Tutor deleted!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── UPDATE PARENT STATUS (pending / matched / active / closed) ──
app.patch('/api/admin/parent/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, assignedTutorName, assignedTutorWhatsapp } = req.body;
    const db = await connectDB();
    const update = { status, updatedAt: new Date() };
    if (assignedTutorName) update.assignedTutorName = assignedTutorName;
    if (assignedTutorWhatsapp) update.assignedTutorWhatsapp = assignedTutorWhatsapp;
    await db.collection('parents').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    res.json({ success: true, message: `Status updated to ${status}!` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── DELETE PARENT ──
app.delete('/api/admin/parent/:id', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    await db.collection('parents').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: 'Parent deleted!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────
// CHAT ROUTES
// ─────────────────────────────────────────────

// ── SEND MESSAGE ──
app.post('/api/chat/send', async (req, res) => {
  try {
    const { roomId, senderWa, senderName, senderRole, receiverWa, text, urgent } = req.body;
    if (!roomId || !senderWa || !text)
      return res.status(400).json({ success: false, message: 'roomId, senderWa, text required!' });
    const db = await connectDB();
    const msg = {
      roomId,
      senderWa,
      senderName: senderName || 'Unknown',
      senderRole: senderRole || 'user',
      receiverWa: receiverWa || null,
      text,
      urgent: urgent === true || urgent === 'true',
      sentAt: new Date()
    };
    const result = await db.collection('chats').insertOne(msg);
    res.json({ success: true, messageId: result.insertedId, sentAt: msg.sentAt });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET MESSAGES FOR A ROOM ──
app.get('/api/chat/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const after = req.query.after ? new Date(req.query.after) : null;
    const db = await connectDB();
    const query = { roomId };
    if (after) query.sentAt = { $gt: after };
    const messages = await db.collection('chats')
      .find(query).sort({ sentAt: 1 }).limit(limit).toArray();
    res.json({ success: true, count: messages.length, data: messages });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET ALL CHAT ROOMS FOR A USER ──
app.get('/api/chat/rooms/:waNumber', async (req, res) => {
  try {
    const { waNumber } = req.params;
    const db = await connectDB();
    const rooms = await db.collection('chats').aggregate([
      { $match: { $or: [{ senderWa: waNumber }, { receiverWa: waNumber }] } },
      { $sort: { sentAt: -1 } },
      { $group: {
          _id: '$roomId',
          lastMessage: { $first: '$text' },
          lastSender: { $first: '$senderName' },
          lastTime: { $first: '$sentAt' },
          urgent: { $first: '$urgent' }
      }},
      { $sort: { lastTime: -1 } }
    ]).toArray();
    res.json({ success: true, count: rooms.length, data: rooms });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = app;