import { generatePdf, getSessionTypeLabel, type SessionType } from '../pdf/generator.js';
import { savePdf } from '../r2/storage.js';
import { LineClient } from '@line-crm/line-sdk';

interface IntakeSession {
  id: string;
  line_user_id: string;
  session_type: string;
  answers: string; // JSON
}

const PDF_TEMPLATE_KEYS: Record<SessionType, string[]> = {
  injury: [
    'furigana',
    'name',
    'birthday',
    'job',
    'gender',
    'address',
    'phone',
    'pain_location',
    'injury_when',
    'injury_where',
    'injury_how',
    'pain_level',
    'current_state',
    'other_clinic',
    'other_clinic_name',
    'other_clinic_since',
    'current_illness',
    'current_illness_detail',
    'current_medicine',
    'current_medicine_detail',
    'referral',
    'datetime1',
    'datetime2',
    'datetime3',
    'consent',
  ],
  chronic: [
    'furigana',
    'name',
    'birthday',
    'job',
    'gender',
    'address',
    'phone',
    'symptoms',
    'duration',
    'current_status',
    'severity',
    'preferred_treatment',
    'other_clinic',
    'other_clinic_name',
    'other_clinic_since',
    'current_illness',
    'current_illness_detail',
    'current_medicine',
    'current_medicine_detail',
    'referral',
    'datetime1',
    'datetime2',
    'datetime3',
    'consent',
  ],
  beauty: [
    'furigana',
    'name',
    'birthday',
    'address',
    'phone',
    'menu',
    'past_beauty',
    'past_bleeding',
    'alcohol_skin',
    'facial_palsy',
    'blood_thinner',
    'pregnancy',
    'pacemaker',
    'face_concerns',
    'top3_concerns',
    'event',
    'event_detail',
    'other_notes',
    'datetime1',
    'datetime2',
    'datetime3',
    'consent',
  ],
  beauty_medicell: [
    'furigana',
    'name',
    'birthday',
    'address',
    'phone',
    'menu',
    'pregnancy',
    'pacemaker',
    'skin_condition',
    'current_illness',
    'current_illness_detail',
    'symptoms',
    'symptoms_other',
    'duration',
    'worse_time',
    'severity',
    'past_medicell',
    'treatment_area',
    'other_notes',
    'datetime1',
    'datetime2',
    'datetime3',
    'consent',
  ],
};

/**
 * 問診完了時にPDFを生成してR2に保存し、院へLINE通知する
 *
 * 使用例（webhook.ts の問診完了ハンドラ内）:
 *   if (session.status === 'completed') {
 *     await generateAndNotifyPdf(session, env).catch(console.error);
 *   }
 */
export async function generateAndNotifyPdf(
  session: IntakeSession,
  env: {
    PDF_BUCKET: R2Bucket;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    WORKER_URL?: string;
    CLINIC_LINE_USER_ID?: string;
  },
): Promise<void> {
  const clinicUserId = env.CLINIC_LINE_USER_ID;
  if (!clinicUserId) {
    console.warn('CLINIC_LINE_USER_ID not set; skipping LINE notification');
    return;
  }

  const sessionType = session.session_type as SessionType;

  let answers: Record<string, string>;
  try {
    answers = JSON.parse(session.answers) as Record<string, string>;
  } catch {
    console.error(`Failed to parse answers for session ${session.id}`);
    return;
  }

  const templateKeys = PDF_TEMPLATE_KEYS[sessionType] ?? [];
  const answerKeys = Object.keys(answers);
  const missingTemplateKeys = templateKeys.filter((key) => !(key in answers));
  const extraAnswerKeys = answerKeys.filter((key) => !templateKeys.includes(key));

  console.error('Intake PDF mapping snapshot', {
    sessionId: session.id,
    sessionType,
    answerKeys,
    templateKeys,
    missingTemplateKeys,
    extraAnswerKeys,
  });

  const label = getSessionTypeLabel(sessionType);
  const name = answers.name ?? '（不明）';
  const phone = answers.phone ?? '（未記入）';
  const dt1 = answers.datetime1 ?? '未記入';
  const dt2 = answers.datetime2 ?? '';
  const dt3 = answers.datetime3 ?? '';

  const datetimeLines = [
    `  ① ${dt1}`,
    dt2 && dt2 !== 'なし' ? `  ② ${dt2}` : '',
    dt3 && dt3 !== 'なし' ? `  ③ ${dt3}` : '',
  ].filter(Boolean).join('\n');

  // PDF生成（失敗しても通知は送る）
  let pdfUrl = '';
  try {
    const pdfBytes = await generatePdf(sessionType, answers, env.PDF_BUCKET);
    const key = await savePdf(env.PDF_BUCKET, session.id, sessionType, pdfBytes);
    const workerUrl = env.WORKER_URL ?? '';
    pdfUrl = `${workerUrl}/pdf/${key.replace(/^pdf\//, '')}`;
  } catch (err) {
    console.error(`PDF generation failed for session ${session.id}:`, err);
  }

  const text =
    `【新規予約リクエスト】${label}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `■ 氏名: ${name}\n` +
    `■ 電話: ${phone}\n` +
    `■ 希望日時:\n${datetimeLines}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    (pdfUrl ? `📄 問診票PDF:\n${pdfUrl}` : '⚠️ PDF生成に失敗しました。管理画面でご確認ください。');

  const lineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  await lineClient.pushMessage(clinicUserId, [{ type: 'text', text }]);
}
