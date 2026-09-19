import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin); // 사용자 관리는 관리자 전용

router.get('/', (req, res) => {
  res.json(
    db.prepare('SELECT id, username, role, name, active, created_at FROM users ORDER BY id').all()
  );
});

router.post('/', (req, res) => {
  const { username, password, role, name } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });
  }
  const r = role === 'admin' ? 'admin' : 'operator';
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, name) VALUES (?,?,?,?)')
    .run(username, hash, r, name || null);
  res.status(201).json(
    db.prepare('SELECT id, username, role, name, active, created_at FROM users WHERE id = ?').get(info.lastInsertRowid)
  );
});

// 활성/비활성 토글 및 정보 수정
router.put('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  const { role, name, active, password } = req.body || {};
  const newRole = role ? (role === 'admin' ? 'admin' : 'operator') : u.role;
  const newActive = active == null ? u.active : active ? 1 : 0;
  db.prepare('UPDATE users SET role=?, name=?, active=? WHERE id=?').run(
    newRole,
    name ?? u.name,
    newActive,
    u.id
  );
  if (password) {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), u.id);
  }
  res.json(db.prepare('SELECT id, username, role, name, active, created_at FROM users WHERE id = ?').get(u.id));
});

router.delete('/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
