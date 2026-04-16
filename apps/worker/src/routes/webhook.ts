import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody, WebhookEvent, TextEventMessage, Message } from '@line-crm/line-sdk';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { buildMessage, expandVariables } from '../services/step-delivery.js';
import type { Env } from '../index.js';

const webhook = new Hono<Env>();

webhook.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  // Multi-account: resolve credentials from DB by destination (channel user ID)
  // or fall back to environment variables (default account)
  let channelSecret = c.env.LINE_CHANNEL_SECRET;
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;

  if ((body as { destination?: string }).destination) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelSecret = account.channel_secret;
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        break;
      }
    }
  }

  // Verify with resolved secret
  const valid = await verifySignature(channelSecret, rawBody, signature);
  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.LIFF_URL, c.env.IMAGES);
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

/** Upload binary content from LINE Content API to R2, return public URL. */
async function saveMediaToR2(
  lineClient: LineClient,
  messageId: string,
  r2: R2Bucket,
  workerUrl: string,
  contentType: string,
  ext: string,
): Promise<string> {
  const buffer = await lineClient.getMessageContent(messageId);
  const key = `line-media/${crypto.randomUUID()}.${ext}`;
  await r2.put(key, buffer, { httpMetadata: { contentType } });
  return `${workerUrl}/images/${key}`;
}

/** Resolve non-text message to { messageType, content } for messages_log. */
async function resolveMediaMessage(
  msg: { type: string; id: string; [key: string]: unknown },
  lineClient: LineClient,
  r2?: R2Bucket,
  workerUrl?: string,
): Promise<{ messageType: string; content: string }> {
  try {
    if (msg.type === 'image' && r2 && workerUrl) {
      const url = await saveMediaToR2(lineClient, msg.id, r2, workerUrl, 'image/jpeg', 'jpg');
      return { messageType: 'image', content: JSON.stringify({ originalContentUrl: url, previewImageUrl: url }) };
    }
    if (msg.type === 'video' && r2 && workerUrl) {
      const url = await saveMediaToR2(lineClient, msg.id, r2, workerUrl, 'video/mp4', 'mp4');
      return { messageType: 'video', content: JSON.stringify({ originalContentUrl: url, previewImageUrl: url }) };
    }
    if (msg.type === 'audio' && r2 && workerUrl) {
      const url = await saveMediaToR2(lineClient, msg.id, r2, workerUrl, 'audio/mpeg', 'm4a');
      return { messageType: 'audio', content: JSON.stringify({ originalContentUrl: url }) };
    }
    if (msg.type === 'file') {
      const fileName = (msg.fileName as string) || 'file';
      if (r2 && workerUrl) {
        const ext = fileName.split('.').pop() || 'bin';
        const url = await saveMediaToR2(lineClient, msg.id, r2, workerUrl, 'application/octet-stream', ext);
        return { messageType: 'file', content: JSON.stringify({ originalContentUrl: url, fileName }) };
      }
      return { messageType: 'file', content: JSON.stringify({ fileName }) };
    }
    if (msg.type === 'sticker') {
      return { messageType: 'sticker', content: JSON.stringify({ packageId: msg.packageId, stickerId: msg.stickerId }) };
    }
    if (msg.type === 'location') {
      return { messageType: 'location', content: JSON.stringify({ title: msg.title, address: msg.address, latitude: msg.latitude, longitude: msg.longitude }) };
    }
  } catch (err) {
    console.error(`Failed to process ${msg.type} message:`, err);
  }
  return { messageType: msg.type, content: `[${msg.type}]` };
}

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
  imagesR2?: R2Bucket,
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error('Failed to get profile for', userId, err);
    }

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    // Set line_account_id for multi-account tracking
    if (lineAccountId) {
      await db.prepare('UPDATE friends SET line_account_id = ? WHERE id = ? AND line_account_id IS NULL')
        .bind(lineAccountId, friend.id).run();
    }

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    const scenarios = await getScenarios(db);
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
        try {
          const existing = await db
            .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
            .bind(friend.id, scenario.id)
            .first<{ id: string }>();
          if (!existing) {
            const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);

            // Immediate delivery: if the first step has delay=0, send it now via replyMessage (free)
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            if (firstStep && firstStep.delay_minutes === 0 && friendScenario.status === 'active') {
              try {
                const expandedContent = expandVariables(firstStep.message_content, friend as { id: string; display_name: string | null; user_id: string | null });
                const message = buildMessage(firstStep.message_type, expandedContent);
                await lineClient.replyMessage(event.replyToken, [message]);
                console.log(`Immediate delivery: sent step ${firstStep.id} to ${userId}`);

                // Log outgoing message (replyMessage = 無料)
                const logId = crypto.randomUUID();
                await db
                  .prepare(
                    `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
                     VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', ?)`,
                  )
                  .bind(logId, friend.id, firstStep.message_type, firstStep.message_content, firstStep.id, jstNow())
                  .run();

                // Advance or complete the friend_scenario
                const secondStep = steps[1] ?? null;
                if (secondStep) {
                  const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
                  nextDeliveryDate.setMinutes(nextDeliveryDate.getMinutes() + secondStep.delay_minutes);
                  // Enforce 9:00-21:00 JST delivery window
                  const h = nextDeliveryDate.getUTCHours();
                  if (h < 9 || h >= 21) {
                    if (h >= 21) nextDeliveryDate.setUTCDate(nextDeliveryDate.getUTCDate() + 1);
                    nextDeliveryDate.setUTCHours(9, 0, 0, 0);
                  }
                  await advanceFriendScenario(db, friendScenario.id, firstStep.step_order, nextDeliveryDate.toISOString().slice(0, -1) + '+09:00');
                } else {
                  await completeFriendScenario(db, friendScenario.id);
                }
              } catch (err) {
                console.error('Failed immediate delivery for scenario', scenario.id, err);
              }
            }
          }
        } catch (err) {
          console.error('Failed to enroll friend in scenario', scenario.id, err);
        }
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    await updateFriendFollowStatus(db, userId, false);
    return;
  }

  if (event.type === 'message') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    let friend = await getFriendByLineUserId(db, userId);
    // プロフィール未取得（名前がない）場合は取得して更新
    if (!friend || !friend.display_name) {
      let profile;
      try {
        profile = await lineClient.getProfile(userId);
      } catch (err) {
        console.error('Failed to get profile for', userId, err);
      }
      friend = await upsertFriend(db, {
        lineUserId: userId,
        displayName: profile?.displayName ?? null,
        pictureUrl: profile?.pictureUrl ?? null,
        statusMessage: profile?.statusMessage ?? null,
      });
      if (lineAccountId) {
        await db.prepare('UPDATE friends SET line_account_id = ? WHERE id = ? AND line_account_id IS NULL')
          .bind(lineAccountId, friend.id).run();
      }
    }
    if (!friend) return;

    // テキスト以外のメッセージ（画像・動画・音声・スタンプ・位置情報・ファイル）
    if (event.message.type !== 'text') {
      const msg = event.message as unknown as { type: string; id: string; [key: string]: unknown };
      const { messageType, content } = await resolveMediaMessage(msg, lineClient, imagesR2, workerUrl);
      const now = jstNow();
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
           VALUES (?, ?, 'incoming', ?, ?, NULL, NULL, ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, messageType, content, now)
        .run();
      await upsertChatOnMessage(db, friend.id);
      await fireEvent(db, 'message_received', {
        friendId: friend.id,
        eventData: { text: `[${messageType}]`, matched: false },
      }, lineAccessToken, lineAccountId);
      return;
    }

    const textMessage = event.message as TextEventMessage;
    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    // ===== 施術後アンケート返答ハンドラ =====
    // sentinel (9999-12-31) で停止中の survey enrollment があれば返答を処理し早期 return
    {
      const SURVEY_SENTINEL = '9999-12-31T00:00:00+09:00';
      const activeSurvey = await db
        .prepare(
          `SELECT fs.id, fs.current_step_order FROM friend_scenarios fs
           JOIN scenarios s ON s.id = fs.scenario_id
           WHERE fs.friend_id = ? AND s.name = ? AND fs.status = 'active' AND fs.next_delivery_at = ?`,
        )
        .bind(friend.id, '施術後アンケート', SURVEY_SENTINEL)
        .first<{ id: string; current_step_order: number }>();

      if (activeSurvey) {
        await handleSurveyResponse(db, lineClient, event.replyToken, friend, activeSurvey, incomingText);
        await fireEvent(db, 'message_received', {
          friendId: friend.id,
          eventData: { text: incomingText, matched: true },
        }, lineAccessToken, lineAccountId);
        return;
      }
    }
    // ==========================================

    // チャットを作成/更新（ユーザーの自発的メッセージのみ unread にする）
    // ボタンタップ等の自動応答キーワードは除外
    const autoKeywords = ['料金', '機能', 'API', 'フォーム', 'ヘルプ', 'UUID', 'UUID連携について教えて', 'UUID連携を確認', '配信時間', '導入支援を希望します', 'アカウント連携を見る', '体験を完了する', 'BAN対策を見る', '連携確認'];
    const isAutoKeyword = autoKeywords.some(k => incomingText === k);
    const isTimeCommand = /(?:配信時間|配信|届けて|通知)[はを]?\s*\d{1,2}\s*時/.test(incomingText);
    if (!isAutoKeyword && !isTimeCommand) {
      await upsertChatOnMessage(db, friend.id);
    }

    // 配信時間設定: 「配信時間は○時」「○時に届けて」等のパターンを検出
    const timeMatch = incomingText.match(/(?:配信時間|配信|届けて|通知)[はを]?\s*(\d{1,2})\s*時/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      if (hour >= 6 && hour <= 22) {
        // Save preferred_hour to friend metadata
        const existing = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friend.id).first<{ metadata: string }>();
        const meta = JSON.parse(existing?.metadata || '{}');
        meta.preferred_hour = hour;
        await db.prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(meta), jstNow(), friend.id).run();

        // Reply with confirmation
        try {
          const period = hour < 12 ? '午前' : '午後';
          const displayHour = hour <= 12 ? hour : hour - 12;
          await lineClient.replyMessage(event.replyToken, [
            buildMessage('flex', JSON.stringify({
              type: 'bubble',
              body: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '配信時間を設定しました', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: `${period} ${displayHour}:00`, size: 'xxl', weight: 'bold', color: '#f59e0b', align: 'center' },
                  { type: 'text', text: `（${hour}:00〜）`, size: 'sm', color: '#64748b', align: 'center', margin: 'sm' },
                ], backgroundColor: '#fffbeb', cornerRadius: 'md', paddingAll: '20px', margin: 'lg' },
                { type: 'text', text: '今後のステップ配信はこの時間以降にお届けします。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
              ], paddingAll: '20px' },
            })),
          ]);
        } catch (err) {
          console.error('Failed to reply for time setting', err);
        }
        return;
      }
    }

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === '体験を完了する' && lineAccountId) {
      try {
        const friendRecord = await db.prepare('SELECT user_id FROM friends WHERE id = ?').bind(friend.id).first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db.prepare(
            'SELECT f.line_user_id, la.channel_access_token FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1'
          ).bind(friendRecord.user_id, lineAccountId).all<{ line_user_id: string; channel_access_token: string }>();

          for (const other of otherFriends.results) {
            const otherClient = new LineClient(other.channel_access_token);
            const { buildMessage: bm } = await import('../services/step-delivery.js');
            await otherClient.pushMessage(other.line_user_id, [bm('flex', JSON.stringify({
              type: 'bubble', size: 'giga',
              header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#fffbeb',
                contents: [{ type: 'text', text: `${friend.display_name || ''}さんへ`, size: 'lg', weight: 'bold', color: '#1e293b' }],
              },
              body: { type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                  { type: 'text', text: '別アカウントからのアクションを検知しました。', size: 'sm', color: '#06C755', weight: 'bold', wrap: true },
                  { type: 'text', text: 'アカウント連携が正常に動作しています。体験ありがとうございました。', size: 'sm', color: '#1e293b', wrap: true, margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: 'ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [
                  { type: 'button', action: { type: 'message', label: '導入について相談する', text: '導入支援を希望します' }, style: 'primary', color: '#06C755' },
                  ...(liffUrl ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${liffUrl}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
                ],
              },
            }))]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify({
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: 'Account ① にメッセージを送りました', size: 'sm', color: '#06C755', weight: 'bold', align: 'center' },
                { type: 'text', text: 'Account ① のトーク画面を確認してください', size: 'xs', color: '#64748b', align: 'center', margin: 'md' },
              ],
            },
          }))]);
          return;
        }
      } catch (err) {
        console.error('Cross-account trigger error:', err);
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）
    // NOTE: Auto-replies use replyMessage (free, no quota) instead of pushMessage
    // The replyToken is only valid for ~1 minute after the message event
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        is_active: number;
        created_at: string;
      }>();

    let matched = false;
    let replyTokenConsumed = false;
    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === 'exact'
          ? incomingText === rule.keyword
          : incomingText.includes(rule.keyword);

      if (isMatch) {
        try {
          // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}})
          const expandedContent = expandVariables(rule.response_content, friend as { id: string; display_name: string | null; user_id: string | null }, workerUrl);
          const replyMsg = buildMessage(rule.response_type, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
          replyTokenConsumed = true;

          // 送信ログ（replyMessage = 無料）
          const outLogId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', ?)`,
            )
            .bind(outLogId, friend.id, rule.response_type, rule.response_content, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send auto-reply', err);
          // replyToken may still be unused if replyMessage threw before LINE accepted it
        }

        matched = true;
        break;
      }
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
      friendId: friend.id,
      eventData: { text: incomingText, matched },
      replyToken: replyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }
}

// ============================================================
// 施術後アンケート — 会話ハンドラ
// friend_scenarios.current_step_order の値でステートを管理する
//   1 → Step 1 送信済み、Q1 返答待ち（もちろん！ / また今度）
//   2 → Step 2 送信済み、Q2 返答待ち（症状回答）
// ============================================================
async function handleSurveyResponse(
  db: D1Database,
  lineClient: InstanceType<typeof LineClient>,
  replyToken: string,
  friend: { id: string; line_user_id: string; display_name: string | null },
  survey: { id: string; current_step_order: number },
  incomingText: string,
): Promise<void> {
  const SURVEY_SENTINEL = '9999-12-31T00:00:00+09:00';

  if (survey.current_step_order === 1) {
    // ── Q1 返答: もちろん！ / また今度 ──────────────────────────
    if (incomingText === 'もちろん！') {
      // Step 2 を返信（クイックリプライ付き）
      const q2Content = '{"text":"施術を受けて、症状はいかがでしたか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"とても良くなった👍","text":"とても良くなった👍"}},{"type":"action","action":{"type":"message","label":"少し良くなった","text":"少し良くなった"}},{"type":"action","action":{"type":"message","label":"変わらない","text":"変わらない"}},{"type":"action","action":{"type":"message","label":"悪くなった","text":"悪くなった"}}]}}';
      await lineClient.replyMessage(replyToken, [buildMessage('text', q2Content)]);
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type, created_at)
           VALUES (?, ?, 'outgoing', 'text', ?, 'reply', ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, q2Content, jstNow())
        .run();
      await advanceFriendScenario(db, survey.id, 2, SURVEY_SENTINEL);
    } else {
      // また今度 または想定外の返答 → 丁寧にクローズ
      const byeText = 'わかりました！またいつでもご来院をお待ちしております😊';
      await lineClient.replyMessage(replyToken, [{ type: 'text', text: byeText } as Message]);
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type, created_at)
           VALUES (?, ?, 'outgoing', 'text', ?, 'reply', ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, byeText, jstNow())
        .run();
      await completeFriendScenario(db, survey.id);
    }
    return;
  }

  if (survey.current_step_order === 2) {
    // ── Q2 返答: 症状回答 ────────────────────────────────────────
    const LOW_SCORE_MESSAGE = '貴重なご意見ありがとうございました！\nさらに良い施術ができるよう努めてまいります。\nまたのご来院をお待ちしております😊';
    const scoreMap: Record<string, { score: number; thankYou: string }> = {
      'とても良くなった👍': { score: 5, thankYou: '' },
      '少し良くなった':     { score: 4, thankYou: '' },
      '変わらない':         { score: 2, thankYou: LOW_SCORE_MESSAGE },
      '悪くなった':         { score: 1, thankYou: LOW_SCORE_MESSAGE },
    };

    const entry = scoreMap[incomingText];
    if (!entry) return; // 想定外の返答は無視（waiting 状態を継続）

    const now = jstNow();

    // friend_scores に記録
    await db
      .prepare(
        `INSERT INTO friend_scores (id, friend_id, scoring_rule_id, score_change, reason, created_at)
         VALUES (?, ?, NULL, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, entry.score, `施術後アンケート: ${incomingText}`, now)
      .run();

    // friends.score を加算
    await db
      .prepare(`UPDATE friends SET score = score + ?, updated_at = ? WHERE id = ?`)
      .bind(entry.score, now, friend.id)
      .run();

    if (entry.score >= 4) {
      // Step 3: Google レビュー依頼 Flex（DB の message_content を使用 → 管理画面で URL 変更可能）
      const step3Row = await db
        .prepare(
          `SELECT ss.message_content FROM scenario_steps ss
           JOIN scenarios s ON s.id = ss.scenario_id
           WHERE s.name = '施術後アンケート' AND ss.step_order = 3 LIMIT 1`,
        )
        .first<{ message_content: string }>();

      // DB になければフォールバック（初期 seed と同一内容）
      const reviewContent = step3Row?.message_content ?? JSON.stringify({
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', paddingAll: '20px',
          contents: [
            { type: 'text', text: '嬉しいです😊 もしよろしければ、Googleでの口コミ投稿をお願いできますか？\n私たちの大きな励みになります🙏', size: 'sm', color: '#1e293b', wrap: true },
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '16px',
          contents: [
            { type: 'button', action: { type: 'uri', label: '口コミを書く', uri: 'https://g.page/r/CRwRXX3LUHkeEBE/review' }, style: 'primary', color: '#06C755' },
          ],
        },
      });

      await lineClient.replyMessage(replyToken, [buildMessage('flex', reviewContent)]);
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type, created_at)
           VALUES (?, ?, 'outgoing', 'flex', ?, 'reply', ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, reviewContent, now)
        .run();
    } else {
      // score < 4: お礼メッセージのみ
      await lineClient.replyMessage(replyToken, [{ type: 'text', text: entry.thankYou } as Message]);
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, delivery_type, created_at)
           VALUES (?, ?, 'outgoing', 'text', ?, 'reply', ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, entry.thankYou, now)
        .run();
    }

    await completeFriendScenario(db, survey.id);
  }
}

export { webhook };
