// 번호판 OCR 파이프라인 (Tesseract.js)
// - 지속 워커 1회 생성/재사용 (kor)
// - 전처리: 그레이스케일 + 이진화 + 업스케일
// - 여러 (크롭/전처리/PSM) 시도 후 유효 번호판을 우선 채택
// - 실측(실제 번호판 사진)으로 튜닝: 크롭 + PSM8(단어) + 전처리 조합이 가장 정확
import { extractPlate, isValidPlate } from './plate.js';

const DIGITS = '0123456789';
const HANGUL =
  '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주바사아자하허호배' +
  '서울부산대구인천광주대전울강원경기충남북전제세종';

let worker = null;
let warming = null;

export async function warmupOcr(onStatus) {
  if (worker) return worker;
  if (warming) return warming;
  if (typeof Tesseract === 'undefined') throw new Error('OCR 엔진(Tesseract) 로드 실패');
  warming = (async () => {
    onStatus?.('OCR 엔진 준비 중… (최초 1회 언어데이터 다운로드로 시간이 걸릴 수 있어요)');
    const w = await Tesseract.createWorker('kor', 1);
    await w.setParameters({ tessedit_char_whitelist: DIGITS + HANGUL });
    worker = w;
    warming = null;
    return w;
  })();
  return warming;
}

// 소스(canvas/img/video) → 캔버스. crop={cx,cy,wf,hf} (중심 기준 비율), null이면 전체.
function toCanvas(src, crop) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (crop) {
    cw = Math.round(sw * crop.wf);
    ch = Math.round(sh * crop.hf);
    sx = Math.round(sw * (crop.cx ?? 0.5) - cw / 2);
    sy = Math.round(sh * (crop.cy ?? 0.5) - ch / 2);
  }
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(src, sx, sy, cw, ch, 0, 0, cw, ch);
  return c;
}

// 그레이스케일 + 이진화 + 업스케일
function preprocess(src, upscale = 2) {
  const c = document.createElement('canvas');
  c.width = src.width * upscale;
  c.height = src.height * upscale;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.drawImage(src, 0, 0, c.width, c.height);
  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  const th = (sum / (d.length / 4)) * 0.88;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] < th ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(img, 0, 0);
  return c;
}

async function recognize(canvas, psm) {
  const w = await warmupOcr();
  await w.setParameters({ tessedit_pageseg_mode: String(psm) });
  const { data } = await w.recognize(canvas.toDataURL('image/png'));
  return { text: (data.text || '').trim(), confidence: data.confidence || 0 };
}

// 카메라 촬영: 가이드 박스만 크롭(중앙). 업로드: 위치 추정 크롭 여러 개 시도.
function plansFor(cropFrac) {
  if (cropFrac) {
    const crop = { cx: 0.5, cy: 0.5, ...cropFrac };
    return [
      { crop, pre: true, psm: 8 },   // 단어 모드 + 전처리 (가장 정확)
      { crop, pre: true, psm: 7 },   // 한 줄 모드
      { crop, pre: false, psm: 8 },  // 색/엠보싱 대비 원본
    ];
  }
  return [
    { crop: { cx: 0.5, cy: 0.56, wf: 0.8, hf: 0.34 }, pre: true, psm: 8 },
    { crop: { cx: 0.5, cy: 0.5, wf: 0.9, hf: 0.42 }, pre: true, psm: 8 },
    { crop: null, pre: true, psm: 11 }, // 전체에서 흩어진 텍스트 탐색
    { crop: null, pre: false, psm: 3 }, // 최후 자동
  ];
}

// 반환: { plate, valid, raw, confidence }
export async function recognizePlate(src, { cropFrac } = {}, onStatus) {
  await warmupOcr(onStatus);
  onStatus?.('글자 인식 중…');

  const attempts = [];
  for (const p of plansFor(cropFrac)) {
    const base = toCanvas(src, p.crop);
    const canvas = p.pre ? preprocess(base) : base;
    const r = await recognize(canvas, p.psm);
    const plate = extractPlate(r.text);
    attempts.push({ ...r, plate });
    if (isValidPlate(plate)) {
      return { plate, valid: true, raw: r.text, confidence: Math.round(r.confidence) };
    }
  }
  // 유효한 번호판을 못 찾음 → 신뢰도 최고 후보 반환(운영자 수정 유도)
  const best = attempts.sort((a, b) => b.confidence - a.confidence)[0] || { plate: '', text: '', confidence: 0 };
  return { plate: best.plate, valid: false, raw: best.text, confidence: Math.round(best.confidence) };
}
