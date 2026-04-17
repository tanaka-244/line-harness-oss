import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PAGE_W, PAGE_H, pt, drawText, drawHeader, drawNameRow, drawAddressRow, drawConsentSection, drawOtherClinic, drawMedicalHistory, drawReferral, drawMemoSection, drawBodyFigure, splitLines, } from './base.js';
import { convertToWareki } from '../utils/wareki.js';
import { getZipcodeFromAddress } from '../utils/zipcode.js';
export async function generateChronicPdf(answers, fontBytes, logoBytes, figureBytes) {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes);
    const logoImage = logoBytes ? await pdfDoc.embedJpg(logoBytes) : undefined;
    const figureImage = figureBytes ? await pdfDoc.embedPng(figureBytes) : undefined;
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const marginLeft = pt(15);
    const contentWidth = PAGE_W - pt(15) - pt(15);
    const data = {
        ...answers,
        birthday_wareki: convertToWareki(answers.birthday ?? ''),
        zipcode: answers.zipcode || getZipcodeFromAddress(answers.address ?? ''),
    };
    let currentY = PAGE_H - pt(12);
    // === ヘッダー ===
    currentY = drawHeader(page, font, marginLeft, currentY, '問診票（慢性症状・自費）', logoImage);
    // === 基本情報 ===
    currentY = drawNameRow(page, font, marginLeft, currentY, contentWidth, data, { withGender: true });
    currentY = drawAddressRow(page, font, marginLeft, currentY, contentWidth, data);
    // === 同意確認 ===
    const chronicNotices = [
        '□ 慢性的な症状（肩こり・腰痛など長期間続くもの）は自費施術となります',
        '□ お身体の状態に合わせて最適な施術をご提案いたします',
        '□ 領収書が必要な場合はお申し付けください',
    ];
    currentY = drawConsentSection(page, font, marginLeft, currentY, contentWidth, chronicNotices);
    // === 症状セクション（人体図と並列） ===
    const sectionStartY = currentY;
    // ① 症状の詳細
    drawText(page, '① どのような症状がありますか（右図に該当箇所を○してください）', marginLeft, currentY, font, 11);
    currentY -= pt(6);
    const symptoms = data.symptoms ?? '';
    const textWidth = contentWidth * 0.5 - pt(5);
    const bodyLineGap = pt(5);
    const sympLines = splitLines(symptoms, font, 11, textWidth);
    for (const line of sympLines) {
        drawText(page, line, marginLeft + pt(5), currentY, font, 11);
        currentY -= bodyLineGap;
    }
    currentY -= pt(3);
    // ② 症状の期間
    drawText(page, '② 症状はいつからですか', marginLeft, currentY, font, 11);
    currentY -= pt(6);
    const durationLines = splitLines(data.duration ?? '', font, 11, textWidth);
    for (const line of durationLines) {
        drawText(page, line, marginLeft + pt(5), currentY, font, 11);
        currentY -= bodyLineGap;
    }
    currentY -= pt(3);
    // ③ 悪化する時
    drawText(page, '③ 症状が悪化するのはどんな時ですか', marginLeft, currentY, font, 11);
    currentY -= pt(6);
    const worseTimeLines = splitLines(data.worse_time ?? '', font, 11, textWidth);
    for (const line of worseTimeLines) {
        drawText(page, line, marginLeft + pt(5), currentY, font, 11);
        currentY -= bodyLineGap;
    }
    currentY -= pt(3);
    // ④ 症状の状態と程度
    drawText(page, '④ 症状の状態と程度', marginLeft, currentY, font, 11);
    currentY -= pt(6);
    const statusLines = splitLines(`現在の状態: ${data.current_status ?? ''}`, font, 11, textWidth);
    for (const line of statusLines) {
        drawText(page, line, marginLeft + pt(5), currentY, font, 11);
        currentY -= bodyLineGap;
    }
    const severityLines = splitLines(`つらさの程度: ${data.severity ?? ''}`, font, 11, textWidth);
    for (const line of severityLines) {
        drawText(page, line, marginLeft + pt(5), currentY, font, 11);
        currentY -= bodyLineGap;
    }
    currentY -= pt(3);
    // ⑤ 希望する施術
    drawText(page, '⑤ 希望する施術があればお聞かせください', marginLeft, currentY, font, 11);
    currentY -= pt(6);
    const preferredTreatmentLines = splitLines(data.preferred_treatment ?? '', font, 11, textWidth);
    for (const line of preferredTreatmentLines) {
        drawText(page, line, marginLeft + pt(5), currentY, font, 11);
        currentY -= bodyLineGap;
    }
    // 人体図（右側）
    drawBodyFigure(page, figureImage, marginLeft, sectionStartY, contentWidth, 92);
    currentY -= pt(5);
    // === 他院受診歴 ===
    currentY = drawOtherClinic(page, font, marginLeft, currentY, data, 'chronic');
    // === 既往歴 ===
    currentY = drawMedicalHistory(page, font, marginLeft, currentY, contentWidth, data);
    // === 来院きっかけ ===
    currentY = drawReferral(page, font, marginLeft, currentY, data);
    // === 施術者記入欄 ===
    drawMemoSection(page, font, marginLeft, currentY, contentWidth);
    return pdfDoc.save();
}
