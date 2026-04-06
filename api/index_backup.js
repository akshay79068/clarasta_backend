app.get('/api/health', async (req, res) => {
  try {
    await connectDB();
    res.json({
      status: 'ok',
      service: 'Clarasta API',
      db: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch(e) {
    res.json({
      status: 'ok',
      service: 'Clarasta API',
      db: 'disconnected',
      error: e.message,
      timestamp: new Date().toISOString()
    });
  }
});