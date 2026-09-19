import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { normalizePlate } from '../plate.js';

const router = Router();
router.use(requireAuth);

// 목록 (검색: q=번호일부, type=resident|visitor)
router.get('/', (req, res) => {
  const { q, type } = req.query;
  let sql = 'SELECT * FROM vehicles WHERE 1=1';
  const params = [];
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (q) {
    sql += ' AND (plate LIKE ? OR owner_name LIKE ? OR dong LIKE ? OR ho LIKE ?)';
    const like = `%${normalizePlate(q)}%`;
    const likeRaw = `%${q}%`;
    params.push(like, likeRaw, likeRaw, likeRaw);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// 단건
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '차량을 찾을 수 없습니다.' });
  res.json(row);
});

// 등록. 입주민(resident) 등록/수정은 관리자만. 방문객(visitor)은 운영진도 가능.
router.post('/', (req, res) => {
  const b = req.body || {};
  const type = b.type === 'resident' ? 'resident' : 'visitor';
  if (type === 'resident' && req.user.role !== 'admin') {
    return res.status(403).json({ error: '입주민 차량 등록은 관리자만 가능합니다.' });
  }
  const plate = normalizePlate(b.plate);
  if (!plate) return res.status(400).json({ error: '차량번호를 입력하세요.' });

  const info = db
    .prepare(
      `INSERT INTO vehicles (plate, plate_raw, type, owner_name, dong, ho, phone, visit_start, visit_end, memo, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      plate,
      b.plate || null,
      type,
      b.owner_name || null,
      b.dong || null,
      b.ho || null,
      b.phone || null,
      b.visit_start || null,
      b.visit_end || null,
      b.memo || null,
      req.user.id
    );
  res.status(201).json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid));
});

// 수정. 입주민 차량 수정은 관리자만.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '차량을 찾을 수 없습니다.' });
  const b = req.body || {};
  const type = b.type || existing.type;
  if ((existing.type === 'resident' || type === 'resident') && req.user.role !== 'admin') {
    return res.status(403).json({ error: '입주민 차량 수정은 관리자만 가능합니다.' });
  }
  const plate = b.plate != null ? normalizePlate(b.plate) : existing.plate;
  db.prepare(
    `UPDATE vehicles SET plate=?, plate_raw=?, type=?, owner_name=?, dong=?, ho=?, phone=?,
       visit_start=?, visit_end=?, memo=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    plate,
    b.plate ?? existing.plate_raw,
    type,
    b.owner_name ?? existing.owner_name,
    b.dong ?? existing.dong,
    b.ho ?? existing.ho,
    b.phone ?? existing.phone,
    b.visit_start ?? existing.visit_start,
    b.visit_end ?? existing.visit_end,
    b.memo ?? existing.memo,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id));
});

// 삭제 (관리자만)
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
