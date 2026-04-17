# LINE問診PDF生成システム 仕様書

## 概要

LINE問診で入力されたデータを、たなか整骨院鍼灸院の問診票PDF形式で自動生成し、院側に通知するシステム。

---

## システム構成

```
患者: LINE問診入力
        ↓
Cloudflare Workers (webhook.ts)
        ↓
D1 (intake_sessions) にデータ保存
        ↓
問診完了時にPDF生成トリガー
        ↓
pdf-lib でPDF生成（日本語フォント: R2から読み込み）
        ↓
R2にPDF保存 → 署名付きURL発行（24時間有効）
        ↓
院のLINE公式アカウントにPDFリンク通知
```

---

## 技術スタック

| コンポーネント | 技術 | 理由 |
|---------------|------|------|
| PDF生成 | pdf-lib | Workers対応、フォント埋め込み可能 |
| 日本語フォント | NotoSansJP | 無料、商用利用可 |
| フォント保存 | Cloudflare R2 | 無料枠十分、Workers連携容易 |
| PDF保存 | Cloudflare R2 | 署名付きURL対応 |
| データベース | Cloudflare D1 | 既存利用中 |

---

## ファイル構成

```
apps/worker/
├── src/
│   ├── index.ts          # メインエントリー
│   ├── webhook.ts        # LINE webhook処理（既存）
│   ├── pdf/
│   │   ├── generator.ts  # PDF生成メイン処理
│   │   ├── templates/
│   │   │   ├── injury.ts     # ケガ用テンプレート
│   │   │   ├── chronic.ts    # 慢性用テンプレート
│   │   │   ├── beauty.ts     # 美容鍼用テンプレート
│   │   │   └── medicell.ts   # 美療メディセル用テンプレート
│   │   └── utils/
│   │       ├── font.ts       # フォント読み込み
│   │       ├── wareki.ts     # 和暦変換
│   │       └── zipcode.ts    # 郵便番号取得
│   └── r2/
│       └── storage.ts    # R2操作（保存・URL発行）
├── wrangler.toml         # R2バインディング追加
└── package.json          # pdf-lib追加
```

---

## D1 テーブル: intake_sessions

### 既存スキーマ
```sql
CREATE TABLE intake_sessions (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  session_type TEXT NOT NULL,      -- injury / chronic / beauty / beauty_medicell / revisit
  current_step INTEGER DEFAULT 0,
  answers TEXT DEFAULT '{}',       -- JSON形式で回答を保存
  status TEXT DEFAULT 'in_progress', -- in_progress / completed / cancelled
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### answersのJSON構造（session_type別）

#### injury（ケガ）
```json
{
  "name": "田中 太郎",
  "furigana": "たなか たろう",
  "birthday": "1985年3月20日",
  "gender": "男性",
  "phone": "090-1234-5678",
  "address": "長野県諏訪郡原村...",
  "job": "会社員",
  "pain_location": "右足首の外側",
  "injury_when": "昨日",
  "injury_where": "スポーツ中",
  "injury_how": "サッカー中に転倒",
  "current_state": "腫れている、熱感がある",
  "pain_level": "5〜6（10段階）",
  "past_injury": "ない",
  "other_clinic": "はい",
  "other_clinic_name": "諏訪中央病院",
  "other_clinic_diagnosis": "足関節捻挫",
  "current_illness": "ない",
  "current_illness_detail": "",
  "current_medicine": "ない",
  "current_medicine_detail": "",
  "referral": "Googleマップ",
  "datetime1": "4/15 10:00",
  "datetime2": "4/16 14:00",
  "datetime3": "4/17 午前中"
}
```

#### chronic（慢性）
```json
{
  "name": "山田 花子",
  "furigana": "やまだ はなこ",
  "birthday": "1975年8月15日",
  "gender": "女性",
  "phone": "090-9876-5432",
  "address": "長野県茅野市...",
  "job": "主婦",
  "symptoms": "肩こりがひどく、頭痛もある",
  "duration": "3ヶ月以上",
  "worse_time": "デスクワークの後",
  "current_status": "良くなったり悪くなったり",
  "severity": "5〜6（10段階）",
  "preferred_treatment": "鍼灸を試してみたい",
  "other_clinic": "はい",
  "other_clinic_name": "茅野中央病院",
  "other_clinic_since": "半年前から",
  "current_illness": "ない",
  "current_illness_detail": "",
  "current_medicine": "ある",
  "current_medicine_detail": "ロキソニン",
  "referral": "友人の紹介",
  "datetime1": "...",
  "datetime2": "...",
  "datetime3": "..."
}
```

#### beauty（美容鍼）
```json
{
  "name": "鈴木 美咲",
  "furigana": "すずき みさき",
  "birthday": "1990年5月20日",
  "phone": "080-1234-5678",
  "address": "長野県諏訪郡原村...",
  "menu": "美容鍼",
  "past_beauty": "いいえ",
  "past_bleeding": "",
  "alcohol_skin": "いいえ",
  "facial_palsy": "いいえ",
  "blood_thinner": "いいえ",
  "pregnancy": "いいえ",
  "pacemaker": "いいえ",
  "face_concerns": "ほうれい線が気になる、目の下のたるみ",
  "top3_concerns": "ほうれい線、たるみ、ハリ",
  "event": "はい",
  "event_detail": "来月友人の結婚式",
  "other_notes": "痛みに弱いので優しく",
  "datetime1": "...",
  "datetime2": "...",
  "datetime3": "..."
}
```

#### beauty_medicell（美療メディセル）
```json
{
  "name": "佐藤 恵子",
  "furigana": "さとう けいこ",
  "birthday": "1982年11月3日",
  "phone": "070-5555-1234",
  "address": "長野県茅野市...",
  "pregnancy": "いいえ",
  "pacemaker": "いいえ",
  "skin_condition": "いいえ",
  "current_illness": "ない",
  "current_illness_detail": "",
  "symptoms": "肩こりがひどい",
  "duration": "1年以上",
  "worse_time": "デスクワーク後",
  "severity": "6〜7（10段階）",
  "past_medicell": "いいえ",
  "treatment_area": "半身（上半身）",
  "other_notes": "力加減は強めで",
  "datetime1": "...",
  "datetime2": "...",
  "datetime3": "..."
}
```

---

## PDF生成仕様

### 共通処理

1. **和暦変換**: 西暦 → 和暦（昭和/平成/令和）
2. **郵便番号取得**: 住所から自動取得（原村周辺対応）
3. **相対日付変換**: 「昨日」「3日前」→ 年月日形式（ケガ用）
4. **記入日**: PDF生成日を自動設定

### テンプレート別レイアウト

#### ケガ用 (injury)
- ヘッダー: ロゴ + 「問診票（ケガ・急性症状）」
- 基本情報: 氏名/ふりがな/生年月日/職業/性別/住所/電話
- 同意確認: 保険適用説明 + 署名欄
- 症状セクション（人体図あり）:
  - ① 本日の症状
  - ② 症状はいつから
  - ③ どこで何をして
  - ④ 症状について（痛みの程度）
- 他院受診歴
- 既往歴・その他
- 来院きっかけ（入力時のみ表示）
- 施術者記入欄

#### 慢性用 (chronic)
- ヘッダー: ロゴ + 「問診票（慢性症状・自費）」
- 基本情報: 同上
- 同意確認: 自費説明 + 署名欄
- 症状セクション（人体図あり）:
  - ① 症状の詳細
  - ② 症状はいつから
  - ③ 悪化する時
  - ④ 症状の状態と程度
  - ⑤ 希望する施術
- 他院受診歴
- 既往歴・その他
- 来院きっかけ
- 施術者記入欄

#### 美容鍼用 (beauty)
- ヘッダー: ロゴ + 「問診票（美容鍼）」
- 基本情報: 氏名/ふりがな/生年月日/住所/電話（性別なし）
- 同意確認: 美容鍼リスク説明 + 署名欄
- 施術メニュー
- 確認項目（7項目）
- お顔の悩み
- 特に気になる点（3つ）
- イベント予定
- その他
- 施術者記入欄

#### 美療メディセル用 (beauty_medicell)
- ヘッダー: ロゴ + 「問診票（美療メディセル）」
- 基本情報: 同上（性別なし）
- 同意確認: メディセルリスク説明 + 署名欄
- 禁忌確認（3項目）
- 既往歴
- 症状セクション（人体図あり）:
  - ① 症状の詳細
  - ② 症状はいつから
  - ③ 悪化する時
  - ④ つらさの程度
- メディセル経験
- 希望施術範囲
- その他
- 施術者記入欄

---

## R2設定

### バケット名
`tanaka-seikotsu-pdf`

### 保存パス
```
fonts/
  NotoSansJP-Regular.ttf
  NotoSansJP-Bold.ttf

images/
  logo.jpg
  body_figure.png

pdf/
  {session_type}/
    {YYYY-MM-DD}/
      {session_id}.pdf
```

### 署名付きURL
- 有効期限: 24時間
- 用途: 院側がダウンロード

---

## wrangler.toml 追加設定

```toml
[[r2_buckets]]
binding = "PDF_BUCKET"
bucket_name = "tanaka-seikotsu-pdf"
```

---

## 処理フロー詳細

### 1. 問診完了検知

```typescript
// webhook.ts内
if (session.status === 'completed') {
  await generateAndNotifyPdf(session, env);
}
```

### 2. PDF生成

```typescript
// pdf/generator.ts
export async function generatePdf(
  sessionType: 'injury' | 'chronic' | 'beauty' | 'beauty_medicell',
  answers: Record<string, string>,
  env: Env
): Promise<Uint8Array> {
  // 1. フォント読み込み（R2から）
  const font = await loadFont(env.PDF_BUCKET);
  
  // 2. テンプレート別に生成
  switch (sessionType) {
    case 'injury':
      return generateInjuryPdf(answers, font);
    case 'chronic':
      return generateChronicPdf(answers, font);
    case 'beauty':
      return generateBeautyPdf(answers, font);
    case 'beauty_medicell':
      return generateMedicellPdf(answers, font);
  }
}
```

### 3. R2保存 & URL発行

```typescript
// r2/storage.ts
export async function savePdfAndGetUrl(
  bucket: R2Bucket,
  sessionId: string,
  sessionType: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const date = new Date().toISOString().split('T')[0];
  const key = `pdf/${sessionType}/${date}/${sessionId}.pdf`;
  
  await bucket.put(key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' }
  });
  
  // 署名付きURL（24時間有効）
  // Note: R2の署名付きURLはWorkersから直接生成できないため、
  // 一時的な公開URLまたはWorkers経由のプロキシで対応
  return `https://your-worker.workers.dev/pdf/${key}`;
}
```

### 4. LINE通知

```typescript
// 院側アカウントへプッシュ通知
await sendLineNotification(env, {
  to: env.CLINIC_LINE_USER_ID,  // 院のLINEユーザーID
  messages: [{
    type: 'text',
    text: `【新規予約】${getSessionTypeLabel(sessionType)}
━━━━━━━━━━━━━━━━
■ 氏名: ${answers.name}
■ 電話: ${answers.phone}
■ 希望日時:
  ① ${answers.datetime1}
  ② ${answers.datetime2}
  ③ ${answers.datetime3}
━━━━━━━━━━━━━━━━
📄 問診票PDF:
${pdfUrl}`
  }]
});
```

---

## 環境変数（追加）

```
CLINIC_LINE_USER_ID=Uxxxxxxxxxx  # 院のLINEユーザーID
```

---

## セキュリティ考慮

| 項目 | 対策 |
|------|------|
| PDF URL | Workers経由のプロキシ or 署名付きURL |
| 患者データ | Cloudflare内で完結、外部送信なし |
| PDF保存期間 | 必要に応じて自動削除（30日など） |
| アクセス制限 | URLを知らないとアクセス不可 |

---

## 実装優先順位

### Phase 1: 基盤構築
1. R2バケット作成
2. フォント・画像をR2にアップロード
3. pdf-lib導入・基本動作確認

### Phase 2: PDF生成実装
4. ケガ用テンプレート実装
5. 慢性用テンプレート実装
6. 美容鍼用テンプレート実装
7. 美療メディセル用テンプレート実装

### Phase 3: 連携・通知
8. 問診完了時のトリガー実装
9. R2保存・URL発行
10. LINE通知実装

### Phase 4: テスト・調整
11. 各テンプレートの実データテスト
12. レイアウト微調整
13. エラーハンドリング

---

## 参考：完成済みPythonテンプレート

以下のファイルをTypeScript/pdf-libに移植する：

- `/home/claude/pdf_templates/injury_template_v2.py`
- `/home/claude/pdf_templates/chronic_template.py`
- `/home/claude/pdf_templates/beauty_template.py`
- `/home/claude/pdf_templates/medicell_template.py`

---

## 補足：pdf-lib基本構文

```typescript
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// PDFドキュメント作成
const pdfDoc = await PDFDocument.create();
pdfDoc.registerFontkit(fontkit);

// カスタムフォント読み込み
const fontBytes = await env.PDF_BUCKET.get('fonts/NotoSansJP-Regular.ttf');
const font = await pdfDoc.embedFont(await fontBytes.arrayBuffer());

// ページ追加（A4）
const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points

// テキスト描画
page.drawText('問診票', {
  x: 50,
  y: 800,
  size: 16,
  font: font,
  color: rgb(0, 0, 0),
});

// 線描画
page.drawLine({
  start: { x: 50, y: 750 },
  end: { x: 545, y: 750 },
  thickness: 0.5,
  color: rgb(0, 0, 0),
});

// 矩形描画
page.drawRectangle({
  x: 50,
  y: 700,
  width: 200,
  height: 30,
  borderColor: rgb(0, 0, 0),
  borderWidth: 0.5,
});

// PDF出力
const pdfBytes = await pdfDoc.save();
```

---

## 完成イメージ

1. 患者がLINEで問診を完了
2. 数秒後、院のLINEに通知が届く
3. 通知内にPDFリンクが含まれる
4. リンクをタップ → 問診票PDFがダウンロード
5. 来院時に印刷して使用可能
