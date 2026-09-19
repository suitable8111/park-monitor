import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/park.db';

// DB 디렉토리 보장
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','operator')),
    name          TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plate        TEXT NOT NULL,          -- 정규화된 번호 (공백제거)
    plate_raw    TEXT,                   -- 원본 표기
    type         TEXT NOT NULL CHECK (type IN ('resident','visitor')),
    owner_name   TEXT,
    dong         TEXT,                   -- 동
    ho           TEXT,                   -- 호
    phone        TEXT,
    visit_start  TEXT,                   -- 방문객: 시작일시 (ISO)
    visit_end    TEXT,                   -- 방문객: 종료일시 (ISO)
    memo         TEXT,
    created_by   INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);

  CREATE TABLE IF NOT EXISTS scan_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plate        TEXT NOT NULL,
    result       TEXT NOT NULL,          -- resident | visitor_valid | visitor_expired | visitor_notyet | unknown
    matched_id   INTEGER,                -- 매칭된 vehicles.id (없으면 NULL)
    matched_info TEXT,                   -- 매칭 스냅샷(JSON 문자열)
    location     TEXT,                   -- 촬영 위치 메모
    scanned_by   INTEGER,
    scanned_by_name TEXT,
    scanned_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scan_plate ON scan_logs(plate);
`);

// 최초 관리자 계정 시드
export function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'admin', ?)"
    ).run(username, hash, '관리자');
    console.log(`[seed] 관리자 계정 생성: ${username} / ${password}  (배포 후 반드시 변경하세요)`);
  }
}
