import { Hono } from 'hono';
import {
  getScenarios,
  getScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  createScenarioStep,
  updateScenarioStep,
  deleteScenarioStep,
  enrollFriendInScenario,
  getFriendById,
  getScenarioSteps,
  advanceFriendScenario,
  jstNow,
} from '@line-crm/db';
import type {
  Scenario as DbScenario,
  ScenarioWithStepCount as DbScenarioWithStepCount,
  ScenarioStep as DbScenarioStep,
  FriendScenario as DbFriendScenario,
  ScenarioTriggerType,
  MessageType,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildMessage, expandVariables } from '../services/step-delivery.js';
import type { Env } from '../index.js';

const scenarios = new Hono<Env>();

/** Convert D1 snake_case Scenario row to shared camelCase shape */
function serializeScenario(row: DbScenario) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.trigger_type,
    triggerTagId: row.trigger_tag_id,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Convert D1 snake_case ScenarioStep row to shared camelCase shape */
function serializeStep(row: DbScenarioStep) {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    stepOrder: row.step_order,
    delayMinutes: row.delay_minutes,
    messageType: row.message_type,
    messageContent: row.message_content,
    conditionType: row.condition_type ?? null,
    conditionValue: row.condition_value ?? null,
    nextStepOnFalse: row.next_step_on_false ?? null,
    createdAt: row.created_at,
  };
}

/** Convert D1 snake_case FriendScenario row to shared camelCase shape */
function serializeFriendScenario(row: DbFriendScenario) {
  return {
    id: row.id,
    friendId: row.friend_id,
    scenarioId: row.scenario_id,
    currentStepOrder: row.current_step_order,
    status: row.status,
    startedAt: row.started_at,
    nextDeliveryAt: row.next_delivery_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/scenarios - list all
scenarios.get('/api/scenarios', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items: DbScenarioWithStepCount[];
    if (lineAccountId) {
      const result = await c.env.DB
        .prepare(
          `SELECT s.*, COUNT(ss.id) as step_count
           FROM scenarios s
           LEFT JOIN scenario_steps ss ON s.id = ss.scenario_id
           WHERE s.line_account_id = ? OR s.line_account_id IS NULL
           GROUP BY s.id
           ORDER BY s.created_at DESC`,
        )
        .bind(lineAccountId)
        .all<DbScenarioWithStepCount>();
      items = result.results;
    } else {
      items = await getScenarios(c.env.DB);
    }
    return c.json({
      success: true,
      data: items.map((row) => ({
        ...serializeScenario(row),
        stepCount: row.step_count,
      })),
    });
  } catch (err) {
    console.error('GET /api/scenarios error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/scenarios/:id - get with steps
scenarios.get('/api/scenarios/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const scenario = await getScenarioById(c.env.DB, id);

    if (!scenario) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...serializeScenario(scenario),
        steps: scenario.steps.map(serializeStep),
      },
    });
  } catch (err) {
    console.error('GET /api/scenarios/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios - create
scenarios.post('/api/scenarios', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      triggerType: ScenarioTriggerType;
      triggerTagId?: string | null;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    if (!body.name || !body.triggerType) {
      return c.json({ success: false, error: 'name and triggerType are required' }, 400);
    }

    let scenario = await createScenario(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      triggerType: body.triggerType,
      triggerTagId: body.triggerTagId ?? null,
    });

    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE scenarios SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, scenario.id).run();
    }

    // createScenario() always sets is_active=1; override if the caller requested inactive
    if (body.isActive === false) {
      const updated = await updateScenario(c.env.DB, scenario.id, { is_active: 0 });
      if (updated) scenario = updated;
    }

    return c.json({ success: true, data: serializeScenario(scenario) }, 201);
  } catch (err) {
    console.error('POST /api/scenarios error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/scenarios/:id - update (accepts camelCase fields from clients)
scenarios.put('/api/scenarios/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      triggerType?: ScenarioTriggerType;
      triggerTagId?: string | null;
      isActive?: boolean;
    }>();

    const updated = await updateScenario(c.env.DB, id, {
      name: body.name,
      description: body.description,
      trigger_type: body.triggerType,
      trigger_tag_id: body.triggerTagId,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }

    return c.json({ success: true, data: serializeScenario(updated) });
  } catch (err) {
    console.error('PUT /api/scenarios/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/scenarios/:id - delete
scenarios.delete('/api/scenarios/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteScenario(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scenarios/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios/:id/steps - add step
scenarios.post('/api/scenarios/:id/steps', async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const body = await c.req.json<{
      stepOrder: number;
      delayMinutes?: number;
      messageType: MessageType;
      messageContent: string;
      conditionType?: string | null;
      conditionValue?: string | null;
      nextStepOnFalse?: number | null;
    }>();

    if (body.stepOrder === undefined || !body.messageType || !body.messageContent) {
      return c.json(
        { success: false, error: 'stepOrder, messageType, and messageContent are required' },
        400,
      );
    }

    const step = await createScenarioStep(c.env.DB, {
      scenarioId,
      stepOrder: body.stepOrder,
      delayMinutes: body.delayMinutes ?? 0,
      messageType: body.messageType,
      messageContent: body.messageContent,
      conditionType: body.conditionType ?? null,
      conditionValue: body.conditionValue ?? null,
      nextStepOnFalse: body.nextStepOnFalse ?? null,
    });

    return c.json({ success: true, data: serializeStep(step) }, 201);
  } catch (err) {
    console.error('POST /api/scenarios/:id/steps error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/scenarios/:id/steps/:stepId - update step (accepts camelCase)
scenarios.put('/api/scenarios/:id/steps/:stepId', async (c) => {
  try {
    const stepId = c.req.param('stepId');
    const body = await c.req.json<{
      stepOrder?: number;
      delayMinutes?: number;
      messageType?: MessageType;
      messageContent?: string;
      conditionType?: string | null;
      conditionValue?: string | null;
      nextStepOnFalse?: number | null;
    }>();

    const updated = await updateScenarioStep(c.env.DB, stepId, {
      step_order: body.stepOrder,
      delay_minutes: body.delayMinutes,
      message_type: body.messageType,
      message_content: body.messageContent,
      condition_type: body.conditionType,
      condition_value: body.conditionValue,
      next_step_on_false: body.nextStepOnFalse,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Step not found' }, 404);
    }

    return c.json({ success: true, data: serializeStep(updated) });
  } catch (err) {
    console.error('PUT /api/scenarios/:id/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/scenarios/:id/steps/:stepId - delete step
scenarios.delete('/api/scenarios/:id/steps/:stepId', async (c) => {
  try {
    const stepId = c.req.param('stepId');
    await deleteScenarioStep(c.env.DB, stepId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scenarios/:id/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios/:id/enroll/:friendId - manually enroll friend
scenarios.post('/api/scenarios/:id/enroll/:friendId', async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    // Verify both exist
    const [scenario, friend] = await Promise.all([
      getScenarioById(db, scenarioId),
      getFriendById(db, friendId),
    ]);

    if (!scenario) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
    return c.json({ success: true, data: serializeFriendScenario(enrollment) }, 201);
  } catch (err) {
    console.error('POST /api/scenarios/:id/enroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios/trigger - 手動でシナリオ発火（Step 1 をすぐ push 送信し、返答待ち状態へ）
scenarios.post('/api/scenarios/trigger', async (c) => {
  try {
    const body = await c.req.json<{
      friendId: string;
      scenarioId?: string;
      scenarioName?: string;
    }>();

    if (!body.friendId) {
      return c.json({ success: false, error: 'friendId is required' }, 400);
    }

    const db = c.env.DB;

    // シナリオを名前または ID で取得
    let scenario: DbScenario | null = null;
    if (body.scenarioId) {
      scenario = await getScenarioById(db, body.scenarioId);
    } else if (body.scenarioName) {
      scenario = await db
        .prepare(`SELECT * FROM scenarios WHERE name = ? LIMIT 1`)
        .bind(body.scenarioName)
        .first<DbScenario>();
    }
    if (!scenario) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }

    // 友だちの存在確認
    const friend = await getFriendById(db, body.friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    // アクティブな既存エンロールがあればスキップ
    const existing = await db
      .prepare(
        `SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ? AND status = 'active'`,
      )
      .bind(friend.id, scenario.id)
      .first<{ id: string }>();
    if (existing) {
      return c.json({ success: false, error: 'Friend is already enrolled in this scenario' }, 409);
    }

    // エンロール（next_delivery_at = now が設定される）
    const enrollment = await enrollFriendInScenario(db, friend.id, scenario.id);

    const steps = await getScenarioSteps(db, scenario.id);
    const firstStep = steps[0];
    if (!firstStep) {
      // ステップなし → completed
      return c.json({ success: true, data: serializeFriendScenario(enrollment) });
    }

    // クロン配信と競合しないよう先に sentinel をセット
    const SENTINEL = '9999-12-31T00:00:00+09:00';
    await db
      .prepare(
        `UPDATE friend_scenarios SET next_delivery_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(SENTINEL, jstNow(), enrollment.id)
      .run();

    // Step 1 を即時 push 送信
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const expandedContent = expandVariables(
      firstStep.message_content,
      friend as { id: string; display_name: string | null; user_id: string | null },
      c.env.WORKER_URL,
    );
    const message = buildMessage(firstStep.message_type, expandedContent);
    await lineClient.pushMessage(friend.line_user_id, [message]);

    // 送信ログ
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'push', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        friend.id,
        firstStep.message_type,
        firstStep.message_content,
        firstStep.id,
        jstNow(),
      )
      .run();

    // current_step_order を Step 1 に進め、next_delivery_at は sentinel のまま（返答待ち）
    await advanceFriendScenario(db, enrollment.id, firstStep.step_order, SENTINEL);

    return c.json({
      success: true,
      data: { ...serializeFriendScenario(enrollment), currentStepOrder: firstStep.step_order },
    }, 201);
  } catch (err) {
    console.error('POST /api/scenarios/trigger error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { scenarios };
