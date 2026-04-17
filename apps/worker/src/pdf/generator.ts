import { generateInjuryPdf } from './templates/injury.js';
import { generateChronicPdf } from './templates/chronic.js';
import { generateBeautyPdf } from './templates/beauty.js';
import { generateMedicellPdf } from './templates/medicell.js';

export type SessionType = 'injury' | 'chronic' | 'beauty' | 'beauty_medicell';

/**
 * R2からフォント・画像バイト列を取得する
 */
async function loadAssets(pdfBucket: R2Bucket): Promise<{
  fontBytes: ArrayBuffer;
  logoBytes: ArrayBuffer | null;
  figureBytes: ArrayBuffer | null;
}> {
  const [fontObj, logoObj, figureObj] = await Promise.all([
    pdfBucket.get('fonts/NotoSansJP-Regular.ttf'),
    pdfBucket.get('images/logo.jpg'),
    pdfBucket.get('images/body_figure.png'),
  ]);

  if (!fontObj) {
    throw new Error(
      'Font not found in R2. Upload NotoSansJP-Regular.ttf to PDF_BUCKET at fonts/NotoSansJP-Regular.ttf',
    );
  }

  const [fontBytes, logoBytes, figureBytes] = await Promise.all([
    fontObj.arrayBuffer(),
    logoObj ? logoObj.arrayBuffer() : Promise.resolve(null),
    figureObj ? figureObj.arrayBuffer() : Promise.resolve(null),
  ]);

  return { fontBytes, logoBytes, figureBytes };
}

/**
 * セッションタイプに応じたPDFを生成する
 * フォント・画像はR2から取得し、各テンプレート関数に渡す
 */
export async function generatePdf(
  sessionType: SessionType,
  answers: Record<string, string>,
  pdfBucket: R2Bucket,
): Promise<Uint8Array> {
  const { fontBytes, logoBytes, figureBytes } = await loadAssets(pdfBucket);

  switch (sessionType) {
    case 'injury':
      return generateInjuryPdf(answers, fontBytes, logoBytes, figureBytes);
    case 'chronic':
      return generateChronicPdf(answers, fontBytes, logoBytes, figureBytes);
    case 'beauty':
      return generateBeautyPdf(answers, fontBytes, logoBytes);
    case 'beauty_medicell':
      return generateMedicellPdf(answers, fontBytes, logoBytes, figureBytes);
    default:
      throw new Error(`Unknown session type: ${sessionType}`);
  }
}

export function getSessionTypeLabel(sessionType: SessionType): string {
  const labels: Record<SessionType, string> = {
    injury: 'ケガ・急性症状',
    chronic: '慢性症状・自費',
    beauty: '美容鍼',
    beauty_medicell: '美療メディセル',
  };
  return labels[sessionType] ?? sessionType;
}
