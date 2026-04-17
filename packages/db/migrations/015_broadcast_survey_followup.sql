-- Migration 015: broadcasts にアンケート導線フラグを追加
-- survey_followup = 1 の場合、配信時にアンケート同意QRを追加送信し
-- 受信者を施術後アンケートシナリオ(step_order=0)に自動エントリする

ALTER TABLE broadcasts ADD COLUMN survey_followup INTEGER NOT NULL DEFAULT 0;

-- 4月29日20時配信「アンケートの🙇🏻‍♂️」にフラグを立てる
UPDATE broadcasts SET survey_followup = 1 WHERE id = '97ea90bf-89b4-4fe8-8c2b-3180fc6ff13e';
