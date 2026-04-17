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
  getLineAccountById,
} from '@line-crm/db';
import type {
  Scenario as DbScenario,
  ScenarioWithSteps as DbScenarioWithSteps,
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
const SURVEY_SCENARIO_ID = 'a0000000-0000-4000-8000-000000000001';
const SURVEY_SCENARIO_NAME = '施術後アンケート';
const SURVEY_SENTINEL = '9999-12-31T00:00:00+09:00';

async function ensurePostTreatmentSurveyScenario(db: D1Database): Promise<DbScenarioWithSteps | null> {
  let scenario = await getScenarioById(db, SURVEY_SCENARIO_ID);
  if (!scenario) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', NULL, 1, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
      )
      .bind(
        SURVEY_SCENARIO_ID,
        SURVEY_SCENARIO_NAME,
        '施術後に患者の満足度を確認し、高評価の場合はGoogleレビューを依頼する',
      )
      .run();
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
       VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
    )
    .bind(
      'b0000000-0000-4000-8000-000000000001',
      SURVEY_SCENARIO_ID,
      1,
      'text',
      '{"text":"いつもご来院ありがとうございます😊\\n少しだけアンケートにご協力いただけますか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"もちろん！","text":"もちろん！"}},{"type":"action","action":{"type":"message","label":"また今度","text":"また今度"}}]}}',
    )
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
       VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
    )
    .bind(
      'b0000000-0000-4000-8000-000000000002',
      SURVEY_SCENARIO_ID,
      2,
      'text',
      '{"text":"施術を受けて、症状はいかがでしたか？","quickReply":{"items":[{"type":"action","action":{"type":"message","label":"とても良くなった👍","text":"とても良くなった👍"}},{"type":"action","action":{"type":"message","label":"少し良くなった","text":"少し良くなった"}},{"type":"action","action":{"type":"message","label":"変わらない","text":"変わらない"}},{"type":"action","action":{"type":"message","label":"悪くなった","text":"悪くなった"}}]}}',
    )
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, condition_type, condition_value, next_step_on_false, created_at)
       VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))`,
    )
    .bind(
      'b0000000-0000-4000-8000-000000000003',
      SURVEY_SCENARIO_ID,
      3,
      'flex',
      '{"type":"bubble","body":{"type":"box","layout":"vertical","paddingAll":"20px","contents":[{"type":"text","text":"嬉しいです😊 もしよろしければ、Googleでの口コミ投稿をお願いできますか？\\n私たちの大きな励みになります🙏","size":"sm","color":"#1e293b","wrap":true}]},"footer":{"type":"box","layout":"vertical","paddingAll":"16px","contents":[{"type":"button","action":{"type":"uri","label":"口コミを書く","uri":"https://g.page/r/CRwRXX3LUHkeEBE/review"},"style":"primary","color":"#06C755"}]}}',
    )
    .run();

  scenario = await getScenarioById(db, SURVEY_SCENARIO_ID);
  return scenario;
}

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

// POST /api/scenarios/trigger - manually trigger a scenario and send its first step immediately
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
    if (!body.scenarioId && !body.scenarioName) {
      return c.json({ success: false, error: 'scenarioId or scenarioName is required' }, 400);
    }

    const db = c.env.DB;

    let scenario: DbScenarioWithSteps | null = null;
    if (body.scenarioId) {
      scenario = await getScenarioById(db, body.scenarioId);
    } else if (body.scenarioName) {
      if (body.scenarioName === SURVEY_SCENARIO_NAME) {
        scenario = await ensurePostTreatmentSurveyScenario(db);
      }
      const scenarioRow = await db
        .prepare(`SELECT id FROM scenarios WHERE name = ? LIMIT 1`)
        .bind(body.scenarioName)
        .first<{ id: string }>();
      if (!scenario && scenarioRow?.id) {
        scenario = await getScenarioById(db, scenarioRow.id);
      }
    }

    if (!scenario) {
      console.error('POST /api/scenarios/trigger: scenario not found', body);
      return c.json({
        success: false,
        error: 'Scenario not found: 施術後アンケートのシナリオがDBにありません。013_survey_scenario.sql を適用してください。',
      }, 404);
    }

    const friend = await getFriendById(db, body.friendId);
    if (!friend) {
      console.error('POST /api/scenarios/trigger: friend not found', body);
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const existing = await db
      .prepare(
        `SELECT id, current_step_order, next_delivery_at, status FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ? AND status = 'active'`,
      )
      .bind(friend.id, scenario.id)
      .first<{ id: string; current_step_order: number; next_delivery_at: string | null; status: string }>();

    const steps = scenario.steps.length > 0 ? scenario.steps : await getScenarioSteps(db, scenario.id);
    const firstStep = steps[0];
    if (existing) {
      if (!firstStep) {
        return c.json({
          success: true,
          data: { id: existing.id, friendId: friend.id, scenarioId: scenario.id, currentStepOrder: existing.current_step_order, status: existing.status, startedAt: '', nextDeliveryAt: existing.next_delivery_at, updatedAt: '' },
        });
      }
    }

    const enrollment = existing
      ? {
          id: existing.id,
          friend_id: friend.id,
          scenario_id: scenario.id,
          current_step_order: existing.current_step_order,
          status: existing.status as DbFriendScenario['status'],
          started_at: '',
          next_delivery_at: existing.next_delivery_at,
          updated_at: '',
        }
      : await enrollFriendInScenario(db, friend.id, scenario.id);

    if (!firstStep) {
      return c.json({ success: true, data: serializeFriendScenario(enrollment) }, 201);
    }

    await db
      .prepare(`UPDATE friend_scenarios SET next_delivery_at = ?, updated_at = ? WHERE id = ?`)
      .bind(SURVEY_SENTINEL, jstNow(), enrollment.id)
      .run();

    let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    const scenarioLineAccountId = scenario.line_account_id;
    const friendLineAccountId = (friend as typeof friend & { line_account_id?: string | null }).line_account_id ?? null;
    const lineAccountId = scenarioLineAccountId ?? friendLineAccountId;
    if (lineAccountId) {
      const account = await getLineAccountById(db, lineAccountId);
      if (account?.channel_access_token) {
        accessToken = account.channel_access_token;
      }
    }

    const lineClient = new LineClient(accessToken);
    const expandedContent = expandVariables(
      firstStep.message_content,
      friend as { id: string; display_name: string | null; user_id: string | null; ref_code?: string | null },
      c.env.WORKER_URL,
    );
    const message = buildMessage(firstStep.message_type, expandedContent);
    await lineClient.pushMessage(friend.line_user_id, [message]);

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

    await advanceFriendScenario(db, enrollment.id, firstStep.step_order, SURVEY_SENTINEL);

    return c.json({
      success: true,
      data: { ...serializeFriendScenario(enrollment), currentStepOrder: firstStep.step_order, nextDeliveryAt: SURVEY_SENTINEL },
    }, 201);
  } catch (err) {
    console.error('POST /api/scenarios/trigger error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

export { scenarios };
