import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { normalizePlate, visitStatus } from '../plate.js';

const router = Router();
router.use(requireAuth);

// 번호로 차량 조회 + 분류 (단속 판정). 로그는 남기지 않음(미리보기용).
router.get('/lookup', (req, res) => {
  const plate = normalizePlate(req.query.plate);
  if (!plate) return res.status(400).json({ error: '차량번호를 입력하세요.' });
  res.json(classify(plate));
});

// 단속 기록 저장 (판정 + 로그 남김)
router.post('/', (req, res) => {
  const plate = normalizePlate(req.body?.plate);
  if (!plate) return res.status(400).json({ error: '차량번호를 입력하세요.' });
  const c = classify(plate);
  const info = db
    .prepare(
      `INSERT INTO scan_logs (plate, result, matched_id, matched_info, location, scanned_by, scanned_by_name)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      plate,
      c.result,
      c.vehicle?.id || null,
      c.vehicle ? JSON.stringify(c.vehicle) : null,
      req.body?.location || null,
      req.user.id,
      req.user.name || req.user.username
    );
  res.status(201).json({ ...c, logId: info.lastInsertRowid });
});

// 단속 기록 목록
router.get('/', (req, res) => {
  const { q, result } = req.query;
  let sql = 'SELECT * FROM scan_logs WHERE 1=1';
  const params = [];
  if (result) {
    sql += ' AND result = ?';
    params.push(result);
  }
  if (q) {
    sql += ' AND plate LIKE ?';
    params.push(`%${normalizePlate(q)}%`);
  }
  sql += ' ORDER BY scanned_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// 단속 기록 삭제 (관리자만)
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM scan_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── 분류 로직 ────────────────────────────────────────────────
function classify(plate) {
  const matches = db
    .prepare('SELECT * FROM vehicles WHERE plate = ? ORDER BY type ASC')
    .all(plate);

  if (matches.length === 0) {
    return { plate, result: 'unknown', label: '미인식 차량', vehicle: null };
  }
  // 입주민 우선
  const resident = matches.find((m) => m.type === 'resident');
  if (resident) {
    return { plate, result: 'resident', label: '입주민 차량', vehicle: resident };
  }
  const visitor = matches[0];
  const st = visitStatus(visitor.visit_start, visitor.visit_end);
  const map = {
    valid: { result: 'visitor_valid', label: '방문객 차량 (기간 유효)' },
    always: { result: 'visitor_valid', label: '방문객 차량 (상시 등록)' },
    expired: { result: 'visitor_expired', label: '방문객 차량 (기간 만료)' },
    notyet: { result: 'visitor_notyet', label: '방문객 차량 (기간 이전)' },
  };
  const m = map[st];
  return { plate, result: m.result, label: m.label, vehicle: visitor };
}

export default router;
