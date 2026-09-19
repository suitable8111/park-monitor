import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAdmin } from './db.js';
import authRoutes from './routes/auth.js';
import vehicleRoutes from './routes/vehicles.js';
import scanRoutes from './routes/scans.js';
import userRoutes from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '2mb' }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/users', userRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 정적 프론트엔드
app.use(express.static(path.join(__dirname, 'public')));

// 최초 관리자 시드
seedAdmin();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`주차 단속 관리 서버 실행 중: http://localhost:${PORT}`);
});
