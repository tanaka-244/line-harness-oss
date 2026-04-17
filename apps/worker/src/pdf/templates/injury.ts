import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  PAGE_W, PAGE_H, pt,
  drawText, drawRect, drawHLine, drawVLine,
  drawHeader,
  drawConsentSection, drawOtherClinic, drawMedicalHistory,
  drawReferral, drawMemoSection, drawBodyFigure, splitLines, embedImageAuto,
} from './base.js';
import { convertToWareki, convertRelativeDate } from '../utils/wareki.js';
import { getZipcodeFromAddress } from '../utils/zipcode.js';

export async function generateInjuryPdf(
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

  const marginLeft = pt(12);
  const marginRight = pt(12);
  const contentWidth = PAGE_W - marginLeft - marginRight;

  const data: Record<string, string> = {
    ...answers,
    birthday_wareki: convertToWareki(answers.birthday ?? ''),
    injury_when_date: convertRelativeDate(answers.injury_when ?? ''),
    zipcode: answers.zipcode || getZipcodeFromAddress(answers.address ?? ''),
  };

  let currentY = PAGE_H - pt(12);

  // === ヘッダー（ロゴ + タイトル + 記入日） ===
  currentY = drawHeader(page, font, marginLeft, currentY, '問診票（ケガ・急性症状）', logoImage);

  // === 基本情報行1: 氏名 / 生年月日+職業 / 性別 ===
  const rowH1 = pt(18);
  const nameCellW = pt(75);
  const middleCellW = pt(80);
  const genderCellW = contentWidth - nameCellW - middleCellW;

  drawRect(page, marginLeft, currentY - rowH1, nameCellW, rowH1);
  drawHLine(page, marginLeft, marginLeft + nameCellW, currentY - pt(7));
  drawVLine(page, marginLeft + pt(22), currentY, currentY - rowH1);

  drawText(page, 'ふりがな', marginLeft + pt(2), currentY - pt(5), font, 10);
  drawText(page, '氏名', marginLeft + pt(2), currentY - pt(14), font, 11);
  drawText(page, data.furigana ?? '', marginLeft + pt(25), currentY - pt(5), font, 10);
  drawText(page, data.name ?? '', marginLeft + pt(25), currentY - pt(14), font, 11);

  drawRect(page, marginLeft + nameCellW, currentY - rowH1, middleCellW, rowH1);
  drawHLine(page, marginLeft + nameCellW, marginLeft + nameCellW + middleCellW, currentY - pt(9));

  drawText(page, '生年月日', marginLeft + nameCellW + pt(2), currentY - pt(6), font, 11);
  drawText(page, '職業', marginLeft + nameCellW + pt(2), currentY - pt(15), font, 11);
  drawText(page, data.birthday_wareki, marginLeft + nameCellW + pt(28), currentY - pt(6), font, 11);
  drawText(page, data.job ?? '', marginLeft + nameCellW + pt(15), currentY - pt(15), font, 11);

  drawRect(page, marginLeft + nameCellW + middleCellW, currentY - rowH1, genderCellW, rowH1);
  const gx = marginLeft + nameCellW + middleCellW + pt(2);
  drawText(page, '性別', gx, currentY - pt(10), font, 11);
  const gender = data.gender ?? '';
  const gval = gender === '男性' ? '男' : gender === '女性' ? '女' : '';
  drawText(page, gval, gx + pt(13), currentY - pt(10), font, 11);

  currentY -= rowH1;

  // === 基本情報行2: 住所 / 電話番号 ===
  const rowH2 = pt(15);
  const addrW = contentWidth * 0.7;
  const phoneW = contentWidth * 0.3;

  drawRect(page, marginLeft, currentY - rowH2, addrW, rowH2);
  drawRect(page, marginLeft + addrW, currentY - rowH2, phoneW, rowH2);
  drawVLine(page, marginLeft + pt(22), currentY, currentY - rowH2);

  drawText(page, '住所', marginLeft + pt(2), currentY - pt(9), font, 11);
  drawText(page, `〒${data.zipcode}`, marginLeft + pt(25), currentY - pt(5), font, 10);
  drawText(page, data.address ?? '', marginLeft + pt(25), currentY - pt(12), font, 10);
  drawText(page, '電話番号', marginLeft + addrW + pt(2), currentY - pt(6), font, 11);
  drawText(page, data.phone ?? '', marginLeft + addrW + pt(2), currentY - pt(12), font, 11);

  currentY -= rowH2 + pt(5);

  // === 同意確認 ===
  const injuryNotices = [
    '□ 整骨院での保険適用は、ケガをした日から約1ヶ月以内の急性症状',
    '　（捻挫・打撲・挫傷・骨折/脱臼の応急処置）が対象です',
    '□ 慢性的な症状（肩こり・腰痛など長期間続くもの）は自費施術となります',
    '□ 通勤中・業務中のケガは「労災保険」、交通事故は「自賠責保険」の扱いとなります',
    '□ 当院では保険施術と自費施術の併用により、早期改善を推奨しております',
    '□ 領収書が必要な場合はお申し付けください',
  ];
  currentY = drawConsentSection(page, font, marginLeft, currentY, contentWidth, injuryNotices);

  // === 症状セクション（人体図と並列） ===
  const sectionStartY = currentY;

  // ① 本日の症状
  drawText(page, '① 本日の症状をご記入ください（右図に該当箇所を○してください）', marginLeft, currentY, font, 11);
  currentY -= pt(6);
  const leftColumnWidth = contentWidth * 0.5 - pt(8);
  const painLocationLines = splitLines(data.pain_location ?? '', font, 11, leftColumnWidth).slice(0, 3);
  for (const line of painLocationLines) {
    drawText(page, line, marginLeft + pt(5), currentY, font, 11);
    currentY -= pt(5);
  }
  currentY -= pt(3);

  // ② 症状はいつから
  drawText(page, '② 症状はいつ（日時）からですか', marginLeft, currentY, font, 11);
  currentY -= pt(6);
  drawText(page, data.injury_when_date, marginLeft + pt(5), currentY, font, 11);
  currentY -= pt(8);

  // ③ どこで何をして
  drawText(page, '③ どこで、何をして症状が出ましたか', marginLeft, currentY, font, 11);
  currentY -= pt(6);
  drawText(page, `場所: ${data.injury_where ?? ''}`, marginLeft + pt(5), currentY, font, 11);
  currentY -= pt(5);
  const injuryHowLines = splitLines(`何をして: ${data.injury_how ?? ''}`, font, 11, leftColumnWidth).slice(0, 2);
  for (const line of injuryHowLines) {
    drawText(page, line, marginLeft + pt(5), currentY, font, 11);
    currentY -= pt(5);
  }
  currentY -= pt(3);

  // ④ 症状について
  drawText(page, '④ 症状について', marginLeft, currentY, font, 11);
  currentY -= pt(6);
  drawText(page, `痛みの程度: ${data.pain_level ?? ''}`, marginLeft + pt(5), currentY, font, 11);
  if (data.current_state) {
    currentY -= pt(5);
    const currentStateLines = splitLines(`その他: ${data.current_state}`, font, 11, leftColumnWidth).slice(0, 3);
    for (const line of currentStateLines) {
      drawText(page, line, marginLeft + pt(5), currentY, font, 11);
      currentY -= pt(5);
    }
  }

  // 人体図（右側）
  drawBodyFigure(page, figureImage, marginLeft, sectionStartY, contentWidth, 92);

  currentY -= pt(3);

  // === 他院受診歴 ===
  currentY = drawOtherClinic(page, font, marginLeft, currentY, data, 'injury');

  // === 既往歴 ===
  currentY = drawMedicalHistory(page, font, marginLeft, currentY, contentWidth, data, { withPastInjury: true });

  // === 来院きっかけ ===
  currentY = drawReferral(page, font, marginLeft, currentY, data);

  // === 施術者記入欄 ===
  drawMemoSection(page, font, marginLeft, currentY, contentWidth);

  return pdfDoc.save();
}
