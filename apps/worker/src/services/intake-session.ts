/**
 * LINE 問診フロー — 「予約する」で起動するマルチステップ会話ハンドラ
 *
 * 会話の流れ:
 *   "予約する" → セッション種別選択 → 各種質問 → PDF 生成・院通知
 */
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { generateAndNotifyPdf } from './intake-pdf.js';
import { jstNow } from '@line-crm/db';

export type SessionType = 'injury' | 'chronic' | 'beauty' | 'beauty_medicell';

interface IntakeSession {
  id: string;
  line_user_id: string;
  session_type: string;
  current_step: number;
  answers: string;
  status: string;
  cancel_reason: string | null;
}

// ===================================================================
// ステップ定義
// ===================================================================

interface StepDef {
  key: string;
  question: string;
  quickReplies?: string[];
  /** 前の回答に基づいてこのステップをスキップするか判定 */
  skip?: (answers: Record<string, string>) => boolean;
  /** 回答が不正な場合のメッセージ（quickReplies のいずれかに一致しない場合） */
  validationMsg?: string;
}

// 共通ステップ（全種別）: step 1-5
const COMMON_STEPS: StepDef[] = [
  {
    key: 'name',
    question: 'お名前をフルネームでお教えください（例: 田中 太郎）',
  },
  {
    key: 'furigana',
    question: 'ふりがなをお教えください（例: たなか たろう）',
  },
  {
    key: 'birthday',
    question: '生年月日を教えてください（例: 1985/3/20 または 1985年3月20日）',
  },
  {
    key: 'phone',
    question: '電話番号をお教えください（例: 090-1234-5678）',
  },
  {
    key: 'address',
    question: 'ご住所をお教えください（市区町村以降、例: 長野県諏訪郡原村）',
  },
];

const INJURY_STEPS: StepDef[] = [
  { key: 'job', question: 'ご職業をお教えください' },
  {
    key: 'gender',
    question: '性別をお選びください',
    quickReplies: ['男性', '女性'],
    validationMsg: '「男性」または「女性」を選んでください',
  },
  { key: 'pain_location', question: 'どこが痛みますか？（例: 右足首の外側）' },
  { key: 'injury_when', question: 'いつから症状がありますか？（例: 昨日、3日前、1ヶ月前）' },
  { key: 'injury_where', question: 'どこにいましたか？（例: スポーツ中、職場、自宅）' },
  { key: 'injury_how', question: 'どのようなことが原因ですか？（例: サッカー中に転倒）' },
  {
    key: 'pain_level',
    question: '痛みの程度を10段階で教えてください（1〜2が弱い、9〜10が強い）',
    quickReplies: ['1〜2', '3〜4', '5〜6', '7〜8', '9〜10'],
    validationMsg: 'いずれかの選択肢を選んでください',
  },
  { key: 'current_state', question: '現在の状態をお聞かせください（例: 腫れている、熱感がある）' },
  {
    key: 'other_clinic',
    question: '他の病院・整骨院などに通っていますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'other_clinic_name',
    question: 'どちらに通っていますか？（病院名）',
    skip: (a) => a.other_clinic !== 'はい',
  },
  {
    key: 'other_clinic_since',
    question: 'いつから通っていますか？（例: 2週間前から）',
    skip: (a) => a.other_clinic !== 'はい',
  },
  {
    key: 'current_illness',
    question: '現在治療中の病気はありますか？',
    quickReplies: ['ある', 'ない'],
    validationMsg: '「ある」または「ない」で答えてください',
  },
  {
    key: 'current_illness_detail',
    question: '治療中の病気の内容を教えてください',
    skip: (a) => a.current_illness !== 'ある',
  },
  {
    key: 'current_medicine',
    question: '現在内服中のお薬はありますか？',
    quickReplies: ['ある', 'ない'],
    validationMsg: '「ある」または「ない」で答えてください',
  },
  {
    key: 'current_medicine_detail',
    question: 'お薬の名前を教えてください',
    skip: (a) => a.current_medicine !== 'ある',
  },
  {
    key: 'referral',
    question: 'ご来院のきっかけを教えてください',
    quickReplies: ['Googleマップ', '友人の紹介', 'SNS', 'その他'],
  },
  { key: 'datetime1', question: 'ご希望の来院日時①を教えてください（例: 4/20 14時）' },
  { key: 'datetime2', question: 'ご希望の来院日時②を教えてください（ない場合は「なし」と入力）' },
  { key: 'datetime3', question: 'ご希望の来院日時③を教えてください（ない場合は「なし」と入力）' },
];

const CHRONIC_STEPS: StepDef[] = [
  { key: 'job', question: 'ご職業をお教えください' },
  {
    key: 'gender',
    question: '性別をお選びください',
    quickReplies: ['男性', '女性'],
    validationMsg: '「男性」または「女性」を選んでください',
  },
  { key: 'symptoms', question: 'どのような症状がありますか？（例: 肩こりがひどく、頭痛もある）' },
  { key: 'duration', question: '症状はいつからですか？（例: 3ヶ月以上前から）' },
  { key: 'worse_time', question: '症状が悪化するのはどんな時ですか？（例: デスクワーク後）' },
  { key: 'current_status', question: '現在の症状の状態を教えてください（例: 良くなったり悪くなったり）' },
  {
    key: 'severity',
    question: 'つらさの程度を10段階で教えてください（1〜2が弱い、9〜10が強い）',
    quickReplies: ['1〜2', '3〜4', '5〜6', '7〜8', '9〜10'],
    validationMsg: 'いずれかの選択肢を選んでください',
  },
  { key: 'preferred_treatment', question: 'ご希望の施術があればお聞かせください（なければ「特になし」と入力）' },
  {
    key: 'other_clinic',
    question: '他の病院・整骨院などに通っていますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'other_clinic_name',
    question: 'どちらに通っていますか？（病院名）',
    skip: (a) => a.other_clinic !== 'はい',
  },
  {
    key: 'other_clinic_since',
    question: 'いつから通っていますか？（例: 半年前から）',
    skip: (a) => a.other_clinic !== 'はい',
  },
  {
    key: 'current_illness',
    question: '現在治療中の病気はありますか？',
    quickReplies: ['ある', 'ない'],
    validationMsg: '「ある」または「ない」で答えてください',
  },
  {
    key: 'current_illness_detail',
    question: '治療中の病気の内容を教えてください',
    skip: (a) => a.current_illness !== 'ある',
  },
  {
    key: 'current_medicine',
    question: '現在内服中のお薬はありますか？',
    quickReplies: ['ある', 'ない'],
    validationMsg: '「ある」または「ない」で答えてください',
  },
  {
    key: 'current_medicine_detail',
    question: 'お薬の名前を教えてください',
    skip: (a) => a.current_medicine !== 'ある',
  },
  {
    key: 'referral',
    question: 'ご来院のきっかけを教えてください',
    quickReplies: ['Googleマップ', '友人の紹介', 'SNS', 'その他'],
  },
  { key: 'datetime1', question: 'ご希望の来院日時①を教えてください（例: 4/20 14時）' },
  { key: 'datetime2', question: 'ご希望の来院日時②を教えてください（ない場合は「なし」と入力）' },
  { key: 'datetime3', question: 'ご希望の来院日時③を教えてください（ない場合は「なし」と入力）' },
];

const BEAUTY_STEPS: StepDef[] = [
  { key: 'menu', question: 'ご希望のメニューを教えてください（例: 美容鍼、コース名）' },
  {
    key: 'past_beauty',
    question: '美容鍼を受けたことはありますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'alcohol_skin',
    question: 'アルコール消毒で肌が赤くなりますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'facial_palsy',
    question: '顔面麻痺の既往がありますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'blood_thinner',
    question: '血液をサラサラにする薬を服用していますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'pregnancy',
    question: '現在妊娠中ですか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'pacemaker',
    question: 'ペースメーカーを使用していますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  { key: 'face_concerns', question: 'お顔で気になることをお聞かせください（例: ほうれい線、目の下のたるみ）' },
  { key: 'top3_concerns', question: '特に気になる点を3つまで教えてください（例: ほうれい線、たるみ、ハリ）' },
  {
    key: 'event',
    question: '近日中にイベント（結婚式・撮影など）の予定はありますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'event_detail',
    question: 'イベントの詳細を教えてください（例: 来月 友人の結婚式）',
    skip: (a) => a.event !== 'はい',
  },
  { key: 'other_notes', question: 'その他ご質問・ご要望があればお聞かせください（なければ「特になし」と入力）' },
  { key: 'datetime1', question: 'ご希望の来院日時①を教えてください（例: 4/20 14時）' },
  { key: 'datetime2', question: 'ご希望の来院日時②を教えてください（ない場合は「なし」と入力）' },
  { key: 'datetime3', question: 'ご希望の来院日時③を教えてください（ない場合は「なし」と入力）' },
];

const BEAUTY_MEDICELL_STEPS: StepDef[] = [
  {
    key: 'pregnancy',
    question: '現在妊娠中ですか？（妊娠中の方は施術をお受けいただけません）',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'pacemaker',
    question: 'ペースメーカーを使用していますか？（使用中の方は施術をお受けいただけません）',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'skin_condition',
    question: '施術部位に皮膚疾患（湿疹・炎症など）はありますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'current_illness',
    question: '現在治療中の病気はありますか？',
    quickReplies: ['ある', 'ない'],
    validationMsg: '「ある」または「ない」で答えてください',
  },
  {
    key: 'current_illness_detail',
    question: '治療中の病気の内容を教えてください',
    skip: (a) => a.current_illness !== 'ある',
  },
  { key: 'symptoms', question: 'お悩みの症状を教えてください（例: 肩こりがひどい）' },
  { key: 'duration', question: '症状はいつからですか？（例: 1年以上前から）' },
  { key: 'worse_time', question: '症状が悪化するのはどんな時ですか？（例: デスクワーク後）' },
  {
    key: 'severity',
    question: 'つらさの程度を10段階で教えてください（1〜2が弱い、9〜10が強い）',
    quickReplies: ['1〜2', '3〜4', '5〜6', '7〜8', '9〜10'],
    validationMsg: 'いずれかの選択肢を選んでください',
  },
  {
    key: 'past_medicell',
    question: 'メディセルを受けたことがありますか？',
    quickReplies: ['はい', 'いいえ'],
    validationMsg: '「はい」または「いいえ」で答えてください',
  },
  {
    key: 'treatment_area',
    question: 'ご希望の施術範囲を教えてください',
    quickReplies: ['全身', '上半身', '下半身', '部分のみ'],
    validationMsg: 'いずれかの選択肢を選んでください',
  },
  { key: 'other_notes', question: 'その他ご質問・ご要望があればお聞かせください（なければ「特になし」と入力）' },
  { key: 'datetime1', question: 'ご希望の来院日時①を教えてください（例: 4/20 14時）' },
  { key: 'datetime2', question: 'ご希望の来院日時②を教えてください（ない場合は「なし」と入力）' },
  { key: 'datetime3', question: 'ご希望の来院日時③を教えてください（ない場合は「なし」と入力）' },
];

function getTypeSteps(sessionType: SessionType): StepDef[] {
  const map: Record<SessionType, StepDef[]> = {
    injury: INJURY_STEPS,
    chronic: CHRONIC_STEPS,
    beauty: BEAUTY_STEPS,
    beauty_medicell: BEAUTY_MEDICELL_STEPS,
  };
  return map[sessionType] ?? [];
}

function getTypeLabel(sessionType: SessionType): string {
  const labels: Record<SessionType, string> = {
    injury: '交通事故・ケガ（急性症状）',
    chronic: '肩こり・腰痛など（慢性症状）',
    beauty: '美容鍼',
    beauty_medicell: '美療メディセル',
  };
  return labels[sessionType] ?? sessionType;
}

// ===================================================================
// クイックリプライビルダー
// ===================================================================

function buildQuickReply(items: string[]): object {
  return {
    items: items.map((label) => ({
      type: 'action',
      action: { type: 'message', label, text: label },
    })),
  };
}

// ===================================================================
// DB helpers（@line-crm/db に関数が追加されるまでインライン）
// ===================================================================

async function getActiveIntakeSession(db: D1Database, lineUserId: string): Promise<IntakeSession | null> {
  return db
    .prepare(`SELECT * FROM intake_sessions WHERE line_user_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`)
    .bind(lineUserId)
    .first<IntakeSession>();
}

async function createIntakeSession(db: D1Database, lineUserId: string, sessionType: SessionType): Promise<IntakeSession> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO intake_sessions (id, line_user_id, session_type, current_step, answers, status, created_at, updated_at)
       VALUES (?, ?, ?, 0, '{}', 'in_progress', ?, ?)`,
    )
    .bind(id, lineUserId, sessionType, now, now)
    .run();
  return (await db.prepare(`SELECT * FROM intake_sessions WHERE id = ?`).bind(id).first<IntakeSession>())!;
}

async function updateIntakeSession(
  db: D1Database,
  id: string,
  updates: { current_step?: number; answers?: string; status?: string; cancel_reason?: string },
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.current_step !== undefined) { fields.push('current_step = ?'); values.push(updates.current_step); }
  if (updates.answers !== undefined) { fields.push('answers = ?'); values.push(updates.answers); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.cancel_reason !== undefined) { fields.push('cancel_reason = ?'); values.push(updates.cancel_reason); }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db.prepare(`UPDATE intake_sessions SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
}

// ===================================================================
// メインハンドラ
// ===================================================================

/**
 * LINE 問診フローのメッセージハンドラ。
 * - "予約する" を受け取ったとき、またはアクティブなセッションがあるとき呼び出す。
 * - メッセージを消費した場合は true を返す。
 * - 関係ないメッセージだった場合は false を返す（auto-reply に委ねる）。
 */
export async function handleIntakeMessage(
  db: D1Database,
  lineClient: InstanceType<typeof LineClient>,
  replyToken: string,
  lineUserId: string,
  incomingText: string,
  env: {
    LINE_CHANNEL_ACCESS_TOKEN: string;
    PDF_BUCKET?: R2Bucket;
    WORKER_URL?: string;
    CLINIC_LINE_USER_ID?: string;
  },
): Promise<boolean> {
  const activeSession = await getActiveIntakeSession(db, lineUserId);

  // セッションがなく "予約する" でもない → 消費しない
  if (!activeSession && incomingText !== '予約する') {
    return false;
  }

  // "予約する" で既存セッションがない → 種別選択へ
  if (!activeSession && incomingText === '予約する') {
    try {
      await lineClient.replyMessage(replyToken, [
        {
          type: 'text',
          text: 'ご予約をお受けします。\nどのようなご用件でしょうか？',
          quickReply: buildQuickReply([
            '交通事故・ケガ',
            '肩こり・腰痛など',
            '美容鍼',
            '美療メディセル',
          ]),
        } as unknown as Message,
      ]);
    } catch (err) {
      console.error('handleIntakeMessage: failed to send type selection', err);
    }
    // セッションは種別確定後に作成する（この時点では step -1 扱い）
    // step -1 を表すために special レコードを作成する必要があるが、
    // ここでは "type_pending" という仮セッションを作る
    const id = crypto.randomUUID();
    const now = jstNow();
    await db
      .prepare(
        `INSERT INTO intake_sessions (id, line_user_id, session_type, current_step, answers, status, created_at, updated_at)
         VALUES (?, ?, 'pending', -1, '{}', 'in_progress', ?, ?)`,
      )
      .bind(id, lineUserId, now, now)
      .run();
    return true;
  }

  // アクティブセッションあり → ステップ処理
  if (activeSession) {
    // "キャンセル" は任意のステップで受け付ける
    if (incomingText === 'キャンセル' || incomingText === 'cancel') {
      await updateIntakeSession(db, activeSession.id, { status: 'cancelled', cancel_reason: 'ユーザーによるキャンセル' });
      try {
        await lineClient.replyMessage(replyToken, [
          { type: 'text', text: 'ご予約のご入力をキャンセルしました。\nまたいつでもご利用ください。' },
        ]);
      } catch (err) {
        console.error('handleIntakeMessage: cancel reply failed', err);
      }
      return true;
    }

    const step = activeSession.current_step;
    const sessionType = activeSession.session_type as SessionType | 'pending';

    // step -1: 種別待ち
    if (step === -1 || sessionType === 'pending') {
      const typeMap: Record<string, SessionType> = {
        '交通事故・ケガ': 'injury',
        '肩こり・腰痛など': 'chronic',
        '美容鍼': 'beauty',
        '美療メディセル': 'beauty_medicell',
      };
      const chosenType = typeMap[incomingText];
      if (!chosenType) {
        // 不正入力 → 再確認
        try {
          await lineClient.replyMessage(replyToken, [
            {
              type: 'text',
              text: 'いずれかをお選びください',
              quickReply: buildQuickReply(['交通事故・ケガ', '肩こり・腰痛など', '美容鍼', '美療メディセル']),
            } as unknown as Message,
          ]);
        } catch { /* ignore */ }
        return true;
      }

      // 種別確定 → session_type を更新して step 0 へ
      await updateIntakeSession(db, activeSession.id, {
        status: 'in_progress',
        current_step: 0,
        answers: JSON.stringify({ session_type_label: getTypeLabel(chosenType) }),
      });
      await db.prepare(`UPDATE intake_sessions SET session_type = ?, updated_at = ? WHERE id = ?`)
        .bind(chosenType, jstNow(), activeSession.id).run();

      // 最初の質問を送信
      const firstStep = getNextStep(chosenType, 0, {});
      if (firstStep) {
        await sendQuestion(lineClient, replyToken, firstStep.def);
      }
      return true;
    }

    // 通常ステップ処理
    const answers = JSON.parse(activeSession.answers || '{}') as Record<string, string>;
    const currentStepDef = getStepAtIndex(sessionType as SessionType, step, answers);

    if (!currentStepDef) {
      // 全ステップ完了（念のため）
      await completeSession(db, activeSession, lineClient, replyToken, env);
      return true;
    }

    // バリデーション（quickReplies がある場合）
    if (currentStepDef.quickReplies && currentStepDef.quickReplies.length > 0) {
      if (!currentStepDef.quickReplies.includes(incomingText)) {
        try {
          await lineClient.replyMessage(replyToken, [
            {
              type: 'text',
              text: currentStepDef.validationMsg ?? 'いずれかをお選びください',
              quickReply: buildQuickReply(currentStepDef.quickReplies),
            } as unknown as Message,
          ]);
        } catch { /* ignore */ }
        return true;
      }
    }

    // 回答を保存
    answers[currentStepDef.key] = incomingText;

    // 禁忌チェック（美療メディセル）
    if ((sessionType === 'beauty_medicell' || sessionType === 'beauty') &&
        (currentStepDef.key === 'pregnancy' || currentStepDef.key === 'pacemaker') &&
        incomingText === 'はい') {
      await updateIntakeSession(db, activeSession.id, {
        status: 'cancelled',
        answers: JSON.stringify(answers),
        cancel_reason: `禁忌項目: ${currentStepDef.key}`,
      });
      try {
        const item = currentStepDef.key === 'pregnancy' ? 'ご妊娠中' : 'ペースメーカーご使用中';
        await lineClient.replyMessage(replyToken, [
          {
            type: 'text',
            text: `申し訳ございません。${item}の方は施術をお受けいただくことができません。\nご不明な点はお電話にてお問い合わせください。`,
          },
        ]);
      } catch { /* ignore */ }
      return true;
    }

    // 次のステップを計算
    const nextStepIndex = step + 1;
    const nextStep = getNextStep(sessionType as SessionType, nextStepIndex, answers);

    if (!nextStep) {
      // 全ステップ完了
      await updateIntakeSession(db, activeSession.id, {
        current_step: nextStepIndex,
        answers: JSON.stringify(answers),
      });
      await completeSession(db, { ...activeSession, answers: JSON.stringify(answers) }, lineClient, replyToken, env);
    } else {
      // 次の質問へ
      await updateIntakeSession(db, activeSession.id, {
        current_step: nextStep.index,
        answers: JSON.stringify(answers),
      });
      await sendQuestion(lineClient, replyToken, nextStep.def);
    }

    return true;
  }

  return false;
}

/** allSteps の中から現在 step に対応する定義を取得 */
function getStepAtIndex(
  sessionType: SessionType,
  stepIndex: number,
  answers: Record<string, string>,
): StepDef | null {
  const allSteps = [...COMMON_STEPS, ...getTypeSteps(sessionType)];

  let idx = 0;
  for (const def of allSteps) {
    if (def.skip?.(answers)) continue;
    if (idx === stepIndex) return def;
    idx++;
  }
  return null;
}

/** 次に送るべきステップを返す（スキップを考慮した実ステップインデックスも返す） */
function getNextStep(
  sessionType: SessionType,
  fromIndex: number,
  answers: Record<string, string>,
): { def: StepDef; index: number } | null {
  const allSteps = [...COMMON_STEPS, ...getTypeSteps(sessionType)];

  let idx = 0;
  for (const def of allSteps) {
    if (def.skip?.(answers)) continue;
    if (idx >= fromIndex) return { def, index: idx };
    idx++;
  }
  return null;
}

/** 質問メッセージを送信 */
async function sendQuestion(
  lineClient: InstanceType<typeof LineClient>,
  replyToken: string,
  step: StepDef,
): Promise<void> {
  const msg = step.quickReplies && step.quickReplies.length > 0
    ? { type: 'text', text: step.question, quickReply: buildQuickReply(step.quickReplies) } as unknown as Message
    : { type: 'text', text: step.question } as Message;
  try {
    await lineClient.replyMessage(replyToken, [msg]);
  } catch (err) {
    console.error('sendQuestion: failed to reply', err);
  }
}

/** 全質問完了 → PDF生成・通知 */
async function completeSession(
  db: D1Database,
  session: IntakeSession,
  lineClient: InstanceType<typeof LineClient>,
  replyToken: string,
  env: {
    LINE_CHANNEL_ACCESS_TOKEN: string;
    PDF_BUCKET?: R2Bucket;
    WORKER_URL?: string;
    CLINIC_LINE_USER_ID?: string;
  },
): Promise<void> {
  await updateIntakeSession(db, session.id, { status: 'completed' });

  // 患者へ完了メッセージ
  const answers = JSON.parse(session.answers || '{}') as Record<string, string>;
  const dt1 = answers.datetime1 ?? '未記入';
  const dt2 = answers.datetime2 && answers.datetime2 !== 'なし' ? `\n② ${answers.datetime2}` : '';
  const dt3 = answers.datetime3 && answers.datetime3 !== 'なし' ? `\n③ ${answers.datetime3}` : '';

  try {
    await lineClient.replyMessage(replyToken, [
      {
        type: 'text',
        text:
          `ご記入ありがとうございました！\n\n` +
          `ご希望日時\n① ${dt1}${dt2}${dt3}\n\n` +
          `スタッフよりご連絡をさしあげます。\nご来院をお待ちしております。`,
      },
    ]);
  } catch (err) {
    console.error('completeSession: reply failed', err);
  }

  // PDF生成・院通知（ベストエフォート）
  if (env.PDF_BUCKET) {
    generateAndNotifyPdf(
      { id: session.id, line_user_id: session.line_user_id, session_type: session.session_type, answers: session.answers },
      {
        PDF_BUCKET: env.PDF_BUCKET,
        LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN,
        WORKER_URL: env.WORKER_URL,
        CLINIC_LINE_USER_ID: env.CLINIC_LINE_USER_ID,
      },
    ).catch((err) => console.error('completeSession: PDF generation failed', err));
  }
}
