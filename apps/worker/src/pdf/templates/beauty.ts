import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  PAGE_W, PAGE_H, pt,
  drawText, drawHeader,
  drawNameRowBeauty, drawAddressRow, drawConsentSection,
  drawMemoSection, drawRect, splitLines,
} from './base.js';
import { convertToWareki } from '../utils/wareki.js';
import { getZipcodeFromAddress } from '../utils/zipcode.js';

export async function generateBeautyPdf(
  answers: Record<string, string>,
  fontBytes: ArrayBuffer,
  logoBytes?: ArrayBuffer | null,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await pdfDoc.embedFont(fontBytes);
  const logoImage = logoBytes ? await pdfDoc.embedJpg(logoBytes) : undefined;

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const marginLeft = pt(15);
  const contentWidth = PAGE_W - pt(15) - pt(15);

  const data: Record<string, string> = {
    ...answers,
    birthday_wareki: convertToWareki(answers.birthday ?? ''),
    zipcode: answers.zipcode || getZipcodeFromAddress(answers.address ?? ''),
  };

  let currentY = PAGE_H - pt(12);

  // === ヘッダー ===
  currentY = drawHeader(page, font, marginLeft, currentY, '問診票（美容鍼）', logoImage);

  // === 基本情報（性別・職業なし） ===
  currentY = drawNameRowBeauty(page, font, marginLeft, currentY, contentWidth, data);
  currentY = drawAddressRow(page, font, marginLeft, currentY, contentWidth, data);

  // === 同意確認 ===
  const beautyNotices = [
    '□ 美容鍼は自費施術となります',
    '□ 使い捨ての鍼を使用しており、感染の心配はありません',
    '□ 効果には個人差があります',
    '□ 内出血の可能性があります（数日〜数週間で消えます）',
    '□ イベント前の施術は事前にお申し出ください',
    '□ 医療行為ではなく、効果を保証するものではありません',
  ];
  currentY = drawConsentSection(page, font, marginLeft, currentY, contentWidth, beautyNotices);

  // === 施術メニュー ===
  drawText(page, '●ご希望のメニュー', marginLeft, currentY, font, 11);
  drawText(page, data.menu ?? '', marginLeft + pt(40), currentY, font, 11);
  currentY -= pt(8);

  // === 確認項目（7項目） ===
  drawText(page, '●以下の項目についてお答えください', marginLeft, currentY, font, 11);
  currentY -= pt(5);

  const checkItems: [string, string][] = [
    ['past_beauty', '美容鍼を受けたことがありますか'],
    ['past_bleeding', '（経験ありの場合）内出血したことがありますか'],
    ['alcohol_skin', 'アルコール消毒で肌が赤くなりますか'],
    ['facial_palsy', '顔面麻痺の既往がありますか'],
    ['blood_thinner', '血液をサラサラにする薬を服用していますか'],
    ['pregnancy', '現在妊娠中ですか'],
    ['pacemaker', 'ペースメーカーを使用していますか'],
  ];

  for (const [key, label] of checkItems) {
    drawText(page, `・${label}: ${data[key] ?? ''}`, marginLeft + pt(5), currentY, font, 10);
    currentY -= pt(4.5);
  }
  currentY -= pt(3);

  // === お顔の悩み ===
  drawText(page, '●お顔で気になることをお聞かせください', marginLeft, currentY, font, 11);
  currentY -= pt(4);

  const concernsBoxH = pt(18);
  drawRect(page, marginLeft, currentY - concernsBoxH, contentWidth, concernsBoxH);

  const concerns = data.face_concerns ?? '';
  const concernLines = splitLines(concerns, font, 10, contentWidth - pt(6));
  let cy = currentY - pt(6);
  for (const line of concernLines.slice(0, 2)) {
    drawText(page, line, marginLeft + pt(3), cy, font, 10);
    cy -= pt(6);
  }

  currentY -= concernsBoxH + pt(6);

  // 特に気になる3つ
  drawText(page, '●特に気になる点（3つまで）', marginLeft, currentY, font, 11);
  drawText(page, data.top3_concerns ?? '', marginLeft + pt(55), currentY, font, 10);
  currentY -= pt(6);

  // === イベント予定 ===
  const event = data.event ?? 'いいえ';
  drawText(page, '●近日中にイベント（結婚式・撮影など）の予定がありますか', marginLeft, currentY, font, 11);
  drawText(page, event, marginLeft + pt(135), currentY, font, 11);

  if (event === 'はい') {
    currentY -= pt(4);
    drawText(page, `詳細: ${data.event_detail ?? ''}`, marginLeft + pt(5), currentY, font, 10);
  }
  currentY -= pt(6);

  // === その他 ===
  drawText(page, '●その他、ご質問やご要望があればお聞かせください', marginLeft, currentY, font, 11);
  currentY -= pt(4);

  const bottomMargin = pt(12);
  const remaining = currentY - bottomMargin - pt(6);
  const otherBoxH = remaining / 2;

  if (otherBoxH > 0) {
    drawRect(page, marginLeft, currentY - otherBoxH, contentWidth, otherBoxH);
    drawText(page, data.other_notes ?? '', marginLeft + pt(3), currentY - pt(8), font, 10);
    currentY -= otherBoxH + pt(4);
  }

  // === 施術者記入欄 ===
  drawMemoSection(page, font, marginLeft, currentY, contentWidth);

  return pdfDoc.save();
}
