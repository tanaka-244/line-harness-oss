-- Migration 014: 施術後アンケートを3問構成に拡張
-- Step 3: 症状→雰囲気質問に変更
-- Step 4: 再来院意向を追加
-- Step 5: Googleレビュー依頼（旧Step3の内容を移動）

-- Step 3 を Q2（院の雰囲気・対応）に更新
UPDATE scenario_steps
SET
  message_type    = 'text',
  message_content = '{"text":"院の雰囲気やスタッフの対応はいかがでしたか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"とても良かった😊","text":"とても良かった😊"}},{"type":"action","action":{"type":"message","label":"良かった","text":"良かった"}},{"type":"action","action":{"type":"message","label":"普通","text":"普通"}},{"type":"action","action":{"type":"message","label":"改善してほしい","text":"改善してほしい"}}]}}',
  updated_at      = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
WHERE id = 'b0000000-0000-4000-8000-000000000003';

-- Step 4: Q3（再来院意向）を追加
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
VALUES (
  'b0000000-0000-4000-8000-000000000004',
  'a0000000-0000-4000-8000-000000000001',
  4,
  0,
  'text',
  '{"text":"またたなか整骨院鍼灸院に来院したいですか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"ぜひまた来たい✨","text":"ぜひまた来たい✨"}},{"type":"action","action":{"type":"message","label":"機会があれば","text":"機会があれば"}},{"type":"action","action":{"type":"message","label":"まだわからない","text":"まだわからない"}}]}}',
  NULL,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);

-- Step 5: Googleレビュー依頼 Flex（合計スコア4以上の場合）
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
VALUES (
  'b0000000-0000-4000-8000-000000000005',
  'a0000000-0000-4000-8000-000000000001',
  5,
  0,
  'flex',
  '{"type":"bubble","body":{"type":"box","layout":"vertical","paddingAll":"20px","contents":[{"type":"text","text":"嬉しいです😊 もしよろしければ、Googleでの口コミ投稿をお願いできますか？私たちの大きな励みになります🙏","size":"sm","color":"#1e293b","wrap":true}]},"footer":{"type":"box","layout":"vertical","paddingAll":"16px","contents":[{"type":"button","action":{"type":"uri","label":"口コミを書く","uri":"https://g.page/r/CRwRXX3LUHkeEBE/review"},"style":"primary","color":"#06C755"}]}}',
  NULL,
  NULL,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);
