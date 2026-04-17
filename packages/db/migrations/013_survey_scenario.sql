-- Seed: 施術後アンケートシナリオ
-- trigger_type = 'manual': 友だち一覧からスタッフが手動発火
-- Google レビュー URL は Step 3 の message_content 内の
-- "https://g.page/r/YOUR_REVIEW_URL/review" を管理画面から更新してください

INSERT OR IGNORE INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active, created_at, updated_at)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  '施術後アンケート',
  '施術後に患者の満足度を確認し、高評価の場合はGoogleレビューを依頼する',
  'manual',
  NULL,
  1,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);

-- Step 1: ご来院お礼 + アンケート同意確認
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  1,
  0,
  'text',
  '{"text":"いつもご来院ありがとうございます😊\n少しだけアンケートにご協力いただけますか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"もちろん！","text":"もちろん！"}},{"type":"action","action":{"type":"message","label":"また今度","text":"また今度"}}]}}',
  NULL,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);

-- Step 2: 症状確認
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
VALUES (
  'b0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  2,
  0,
  'text',
  '{"text":"施術を受けて、症状はいかがでしたか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"とても良くなった👍","text":"とても良くなった👍"}},{"type":"action","action":{"type":"message","label":"少し良くなった","text":"少し良くなった"}},{"type":"action","action":{"type":"message","label":"変わらない","text":"変わらない"}},{"type":"action","action":{"type":"message","label":"悪くなった","text":"悪くなった"}}]}}',
  NULL,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);

-- Step 3: Googleレビュー依頼（score >= 4 向け）
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
VALUES (
  'b0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000001',
  3,
  0,
  'flex',
  '{"type":"bubble","body":{"type":"box","layout":"vertical","paddingAll":"20px","contents":[{"type":"text","text":"嬉しいです😊 もしよろしければ、Googleでの口コミ投稿をお願いできますか？\n私たちの大きな励みになります🙏","size":"sm","color":"#1e293b","wrap":true}]},"footer":{"type":"box","layout":"vertical","paddingAll":"16px","contents":[{"type":"button","action":{"type":"uri","label":"口コミを書く","uri":"https://g.page/r/CRwRXX3LUHkeEBE/review"},"style":"primary","color":"#06C755"}]}}',
  NULL,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);
