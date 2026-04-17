/**
 * LINE 問診フロー
 *
 * 会話の流れ:
 *   "予約する" / "予約・ご相談"
 *     → 初診 / 再診 / 相談する
 *       → 初診: 問診 + PDF生成 + 院通知
 *       → 再診: 予約内容の聞き取り
 *       → 相談する: 自由記述
 */
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { generateAndNotifyPdf } from './intake-pdf.js';
import { jstNow } from '@line-crm/db';

export type SessionType = 'injury' | 'chronic' | 'beauty' | 'beauty_medicell' | 'revisit' | 'consultation';

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
    question: '生年月日を教えてください（例: 1985年3月20日 または 平成2年1月15日）',
  },
  {
    key: 'phone',
    question: '電話番号をお教えください（例: 090-1234-5678）',
  },
  {
    key: 'address',
    question: 'ご住所をお教えください（例: 諏訪郡原村室内11535-1）',
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
  { key: 'injury_where', question: 'どこでケガをしましたか？（例: スポーツ中、職場、自宅）' },
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

const REVISIT_STEPS: StepDef[] = [
  {
    key: 'revisit_category',
    question: '今回のご予約内容を教えてください',
    quickReplies: ['ケガ・急な痛み', '慢性症状・不調', '美容施術'],
    validationMsg: 'いずれかを選んでください',
  },
  { key: 'name', question: 'お名前または診察券番号をお教えください' },
  { key: 'current_state', question: '現在の症状やご希望をお聞かせください（例: 腰痛が再発、前回より良くなった など）' },
  { key: 'datetime1', question: 'ご希望の来院日時①を教えてください（例: 4/20 14時）' },
  { key: 'datetime2', question: 'ご希望の来院日時②を教えてください（ない場合は「なし」と入力）' },
];

const CONSULTATION_STEPS: StepDef[] = [
  { key: 'consultation_content', question: 'ご相談内容を自由にご記入ください' },
];

function getTypeSteps(sessionType: SessionType): StepDef[] {
  const map: Record<SessionType, StepDef[]> = {
    injury: INJURY_STEPS,
    chronic: CHRONIC_STEPS,
    beauty: BEAUTY_STEPS,
    beauty_medicell: BEAUTY_MEDICELL_STEPS,
    revisit: REVISIT_STEPS,
    consultation: CONSULTATION_STEPS,
  };
  return map[sessionType] ?? [];
}

function getTypeLabel(sessionType: SessionType): string {
  const labels: Record<SessionType, string> = {
    injury: '交通事故・ケガ（急性症状）',
    chronic: '肩こり・腰痛など（慢性症状）',
    beauty: '美容鍼',
    beauty_medicell: '美療メディセル',
    revisit: '再診',
    consultation: 'ご相談',
  };
  return labels[sessionType] ?? sessionType;
}

function getConsentStep(sessionType: SessionType): StepDef | null {
  switch (sessionType) {
    case 'injury':
      return {
        key: 'consent',
        question:
          '最後にご確認をお願いします📝\n\n'
          + '━━━━━━━━━━\n'
          + '・ケガ（捻挫・打撲など）1ヶ月以内の急な症状が保険対象です\n'
          + '・慢性症状（肩こり・腰痛など）は自費施術となります\n'
          + '・通勤中・仕事中のケガは労災、交通事故は自賠責での対応となります\n'
          + '・早期改善のため、自費施術を組み合わせる場合があり、実費がかかることがあります\n'
          + '・領収書が必要な方はお申し付けください\n'
          + '━━━━━━━━━━',
        quickReplies: ['同意する'],
        validationMsg: '内容をご確認のうえ、「同意する」を選択してください',
      };
    case 'chronic':
      return {
        key: 'consent',
        question:
          '最後にご確認をお願いします📝\n\n'
          + '━━━━━━━━━━\n'
          + '・慢性症状（肩こり・腰痛など）は自費施術となります\n'
          + '・症状に合わせて最適な施術をご提案いたします\n'
          + '・領収書が必要な方はお申し付けください\n'
          + '━━━━━━━━━━',
        quickReplies: ['同意する'],
        validationMsg: '内容をご確認のうえ、「同意する」を選択してください',
      };
    case 'beauty':
      return {
        key: 'consent',
        question:
          '最後にご確認をお願いします📝\n\n'
          + '━━━━━━━━━━\n'
          + '・美容施術は自費施術です\n'
          + '・使い捨ての鍼を使用（感染の心配なし）\n'
          + '・効果には個人差があります\n'
          + '・施術時に痛みや内出血が起こる場合があります（数日〜数週間で消えます）\n'
          + '・イベント前の方は事前にお知らせください\n'
          + '・医療行為ではなく、効果を保証するものではありません\n'
          + '━━━━━━━━━━',
        quickReplies: ['同意する'],
        validationMsg: '内容をご確認のうえ、「同意する」を選択してください',
      };
    case 'beauty_medicell':
      return {
        key: 'consent',
        question:
          '最後にご確認をお願いします📝\n\n'
          + '━━━━━━━━━━\n'
          + '・皮膚を吸引して筋膜をほぐし、血液・リンパの流れを促します\n'
          + '・施術後、赤みや内出血が出る場合があります（数日で消えます）\n'
          + '・効果には個人差があります\n'
          + '・ペースメーカー使用中・妊娠中の方は施術できません\n'
          + '・自費施術です\n'
          + '━━━━━━━━━━',
        quickReplies: ['同意する'],
        validationMsg: '内容をご確認のうえ、「同意する」を選択してください',
      };
    default:
      return null;
  }
}

function getAllSteps(sessionType: SessionType): StepDef[] {
  if (sessionType === 'revisit' || sessionType === 'consultation') {
    return getTypeSteps(sessionType);
  }
  const consentStep = getConsentStep(sessionType);
  return consentStep
    ? [...COMMON_STEPS, ...getTypeSteps(sessionType), consentStep]
    : [...COMMON_STEPS, ...getTypeSteps(sessionType)];
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

function buildEntryFlex(): Message {
  return {
    type: 'flex',
    altText: '予約・ご相談 - 初めての方・2回目以降・メッセージで相談するの選択',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '16px',
        contents: [{ type: 'text', text: '予約・ご相談', color: '#FFFFFF', size: 'lg', weight: 'bold' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [{ type: 'text', text: 'ご希望の内容をお選びください。', size: 'md', color: '#1e293b', wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: { type: 'message', label: '初めての方（初診）', text: '初めての方（初診）' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '2回目以降（再診）', text: '2回目以降（再診）' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: 'メッセージで相談する', text: 'メッセージで相談する' },
          },
        ],
      },
    },
  } as unknown as Message;
}

function buildInitialVisitCategoryFlex(): Message {
  return {
    type: 'flex',
    altText: '初診 - ケガの施術・慢性症状・美容鍼・美療メディセルの選択',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '16px',
        contents: [{ type: 'text', text: '初診', color: '#FFFFFF', size: 'lg', weight: 'bold' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [{ type: 'text', text: 'ご希望の内容をお選びください。', size: 'md', color: '#1e293b', wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: { type: 'message', label: 'ケガの施術（保険）', text: 'ケガの施術（保険）' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '慢性症状（自費）', text: '慢性症状（自費）' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '美容鍼・美療メディセル', text: '美容鍼・美療メディセル' },
          },
        ],
      },
    },
  } as unknown as Message;
}

function buildBeautyCategoryFlex(): Message {
  return {
    type: 'flex',
    altText: '初診 - 美容・美療の選択',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '16px',
        contents: [{ type: 'text', text: '美容・美療', color: '#FFFFFF', size: 'lg', weight: 'bold' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [{ type: 'text', text: 'ご希望の施術をお選びください。', size: 'md', color: '#1e293b', wrap: true }],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            action: { type: 'message', label: '美容鍼', text: '美容鍼' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '美療メディセル', text: '美療メディセル' },
          },
        ],
      },
    },
  } as unknown as Message;
}

async function notifyClinic(
  env: { LINE_CHANNEL_ACCESS_TOKEN: string; CLINIC_LINE_USER_ID?: string },
  text: string,
): Promise<void> {
  if (!env.CLINIC_LINE_USER_ID) return;
  const clinicClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  await clinicClient.pushMessage(env.CLINIC_LINE_USER_ID, [{ type: 'text', text }]);
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
  const reservationTriggers = new Set(['予約する', '予約・ご相談']);
  const activeSession = await getActiveIntakeSession(db, lineUserId);

  // セッションがなく 予約トリガーでもない → 消費しない
  if (!activeSession && !reservationTriggers.has(incomingText)) {
    return false;
  }

  // 予約トリガーで既存セッションがない → 初診 / 再診 / 相談する
  if (!activeSession && reservationTriggers.has(incomingText)) {
    try {
      await lineClient.replyMessage(replyToken, [buildEntryFlex()]);
    } catch (err) {
      console.error('handleIntakeMessage: failed to send entry flex', err);
    }

    const id = crypto.randomUUID();
    const now = jstNow();
    await db
      .prepare(
        `INSERT INTO intake_sessions (id, line_user_id, session_type, current_step, answers, status, created_at, updated_at)
         VALUES (?, ?, 'consultation', -2, '{}', 'in_progress', ?, ?)`,
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
    const sessionType = activeSession.session_type as SessionType;

    // step -2: 入口（初診 / 再診 / 相談する）
    if (step === -2) {
      if (incomingText === '初めての方（初診）') {
        await updateIntakeSession(db, activeSession.id, {
          current_step: -1,
          answers: JSON.stringify({ flow_mode: 'initial', selection_stage: 'category' }),
        });
        try {
          await lineClient.replyMessage(replyToken, [buildInitialVisitCategoryFlex()]);
        } catch { /* ignore */ }
        return true;
      }

      if (incomingText === '2回目以降（再診）') {
        await db.prepare(`UPDATE intake_sessions SET session_type = ?, current_step = 0, answers = ?, updated_at = ? WHERE id = ?`)
          .bind('revisit', JSON.stringify({ flow_mode: 'revisit' }), jstNow(), activeSession.id).run();
        await sendQuestion(lineClient, replyToken, REVISIT_STEPS[0]);
        return true;
      }

      if (incomingText === 'メッセージで相談する') {
        await db.prepare(`UPDATE intake_sessions SET session_type = ?, current_step = 0, answers = ?, updated_at = ? WHERE id = ?`)
          .bind('consultation', JSON.stringify({ flow_mode: 'consultation' }), jstNow(), activeSession.id).run();
        await sendQuestion(lineClient, replyToken, CONSULTATION_STEPS[0]);
        return true;
      }

      try {
        await lineClient.replyMessage(replyToken, [buildEntryFlex()]);
      } catch { /* ignore */ }
      return true;
    }

    // step -1: 初診の種別待ち
    if (step === -1) {
      const selectionState = JSON.parse(activeSession.answers || '{}') as Record<string, string>;

      if (selectionState.selection_stage === 'beauty') {
        const beautyTypeMap: Record<string, SessionType> = {
          '美容鍼': 'beauty',
          '美療メディセル': 'beauty_medicell',
        };
        const chosenBeautyType = beautyTypeMap[incomingText];
        if (!chosenBeautyType) {
          try {
            await lineClient.replyMessage(replyToken, [buildBeautyCategoryFlex()]);
          } catch { /* ignore */ }
          return true;
        }

        await updateIntakeSession(db, activeSession.id, {
          status: 'in_progress',
          current_step: 0,
          answers: JSON.stringify({ session_type_label: getTypeLabel(chosenBeautyType) }),
        });
        await db.prepare(`UPDATE intake_sessions SET session_type = ?, updated_at = ? WHERE id = ?`)
          .bind(chosenBeautyType, jstNow(), activeSession.id).run();

        const firstStep = getNextStep(chosenBeautyType, 0, {});
        if (firstStep) {
          await sendQuestion(lineClient, replyToken, firstStep.def);
        }
        return true;
      }

      const typeMap: Record<string, SessionType | 'beauty_branch'> = {
        'ケガの施術（保険）': 'injury',
        '慢性症状（自費）': 'chronic',
        '美容鍼・美療メディセル': 'beauty_branch',
      };
      const chosenType = typeMap[incomingText];
      if (!chosenType) {
        try {
          await lineClient.replyMessage(replyToken, [buildInitialVisitCategoryFlex()]);
        } catch { /* ignore */ }
        return true;
      }

      if (chosenType === 'beauty_branch') {
        await updateIntakeSession(db, activeSession.id, {
          current_step: -1,
          answers: JSON.stringify({ flow_mode: 'initial', selection_stage: 'beauty' }),
        });
        try {
          await lineClient.replyMessage(replyToken, [buildBeautyCategoryFlex()]);
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
  const allSteps = getAllSteps(sessionType);

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
  const allSteps = getAllSteps(sessionType);

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

  const answers = JSON.parse(session.answers || '{}') as Record<string, string>;
  if (session.session_type === 'revisit') {
    const name = answers.name ?? '未記入';
    const category = answers.revisit_category ?? '未記入';
    const currentState = answers.current_state ?? '未記入';
    const dt1 = answers.datetime1 ?? '未記入';
    const dt2 = answers.datetime2 && answers.datetime2 !== 'なし' ? `\n② ${answers.datetime2}` : '';

    try {
      await lineClient.replyMessage(replyToken, [
        {
          type: 'text',
          text:
            `再診のご予約ありがとうございます。\n\n` +
            `ご希望日時\n① ${dt1}${dt2}\n\n` +
            `確認のうえ、スタッフよりご連絡いたします。`,
        },
      ]);
    } catch (err) {
      console.error('completeSession: revisit reply failed', err);
    }

    await notifyClinic(
      env,
      `【再診予約リクエスト】\n区分: ${category}\nお名前/診察券番号: ${name}\n現在の状態: ${currentState}\n希望日時①: ${dt1}${answers.datetime2 && answers.datetime2 !== 'なし' ? `\n希望日時②: ${answers.datetime2}` : ''}`,
    ).catch((err) => console.error('completeSession: revisit clinic notify failed', err));
    return;
  }

  if (session.session_type === 'consultation') {
    const consultation = answers.consultation_content ?? '未記入';

    try {
      await lineClient.replyMessage(replyToken, [
        {
          type: 'text',
          text: 'ご相談ありがとうございます。\n内容を確認のうえ、折り返しご連絡いたします。',
        },
      ]);
    } catch (err) {
      console.error('completeSession: consultation reply failed', err);
    }

    await notifyClinic(
      env,
      `【ご相談】\n${consultation}`,
    ).catch((err) => console.error('completeSession: consultation clinic notify failed', err));
    return;
  }

  // 初診問診 → 患者へ完了メッセージ + PDF生成
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
    await generateAndNotifyPdf(
      { id: session.id, line_user_id: session.line_user_id, session_type: session.session_type, answers: session.answers },
      {
        PDF_BUCKET: env.PDF_BUCKET,
        LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN,
        WORKER_URL: env.WORKER_URL,
        CLINIC_LINE_USER_ID: env.CLINIC_LINE_USER_ID,
      },
    ).catch((err) => console.error('completeSession: PDF generation failed', err));
  } else {
    console.warn('completeSession: PDF_BUCKET is not available; skipping PDF generation');
  }
}
