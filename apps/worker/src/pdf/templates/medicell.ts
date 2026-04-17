import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  PAGE_W, PAGE_H, pt,
  drawText, drawHeader,
  drawNameRowBeauty, drawAddressRow, drawConsentSection,
  drawMemoSection, drawRect, drawBodyFigure, splitLines, embedImageAuto,
} from './base.js';
import { convertToWareki } from '../utils/wareki.js';
import { getZipcodeFromAddress } from '../utils/zipcode.js';

export async function generateMedicellPdf(
  answers: Record<string, string>,
  fontBytes: ArrayBuffer,
  logoBytes?: ArrayBuffer | null,
  figureBytes?: ArrayBuffer | null,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await pdfDoc.embedFont(fontBytes);
  const logoImage = await embedImageAuto(pdfDoc, logoBytes);
  const figureImage = await embedImageAuto(pdfDoc, figureBytes);

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
  currentY = drawHeader(page, font, marginLeft, currentY, '問診票（美療メディセル）', logoImage);

  // === 基本情報（性別なし） ===
  currentY = drawNameRowBeauty(page, font, marginLeft, currentY, contentWidth, data);
  currentY = drawAddressRow(page, font, marginLeft, currentY, contentWidth, data);

  // === 同意確認 ===
  const medicellNotices = [
    '□ 美療メディセルは皮膚を吸引し筋膜をほぐすことで、血液・リンパの流れを促進します',
    '□ 施術後、赤みや内出血が出る場合があります（数日で消えます）',
    '□ 効果には個人差があります',
    '□ ペースメーカー使用中・妊娠中の方は施術をお受けいただけません',
    '□ 自費施術となります',
  ];
  currentY = drawConsentSection(page, font, marginLeft, currentY, contentWidth, medicellNotices);

  // === 禁忌確認 ===
  drawText(page, '●以下の項目についてお答えください（施術可否の確認）', marginLeft, currentY, font, 11);
  currentY -= pt(5);

  const contraindications: [string, string][] = [
    ['pregnancy', '現在妊娠中ですか'],
    ['pacemaker', 'ペースメーカーを使用していますか'],
    ['skin_condition', '施術部位に皮膚疾患（湿疹・炎症など）はありますか'],
  ];

  for (const [key, label] of contraindications) {
    drawText(page, `・${label}: ${data[key] ?? ''}`, marginLeft + pt(5), currentY, font, 10);
    currentY -= pt(4);
  }
  currentY -= pt(3);

  // === 既往歴 ===
  drawText(page, '●治療中の病気はありますか', marginLeft, currentY, font, 11);
  currentY -= pt(4);

  const illness = data.current_illness ?? 'ない';
  if (illness === 'ある') {
    drawText(page, `ある: ${data.current_illness_detail ?? ''}`, marginLeft + pt(5), currentY, font, 10);
  } else {
    drawText(page, 'ない', marginLeft + pt(5), currentY, font, 10);
  }
  currentY -= pt(6);

  // === 症状セクション（人体図と並列） ===
  const sectionStartY = currentY;

  // ① 症状の詳細
  drawText(page, '① どのような症状がありますか（右図に該当箇所を○してください）', marginLeft, currentY, font, 11);
  currentY -= pt(5);

  const symptoms = data.symptoms ?? '';
  const sympLines = splitLines(symptoms, font, 10, contentWidth * 0.5 - pt(5));
  for (const line of sympLines.slice(0, 2)) {
    drawText(page, line, marginLeft + pt(5), currentY, font, 10);
    currentY -= pt(4);
  }
  currentY -= pt(2);

  // ② 症状の期間
  drawText(page, '② 症状はいつからですか', marginLeft, currentY, font, 11);
  currentY -= pt(5);
  drawText(page, data.duration ?? '', marginLeft + pt(5), currentY, font, 10);
  currentY -= pt(6);

  // ③ 悪化する時
  drawText(page, '③ 症状が悪化するのはどんな時ですか', marginLeft, currentY, font, 11);
  currentY -= pt(5);
  drawText(page, data.worse_time ?? '', marginLeft + pt(5), currentY, font, 10);
  currentY -= pt(6);

  // ④ つらさの程度
  drawText(page, '④ つらさの程度（10段階）', marginLeft, currentY, font, 11);
  currentY -= pt(5);
  drawText(page, data.severity ?? '', marginLeft + pt(5), currentY, font, 10);

  // 人体図（右側）
  drawBodyFigure(page, figureImage, marginLeft, sectionStartY, contentWidth, 62);

  currentY -= pt(8);

  // === メディセル経験 ===
  drawText(page, '●メディセルを受けたことがありますか', marginLeft, currentY, font, 11);
  drawText(page, data.past_medicell ?? 'いいえ', marginLeft + pt(80), currentY, font, 11);
  currentY -= pt(6);

  // === 希望施術範囲 ===
  drawText(page, '●ご希望の施術範囲', marginLeft, currentY, font, 11);
  drawText(page, data.treatment_area ?? '', marginLeft + pt(45), currentY, font, 11);
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
