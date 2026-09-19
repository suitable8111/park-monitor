// 프론트엔드용 번호판 유틸 (백엔드 plate.js와 동일 로직)
export function normalizePlate(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, '').replace(/[-·.]/g, '').toUpperCase().trim();
}

const NEW_FORMAT = /^\d{2,3}[가-힣]\d{4}$/;
const OLD_FORMAT = /^[가-힣]{2}\d{2}[가-힣]\d{4}$/;

export function isValidPlate(raw) {
  const p = normalizePlate(raw);
  return NEW_FORMAT.test(p) || OLD_FORMAT.test(p);
}

// OCR 원문에서 번호판 패턴 추출 (가장 그럴듯한 후보 반환)
export function extractPlate(text) {
  if (!text) return '';
  const cleaned = text.replace(/[^0-9가-힣]/g, '');
  // 신형/구형 패턴 우선 매칭
  const patterns = [/\d{2,3}[가-힣]\d{4}/, /[가-힣]{2}\d{2}[가-힣]\d{4}/];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) return m[0];
  }
  return cleaned;
}
