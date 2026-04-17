import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  updateBroadcastStatus,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import { buildSegmentQuery } from './segment-query.js';
import type { SegmentCondition } from './segment-query.js';

const MULTICAST_BATCH_SIZE = 500;

// 施術後アンケートシナリオ ID（seed で固定）
const SURVEY_SCENARIO_ID = 'a0000000-0000-4000-8000-000000000001';
// シナリオ待機センチネル（next_delivery_at をこの値にすることで Cron スキップ）
const SURVEY_SENTINEL = '9999-12-31T00:00:00+09:00';
// ブロードキャスト起点のアンケート同意メッセージ（QR 付き）
// TextMessage 型には quickReply が含まれないため unknown 経由でキャスト
const SURVEY_INVITE_MESSAGE = {
  type: 'text',
  text: '最後にひとつだけ、アンケートにご協力いただけますか？😊',
  quickReply: {
    items: [
      { type: 'action', action: { type: 'message', label: 'もちろん！', text: 'もちろん！' } },
      { type: 'action', action: { type: 'message', label: 'また今度',  text: 'また今度'  } },
    ],
  },
} as unknown as Message;

interface FriendRow {
  id: string;
  line_user_id: string;
}

export async function processSegmentSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  condition: SegmentCondition,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const message = buildMessage(broadcast.message_type, broadcast.message_content);

  let totalCount = 0;
  let successCount = 0;

  try {
    // Build and execute segment query to get matching friends
    const { sql, bindings } = buildSegmentQuery(condition);
    const queryResult = await db
      .prepare(sql)
      .bind(...bindings)
      .all<FriendRow>();

    const friends = queryResult.results ?? [];
    totalCount = friends.length;

    const now = jstNow();
    const totalBatches = Math.ceil(friends.length / MULTICAST_BATCH_SIZE);

    for (let i = 0; i < friends.length; i += MULTICAST_BATCH_SIZE) {
      const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
      const batch = friends.slice(i, i + MULTICAST_BATCH_SIZE);
      const lineUserIds = batch.map((f) => f.line_user_id);

      // Stealth: stagger delays between batches
      if (batchIndex > 0) {
        const delay = calculateStaggerDelay(friends.length, batchIndex);
        await sleep(delay);
      }

      // Stealth: add slight variation to text messages
      let batchMessage = message;
      if (message.type === 'text' && totalBatches > 1) {
        batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
      }

      // survey_followup = 1 の場合はアンケート同意QRを同梱する
      const messagesToSend: Message[] = [batchMessage];
      if (broadcast.survey_followup) {
        messagesToSend.push(SURVEY_INVITE_MESSAGE);
      }

      try {
        await lineClient.multicast(lineUserIds, messagesToSend);
        successCount += batch.length;

        // Log successfully sent messages & create survey enrollments
        for (const friend of batch) {
          const logId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
            )
            .bind(logId, friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now)
            .run();

          // アンケート導線あり → まだアクティブな enrollment がなければ step_order=0 で登録
          if (broadcast.survey_followup) {
            await db
              .prepare(
                `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
                 SELECT ?, ?, ?, 0, 'active', ?, ?, ?
                 WHERE NOT EXISTS (
                   SELECT 1 FROM friend_scenarios
                   WHERE friend_id = ? AND scenario_id = ? AND status = 'active'
                 )`,
              )
              .bind(
                crypto.randomUUID(), friend.id, SURVEY_SCENARIO_ID, now, SURVEY_SENTINEL, now,
                friend.id, SURVEY_SCENARIO_ID,
              )
              .run();
          }
        }
      } catch (err) {
        console.error(`Segment multicast batch ${batchIndex} failed:`, err);
        // Continue with next batch; failed batch is not logged
      }
    }

    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
  } catch (err) {
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  return { type: 'text', text: messageContent };
}
