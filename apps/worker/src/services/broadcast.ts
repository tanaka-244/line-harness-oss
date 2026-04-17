import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  getBroadcasts,
  updateBroadcastStatus,
  getFriendsByTag,
  getLineAccounts,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import { processSegmentSend } from './segment-send.js';
import type { SegmentCondition } from './segment-query.js';

/**
 * Resolve the correct LineClient for a broadcast.
 * If the broadcast has a line_account_id, look up the token from the DB.
 * Fall back to the environment default token only in single-account mode.
 */
async function resolveLineClient(
  db: D1Database,
  lineAccountId: string | null,
  defaultToken: string,
): Promise<LineClient> {
  if (lineAccountId) {
    const account = await getLineAccountById(db, lineAccountId);
    if (account?.channel_access_token) {
      return new LineClient(account.channel_access_token);
    }
    throw new Error(`LINE account ${lineAccountId} was not found for broadcast delivery`);
  }

  const accounts = await getLineAccounts(db);
  if (accounts.length > 0) {
    throw new Error('Broadcast delivery requires line_account_id in multi-account mode');
  }

  return new LineClient(defaultToken);
}

async function getTagName(
  db: D1Database,
  tagId: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT name FROM tags WHERE id = ?`)
    .bind(tagId)
    .first<{ name: string }>();
  return row?.name ?? null;
}

const MULTICAST_BATCH_SIZE = 500;

// 施術後アンケートシナリオ ID（seed で固定）
const SURVEY_SCENARIO_ID = 'a0000000-0000-4000-8000-000000000001';
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

export async function processBroadcastSend(
  db: D1Database,
  defaultToken: string,
  broadcastId: string,
  workerUrl?: string,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  // Resolve the correct LineClient for this broadcast's account
  const lineClient = await resolveLineClient(db, broadcast.line_account_id ?? null, defaultToken);

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl);
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  const message = buildMessage(finalType, finalContent, broadcast.alt_text || undefined);
  let totalCount = 0;
  let successCount = 0;

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      await lineClient.broadcast([message]);
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      // Filter friends by this broadcast's account to prevent cross-account leakage
      const friends = await getFriendsByTag(db, broadcast.target_tag_id, broadcast.line_account_id ?? null);
      const followingFriends = friends.filter((f) => f.is_following);
      const targetTagName = await getTagName(db, broadcast.target_tag_id);
      const recipientLineUserIds = followingFriends.map((f) => f.line_user_id);
      totalCount = followingFriends.length;

      console.log('[broadcast:delivery:recipients]', JSON.stringify({
        broadcastId: broadcast.id,
        targetTag: {
          id: broadcast.target_tag_id,
          name: targetTagName,
        },
        recipientCount: totalCount,
        recipientLineUserIds,
      }));

      // Send in batches with stealth delays to mimic human patterns
      const now = jstNow();
      const totalBatches = Math.ceil(followingFriends.length / MULTICAST_BATCH_SIZE);
      for (let i = 0; i < followingFriends.length; i += MULTICAST_BATCH_SIZE) {
        const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = followingFriends.slice(i, i + MULTICAST_BATCH_SIZE);
        const lineUserIds = batch.map((f) => f.line_user_id);

        // Stealth: add staggered delay between batches
        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(followingFriends.length, batchIndex);
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

          // Log only successfully sent messages & create survey enrollments
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
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // Continue with next batch; failed batch is not logged
        }
      }
    } else {
      // 'no_tags' and 'tag_exclude' must be dispatched through processSegmentSend, not this function.
      // Throwing here prevents silently marking as sent with 0 recipients.
      throw new Error(
        `target_type '${broadcast.target_type}' is not handled by processBroadcastSend; use processSegmentSend instead`,
      );
    }

    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
  } catch (err) {
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

/**
 * Process all due scheduled broadcasts.
 * Called ONCE per cron tick (not per account) — each broadcast resolves its own token
 * via broadcast.line_account_id to avoid double-sending across accounts.
 */
export async function processScheduledBroadcasts(
  db: D1Database,
  defaultToken: string,
  workerUrl?: string,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);

  const nowMs = Date.now();
  const scheduled = allBroadcasts.filter(
    (b) =>
      b.status === 'scheduled' &&
      b.scheduled_at !== null &&
      new Date(b.scheduled_at).getTime() <= nowMs,
  );

  for (const broadcast of scheduled) {
    try {
      if (broadcast.target_type === 'no_tags') {
        const condition: SegmentCondition = { operator: 'AND', rules: [{ type: 'no_tags', value: true }] };
        await processSegmentSend(db, defaultToken, broadcast.id, condition);
      } else if (broadcast.target_type === 'tag_exclude') {
        if (!broadcast.target_tag_id) {
          console.error(`Scheduled broadcast ${broadcast.id} has target_type=tag_exclude but no target_tag_id; skipping`);
          continue;
        }
        const condition: SegmentCondition = {
          operator: 'AND',
          rules: [{ type: 'tag_not_exists', value: broadcast.target_tag_id }],
        };
        await processSegmentSend(db, defaultToken, broadcast.id, condition);
      } else {
        // 'all' and 'tag' are handled by processBroadcastSend
        await processBroadcastSend(db, defaultToken, broadcast.id, workerUrl);
      }
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
      // Continue with next broadcast
    }
  }
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
