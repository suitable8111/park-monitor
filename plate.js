// 차량번호 정규화 및 검증 유틸 (백엔드/프론트 공용 로직 — 프론트는 public/js/plate.js에 복제)

// 공백/하이픈 제거, 대문자화(영문 번호판 대비). 한글은 그대로.
export function normalizePlate(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\s+/g, '')
    .replace(/[-·.]/g, '')
    .toUpperCase()
    .trim();
}

// 한국 번호판 형식 대략 검증
//  - 신형: 2~3자리 숫자 + 한글 1자 + 4자리 숫자   (예: 21다2312, 123가4567)
//  - 구형: 한글 지역 + 2자리 숫자 + 한글 1자 + 4자리 숫자 (예: 서울12가3456)
const NEW_FORMAT = /^\d{2,3}[가-힣]\d{4}$/;
const OLD_FORMAT = /^[가-힣]{2}\d{2}[가-힣]\d{4}$/;

export function isValidPlate(raw) {
  const p = normalizePlate(raw);
  return NEW_FORMAT.test(p) || OLD_FORMAT.test(p);
}

// 방문객 차량 유효기간 판정: 'valid' | 'expired' | 'notyet' | 'always'
export function visitStatus(visitStart, visitEnd, now = new Date()) {
  if (!visitStart && !visitEnd) return 'always';
  const t = now.getTime();
  if (visitStart && t < new Date(visitStart).getTime()) return 'notyet';
  if (visitEnd && t > new Date(visitEnd).getTime()) return 'expired';
  return 'valid';
}
