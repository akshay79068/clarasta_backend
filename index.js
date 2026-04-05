const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();

app.use(cors({
  origin: [
    'https://clarasta.in',
    'https://www.clarasta.in',
    'http://localhost:3000'
  ]
}));
app.use(express.json());

// ─── MongoDB Connection ───────────────────────────────────────────
const MONGO_URI = process.env.MONGODB_URI; // Vercel env variable mein daalo
const DB_NAME = 'clarasta';

let db;

async function connectDB() {
  if (db) return db;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('✅ MongoDB connected');
  return db;
}

// ─── PARENT SIGNUP ────────────────────────────────────────────────
app.post('/api/parent/signup', async (req, res) => {
  try {
    const { name, whatsapp, society, childClass, subject } = req.body;

    if (!name || !whatsapp || !society || !childClass || !subject) {
      return res.status(400).json({ success: false, message: 'Sab fields bharo!' });
    }

    // WhatsApp number validate (10 digits)
    const cleaned = whatsapp.replace(/\D/g, '');
    if (cleaned.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit WhatsApp number daalo' });
    }

    const database = await connectDB();
    const parents = database.collection('parents');

    const doc = {
      name: name.trim(),
      whatsapp: cleaned,
      society: society.trim(),
      childClass,
      subject,
      status: 'pending',       // pending → matched → active
      matchedTutorId: null,
      createdAt: new Date()
    };

    const result = await parents.insertOne(doc);

    res.json({
      success: true,
      message: `${name} ji, request aa gaya! 2 ghante mein WhatsApp pe tutor bhejenge. 🙏`,
      id: result.insertedId
    });

  } catch (err) {
    console.error('Parent signup error:', err);
    res.status(500).json({ success: false, message: 'Server error, thoda baad try karo' });
  }
});

// ─── TUTOR SIGNUP ─────────────────────────────────────────────────
app.post('/api/tutor/signup', async (req, res) => {
  try {
    const { name, whatsapp, college, branch, subjects, society, availability } = req.body;

    if (!name || !whatsapp || !college || !branch || !subjects || !society) {
      return res.status(400).json({ success: false, message: 'Sab fields bharo!' });
    }

    const cleaned = whatsapp.replace(/\D/g, '');
    if (cleaned.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit WhatsApp number daalo' });
    }

    const database = await connectDB();
    const tutors = database.collection('tutors');

    // Duplicate check
    const existing = await tutors.findOne({ whatsapp: cleaned });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Is number se pehle se signup hai! Koi problem ho toh WhatsApp karo.'
      });
    }

    const subjectList = typeof subjects === 'string'
      ? subjects.split(',').map(s => s.trim()).filter(Boolean)
      : subjects;

    const doc = {
      name: name.trim(),
      whatsapp: cleaned,
      college: college.trim(),
      branch,
      subjects: subjectList,
      society: society.trim(),
      availability: availability || 'Evening (6–8 PM)',
      verified: false,
      rating: null,
      totalSessions: 0,
      earnings: 0,
      createdAt: new Date()
    };

    const result = await tutors.insertOne(doc);

    res.json({
      success: true,
      message: `Welcome ${name}! Profile submit ho gaya. 24 ghante mein college ID verify karke activate kar denge. 🎓`,
      id: result.insertedId
    });

  } catch (err) {
    console.error('Tutor signup error:', err);
    res.status(500).json({ success: false, message: 'Server error, thoda baad try karo' });
  }
});

// ─── GET TUTORS (Public — for frontend listing) ───────────────────
app.get('/api/tutors', async (req, res) => {
  try {
    const { society, subject, childClass } = req.query;
    const database = await connectDB();
    const tutors = database.collection('tutors');

    const query = { verified: true };

    if (society && society !== 'All Societies') {
      query.society = { $regex: society, $options: 'i' };
    }
    if (subject && subject !== 'All Subjects') {
      query.subjects = { $regex: subject, $options: 'i' };
    }

    const results = await tutors
      .find(query, {
        projection: { whatsapp: 0 } // Hide WhatsApp from public
      })
      .sort({ rating: -1, totalSessions: -1 })
      .toArray();

    res.json({ success: true, count: results.length, data: results });

  } catch (err) {
    console.error('Get tutors error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ADMIN MIDDLEWARE ─────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_SECRET || 'clarasta2025admin';

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized bhai!' });
  }
  next();
}

// ─── ADMIN: DASHBOARD ─────────────────────────────────────────────
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    const database = await connectDB();
    const parents = database.collection('parents');
    const tutors = database.collection('tutors');

    const [
      totalParents,
      pendingParents,
      totalTutors,
      verifiedTutors,
      recentParents,
      recentTutors
    ] = await Promise.all([
      parents.countDocuments(),
      parents.countDocuments({ status: 'pending' }),
      tutors.countDocuments(),
      tutors.countDocuments({ verified: true }),
      parents.find().sort({ createdAt: -1 }).limit(50).toArray(),
      tutors.find().sort({ createdAt: -1 }).limit(50).toArray()
    ]);

    res.json({
      success: true,
      stats: {
        totalParents,
        pendingParents,
        totalTutors,
        verifiedTutors,
        pendingVerification: totalTutors - verifiedTutors
      },
      recentParents,
      recentTutors
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── ADMIN: VERIFY TUTOR ──────────────────────────────────────────
app.patch('/api/admin/tutor/:id/verify', adminAuth, async (req, res) => {
  try {
    const database = await connectDB();
    const tutors = database.collection('tutors');

    const result = await tutors.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { verified: true, verifiedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ message: 'Tutor nahi mila' });

    res.json({ success: true, message: `${result.name} verify ho gaya! ✅` });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// ─── ADMIN: MATCH PARENT WITH TUTOR ──────────────────────────────
app.patch('/api/admin/parent/:id/match', adminAuth, async (req, res) => {
  try {
    const { tutorId } = req.body;
    const database = await connectDB();
    const parents = database.collection('parents');
    const tutors = database.collection('tutors');

    const tutor = await tutors.findOne({ _id: new ObjectId(tutorId) });
    if (!tutor) return res.status(404).json({ message: 'Tutor nahi mila' });

    await parents.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'matched', matchedTutorId: tutorId, matchedAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'Match ho gaya!',
      tutorWhatsapp: tutor.whatsapp,
      tutorName: tutor.name
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// ─── ADMIN: REJECT / DELETE TUTOR ────────────────────────────────
app.delete('/api/admin/tutor/:id', adminAuth, async (req, res) => {
  try {
    const database = await connectDB();
    await database.collection('tutors').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, message: 'Tutor remove ho gaya' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Clarasta API',
    db: db ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.listen(3000, () => {
  console.log("✅ Server started on http://localhost:3000");
});