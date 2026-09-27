const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { initDb } = require('./db');
const counterRoutes = require('./routes/counter');
const postsRoutes = require('./routes/posts');
const reactionsRoutes = require('./routes/reactions');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

// Sécurité & Middleware
app.use(helmet({
  contentSecurityPolicy: false // Permettre l'exécution du Service Worker et Web Audio
}));
app.use(cors());
app.use(express.json());

// Routes API
app.use('/api/counter', counterRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/reactions', reactionsRoutes);
app.use('/api/reports', reportsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'WANDA API', time: new Date().toISOString() });
});

// Servir les fichiers statiques du Frontend PWA
app.use(express.static(path.join(__dirname, '../frontend')));

// Fallback pour SPA / PWA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Démarrage du serveur et initialisation DB
app.listen(PORT, async () => {
  console.log(`\n===========================================`);
  console.log(`💥 WANDA Server actif sur http://localhost:${PORT}`);
  console.log(`🚀 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`===========================================\n`);
  
  await initDb();
});
