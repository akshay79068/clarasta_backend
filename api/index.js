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
 
const ADMIN_KEY = process.env.ADMIN_SECRET || 'clarasta2025admin';
function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY)
    return res.status(401).json({ message: 'Unauthorized!' });
  next();
}
 
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    const [totalParents, pendingParents, totalTutors, verifiedTutors, recentParents, recentTutors] = await Promise.all([
      db.collection('parents').countDocuments(),
      db.collection('parents').countDocuments({ status: 'pending' }),
      db.collection('tutors').countDocuments(),
      db.collection('tutors').countDocuments({ verified: true }),
      db.collection('parents').find().sort({ createdAt: -1 }).limit(50).toArray(),
      db.collection('tutors').find().sort({ createdAt: -1 }).limit(50).toArray()
    ]);
    res.json({ success: true, stats: { totalParents, pendingParents, totalTutors, verifiedTutors }, recentParents, recentTutors });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
 
app.patch('/api/admin/tutor/:id/verify', adminAuth, async (req, res) => {
  try {
    const db = await connectDB();
    await db.collection('tutors').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { verified: true } });
    res.json({ success: true, message: 'Tutor verified!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
 
module.exports = app;