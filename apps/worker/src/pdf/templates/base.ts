import { PDFPage, PDFFont, PDFImage, rgb } from 'pdf-lib';

// A4サイズ (points)
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

// mm → points 変換
export const pt = (mm: number) => mm * 2.8346;

// 共通色
export const BLACK = rgb(0, 0, 0);

// ---------------------- 共通描画ヘルパー ----------------------

/** 外枠付き矩形（fill なし） */
export function drawRect(
  page: PDFPage,
  x: number, y: number,
  w: number, h: number,
  lineWidth = 0.8,
) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: lineWidth });
}

/** 水平線 */
export function drawHLine(
  page: PDFPage,
  x1: number, x2: number, y: number,
  thickness = 0.3,
) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color: BLACK });
}

/** 垂直線 */
export function drawVLine(
  page: PDFPage,
  x: number, y1: number, y2: number,
  thickness = 0.3,
) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color: BLACK });
}

/** テキスト描画（baseline基準） */
export function drawText(
  page: PDFPage,
  text: string,
  x: number, y: number,
  font: PDFFont, size: number,
) {
  if (!text) return;
  page.drawText(text, { x, y, font, size, color: BLACK });
}

/** 右寄せテキスト */
export function drawTextRight(
  page: PDFPage,
  text: string,
  rightX: number, y: number,
  font: PDFFont, size: number,
) {
  if (!text) return;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, font, size, color: BLACK });
}

/** 中央寄せテキスト */
export function drawTextCenter(
  page: PDFPage,
  text: string,
  centerX: number, y: number,
  font: PDFFont, size: number,
) {
  if (!text) return;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, font, size, color: BLACK });
}

/**
 * テキストを最大幅に収まるよう行分割する
 * 日本語1文字ずつチェックして折り返し
 */
export function splitLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [];
  const lines: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) {
      lines.push('');
      continue;
    }

    if (font.widthOfTextAtSize(rawLine, size) <= maxWidth) {
      lines.push(rawLine);
      continue;
    }

    let cur = '';
    for (const ch of rawLine) {
      const candidate = cur + ch;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
        if (cur) lines.push(cur);
        cur = ch;
      } else {
        cur = candidate;
      }
    }
    if (cur) {
      lines.push(cur);
    }
  }

  return lines;
}

/** 今日の日付を「YYYY年M月D日」形式で返す */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---------------------- 共通ブロック描画 ----------------------

/**
 * 基本情報行1: 氏名/ふりがな | 生年月日/職業 | 性別（ケガ・慢性用）
 * @returns 次のy座標（row_height分下がった後）
 */
export function drawNameRow(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  contentWidth: number,
  data: Record<string, string>,
  opts: { withGender: boolean; nameCellWidth?: number },
): number {
  const rowH = pt(18);
  const nameCellW = opts.nameCellWidth ?? pt(75);
  const middleCellW = pt(80);
  const genderCellW = contentWidth - nameCellW - middleCellW;

  // 氏名セル
  drawRect(page, marginLeft, currentY - rowH, nameCellW, rowH);
  drawHLine(page, marginLeft, marginLeft + nameCellW, currentY - pt(7));
  drawVLine(page, marginLeft + pt(22), currentY, currentY - rowH);

  drawText(page, 'ふりがな', marginLeft + pt(2), currentY - pt(5), font, 10);
  drawText(page, '氏名', marginLeft + pt(2), currentY - pt(14), font, 11);
  drawText(page, data.furigana ?? '', marginLeft + pt(25), currentY - pt(5), font, 10);
  drawText(page, data.name ?? '', marginLeft + pt(25), currentY - pt(14), font, 11);

  // 生年月日/職業セル
  drawRect(page, marginLeft + nameCellW, currentY - rowH, middleCellW, rowH);
  drawHLine(page, marginLeft + nameCellW, marginLeft + nameCellW + middleCellW, currentY - pt(9));

  drawText(page, '生年月日', marginLeft + nameCellW + pt(2), currentY - pt(6), font, 11);
  drawText(page, '職業', marginLeft + nameCellW + pt(2), currentY - pt(15), font, 11);
  drawText(page, data.birthday_wareki ?? '', marginLeft + nameCellW + pt(28), currentY - pt(6), font, 11);
  drawText(page, data.job ?? '', marginLeft + nameCellW + pt(15), currentY - pt(15), font, 11);

  // 性別セル
  if (opts.withGender) {
    drawRect(page, marginLeft + nameCellW + middleCellW, currentY - rowH, genderCellW, rowH);
    const gx = marginLeft + nameCellW + middleCellW + pt(2);
    drawText(page, '性別', gx, currentY - pt(10), font, 11);
    const gender = data.gender ?? '';
    const gval = gender === '男性' ? '男' : gender === '女性' ? '女' : '';
    drawText(page, gval, gx + pt(13), currentY - pt(10), font, 11);
  }

  return currentY - rowH;
}

/**
 * 基本情報行1（美容系用）: 氏名/ふりがな | 生年月日（性別・職業なし）
 * @returns 次のy座標
 */
export function drawNameRowBeauty(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  contentWidth: number,
  data: Record<string, string>,
): number {
  const rowH = pt(18);
  const nameCellW = contentWidth * 0.5;
  const birthdayCellW = contentWidth * 0.5;

  drawRect(page, marginLeft, currentY - rowH, nameCellW, rowH);
  drawHLine(page, marginLeft, marginLeft + nameCellW, currentY - pt(7));
  drawVLine(page, marginLeft + pt(22), currentY, currentY - rowH);

  drawText(page, 'ふりがな', marginLeft + pt(2), currentY - pt(5), font, 10);
  drawText(page, '氏名', marginLeft + pt(2), currentY - pt(14), font, 11);
  drawText(page, data.furigana ?? '', marginLeft + pt(25), currentY - pt(5), font, 10);
  drawText(page, data.name ?? '', marginLeft + pt(25), currentY - pt(14), font, 11);

  drawRect(page, marginLeft + nameCellW, currentY - rowH, birthdayCellW, rowH);
  drawText(page, '生年月日', marginLeft + nameCellW + pt(2), currentY - pt(10), font, 11);
  drawText(page, data.birthday_wareki ?? '', marginLeft + nameCellW + pt(28), currentY - pt(10), font, 11);

  return currentY - rowH;
}

/**
 * 基本情報行2: 住所 | 電話番号
 * @returns 次のy座標（row_height + 5mm下がった後）
 */
export function drawAddressRow(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  contentWidth: number,
  data: Record<string, string>,
): number {
  const rowH = pt(15);
  const addrW = contentWidth * 0.7;
  const phoneW = contentWidth * 0.3;

  drawRect(page, marginLeft, currentY - rowH, addrW, rowH);
  drawRect(page, marginLeft + addrW, currentY - rowH, phoneW, rowH);
  drawVLine(page, marginLeft + pt(22), currentY, currentY - rowH);

  const zipcode = data.zipcode ?? '';
  const rawAddress = data.address ?? '';
  const normalizedAddress = rawAddress.replace(/^\s*〒?\d{3}-?\d{4}\s*/, '');
  const addressLines = splitLines(normalizedAddress, font, 10, addrW - pt(28)).slice(0, 2);

  drawText(page, '住所', marginLeft + pt(2), currentY - pt(9), font, 11);
  drawText(page, zipcode ? `〒${zipcode}` : '', marginLeft + pt(25), currentY - pt(5), font, 10);
  drawText(page, addressLines[0] ?? '', marginLeft + pt(25), currentY - pt(12), font, 10);
  drawText(page, addressLines[1] ?? '', marginLeft + pt(25), currentY - pt(16), font, 10);

  drawText(page, '電話番号', marginLeft + addrW + pt(2), currentY - pt(6), font, 11);
  drawText(page, data.phone ?? '', marginLeft + addrW + pt(2), currentY - pt(12), font, 11);

  return currentY - rowH - pt(5);
}

/**
 * 同意確認セクション（確認事項 + 署名欄）
 * @returns 次のy座標
 */
export function drawConsentSection(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  contentWidth: number,
  notices: string[],
): number {
  drawText(page, '【施術についての確認事項】※以下の内容をご確認の上、署名をお願いいたします。', marginLeft, currentY, font, 11);
  currentY -= pt(5);

  for (const notice of notices) {
    drawText(page, notice, marginLeft, currentY, font, 11);
    currentY -= pt(4.5);
  }
  currentY -= pt(2);

  drawText(page, '上記内容を確認し、同意いたします。', marginLeft, currentY, font, 11);
  currentY -= pt(8);

  const signX = marginLeft + contentWidth * 0.5;
  drawText(page, '署名', signX, currentY, font, 11);
  drawHLine(page, signX + pt(12), signX + pt(80), currentY - pt(1), 0.5);

  return currentY - pt(8);
}

/**
 * 他院受診歴セクション
 * @returns 次のy座標
 */
export function drawOtherClinic(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  data: Record<string, string>,
  mode: 'injury' | 'chronic',
): number {
  drawText(page, '上記症状で他の病院、整形外科、接骨院などにかかりましたか', marginLeft, currentY, font, 11);
  currentY -= pt(6);

  if (data.other_clinic === 'はい') {
    if (mode === 'injury') {
      const clinicName = data.other_clinic_name ?? '';
      const detail = data.other_clinic_diagnosis ?? data.other_clinic_since ?? '';
      const label = data.other_clinic_diagnosis ? '診断名' : data.other_clinic_since ? '通院期間' : '';
      const line = detail
        ? `病院名: ${clinicName}（${label}: ${detail}）`
        : `病院名: ${clinicName}`;
      drawText(page, line, marginLeft + pt(5), currentY, font, 11);
      currentY -= pt(5);
    } else {
      const clinicName = data.other_clinic_name ?? '';
      const since = data.other_clinic_since ?? '';
      const line = since
        ? `病院名: ${clinicName}（通院期間: ${since}）`
        : `病院名: ${clinicName}`;
      drawText(page, line, marginLeft + pt(5), currentY, font, 11);
      currentY -= pt(5);
    }
  }

  return currentY - pt(5);
}

/**
 * 既往歴ボックス
 * @returns 次のy座標
 */
export function drawMedicalHistory(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  contentWidth: number,
  data: Record<string, string>,
  opts?: { withPastInjury?: boolean },
): number {
  drawText(
    page,
    '他に今までにあった病気やアレルギー、ペースメーカー、妊娠中、気になることなどあればご記入ください',
    marginLeft, currentY, font, 10,
  );
  currentY -= pt(3);

  const boxH = pt(18);
  drawRect(page, marginLeft, currentY - boxH, contentWidth, boxH);

  const lines: string[] = [];
  if (data.current_illness === 'ある') {
    lines.push(`治療中の病気: ${data.current_illness_detail ?? ''}`);
  }
  if (data.current_medicine === 'ある') {
    lines.push(`服用中の薬: ${data.current_medicine_detail ?? ''}`);
  }
  if (opts?.withPastInjury && data.past_injury === 'ある') {
    lines.push('過去に同じ場所をケガしたことがある');
  }

  let ly = currentY - pt(6);
  for (const line of lines) {
    const wrapped = splitLines(line, font, 11, contentWidth - pt(6));
    for (const wrappedLine of wrapped) {
      if (ly < currentY - boxH + pt(2)) break;
      drawText(page, wrappedLine, marginLeft + pt(3), ly, font, 11);
      ly -= pt(6);
    }
  }

  return currentY - boxH - pt(5);
}

/**
 * 来院きっかけ（データがある場合のみ表示）
 * @returns 次のy座標
 */
export function drawReferral(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  data: Record<string, string>,
): number {
  const referral = data.referral ?? '';
  if (!referral) return currentY;
  drawText(page, '●ご来院のきっかけ', marginLeft, currentY, font, 11);
  drawText(page, referral, marginLeft + pt(38), currentY, font, 11);
  return currentY - pt(8);
}

/**
 * 施術者記入欄（ページ下まで）
 */
export function drawMemoSection(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  contentWidth: number,
) {
  drawText(page, '【施術者記入欄】', marginLeft, currentY, font, 11);
  currentY -= pt(3);
  const bottomMargin = pt(12);
  const memoH = currentY - bottomMargin;
  if (memoH > 0) {
    drawRect(page, marginLeft, bottomMargin, contentWidth, memoH);
  }
}

/**
 * ヘッダー（ロゴ + タイトル + 日付）
 * @returns 次のy座標
 */
export function drawHeader(
  page: PDFPage,
  font: PDFFont,
  marginLeft: number, currentY: number,
  title: string,
  logoImage?: PDFImage,
): number {
  let headerX = marginLeft;

  if (logoImage) {
    const logoW = pt(18);
    const logoH = pt(18);
    page.drawImage(logoImage, { x: marginLeft, y: currentY - logoH, width: logoW, height: logoH });
    headerX = marginLeft + logoW + pt(3);
  }

  drawText(page, title, headerX, currentY - pt(8), font, 16);
  drawText(page, 'たなか整骨院鍼灸院', headerX, currentY - pt(15), font, 9);
  drawTextRight(page, `記入日: ${todayStr()}`, PAGE_W - pt(15), currentY - pt(8), font, 10);

  return currentY - pt(25);
}

/**
 * 人体図を右側に描画
 */
export function drawBodyFigure(
  page: PDFPage,
  figureImage: PDFImage | undefined,
  marginLeft: number,
  sectionStartY: number,
  contentWidth: number,
  heightMm = 92,
) {
  if (!figureImage) return;
  const figureX = marginLeft + contentWidth * 0.5;
  const figureH = pt(heightMm);
  const figureY = sectionStartY - figureH;
  const figureW = contentWidth * 0.5;
  page.drawImage(figureImage, { x: figureX, y: figureY, width: figureW, height: figureH });
}
