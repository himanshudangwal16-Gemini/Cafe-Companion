import crypto from 'crypto';
import { and, cosineDistance, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  ambientTelemetryLogs,
  communityVibes,
  customers,
  kdsTicketStages,
  menuItems,
  orderFeedback,
  orderItems,
  orders,
} from './schema.ts';

export const ORDER_STAGES = [
  'GRINDING_EXTRACTION',
  'STEAMING_POUR',
  'QUALITY_PLATING',
  'READY_PICKUP',
  'COMPLETED',
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

export async function listMenuItems() {
  try {
    return await db
      .select()
      .from(menuItems)
      .orderBy(menuItems.category, menuItems.id);
  } catch (error) {
    console.error('Failed to list menu items:', error);
    throw new Error('Unable to load café menu right now.', { cause: error });
  }
}

export async function getCustomerByUid(uid: string) {
  try {
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.uid, uid))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to fetch customer:', error);
    throw new Error('Unable to load customer profile.', { cause: error });
  }
}

export async function getActiveQueueDepth(): Promise<number> {
  try {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        inArray(orders.status, [
          'GRINDING_EXTRACTION',
          'STEAMING_POUR',
          'QUALITY_PLATING',
        ])
      );
    return rows[0]?.count ?? 0;
  } catch (error) {
    console.error('Failed to compute active queue depth:', error);
    throw new Error('Unable to read live bar queue.', { cause: error });
  }
}

export async function createOrderWithItems(params: {
  customerUid: string;
  customerName: string;
  channel: 'COUNTER_POS' | 'MOBILE_PWA';
  tableCode?: string;
  items: Array<{
    menuItemId: number;
    itemName: string;
    quantity: number;
    modifiers: string;
    unitPriceCents: number;
  }>;
  estimatedSeconds: number;
  complexityScore: number;
  aiWaitReasoning: string;
}) {
  const shortNum = Math.floor(1000 + Math.random() * 8999);
  const prefix = params.channel === 'COUNTER_POS' ? 'POS' : 'PWA';
  const orderCode = `${prefix}-${shortNum}`;
  const handoffToken = crypto.randomBytes(12).toString('hex');
  const totalCents = params.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );

  try {
    const insertedOrders = await db
      .insert(orders)
      .values({
        orderCode,
        customerUid: params.customerUid,
        customerName: params.customerName,
        channel: params.channel,
        tableCode: params.tableCode || null,
        status: 'GRINDING_EXTRACTION',
        estimatedSeconds: params.estimatedSeconds,
        remainingSeconds: params.estimatedSeconds,
        complexityScore: params.complexityScore,
        aiWaitReasoning: params.aiWaitReasoning,
        totalCents,
        handoffToken,
      })
      .returning();

    const order = insertedOrders[0];

    const insertedItems = await db
      .insert(orderItems)
      .values(
        params.items.map((item) => ({
          orderId: order.id,
          menuItemId: item.menuItemId,
          itemName: item.itemName,
          quantity: item.quantity,
          modifiers: item.modifiers,
          unitPriceCents: item.unitPriceCents,
        }))
      )
      .returning();

    const insertedStages = await db
      .insert(kdsTicketStages)
      .values({
        orderId: order.id,
        stage: 'GRINDING_EXTRACTION',
        baristaNote:
          params.channel === 'COUNTER_POS'
            ? 'Injected from Counter POS with dynamic QR handoff'
            : 'Submitted via Mobile PWA',
        slaTargetSeconds: Math.max(45, Math.round(params.estimatedSeconds * 0.35)),
      })
      .returning();

    // Decrement stock counts safely
    for (const item of params.items) {
      await db
        .update(menuItems)
        .set({
          stockCount: sql`GREATEST(0, ${menuItems.stockCount} - ${item.quantity})`,
        })
        .where(eq(menuItems.id, item.menuItemId));
    }

    return {
      ...order,
      items: insertedItems,
      stages: insertedStages,
    };
  } catch (error) {
    console.error('Failed to create order:', error);
    throw new Error('Unable to create order ticket.', { cause: error });
  }
}

export async function listOrdersWithDetails(limitCount = 24) {
  try {
    const orderRows = await db
      .select()
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(limitCount);

    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((o) => o.id);
    const [itemRows, stageRows] = await Promise.all([
      db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
      db
        .select()
        .from(kdsTicketStages)
        .where(inArray(kdsTicketStages.orderId, orderIds))
        .orderBy(kdsTicketStages.startedAt),
    ]);

    return orderRows.map((order) => ({
      ...order,
      items: itemRows.filter((i) => i.orderId === order.id),
      stages: stageRows.filter((s) => s.orderId === order.id),
    }));
  } catch (error) {
    console.error('Failed to list orders:', error);
    throw new Error('Unable to fetch active orders.', { cause: error });
  }
}

export async function getOrderByIdOrToken(identifier: { id?: string; handoffToken?: string }) {
  try {
    const condition = identifier.id
      ? eq(orders.id, identifier.id)
      : eq(orders.handoffToken, identifier.handoffToken ?? '');
    const rows = await db.select().from(orders).where(condition).limit(1);
    const order = rows[0];
    if (!order) return null;

    const [items, stages] = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
      db
        .select()
        .from(kdsTicketStages)
        .where(eq(kdsTicketStages.orderId, order.id))
        .orderBy(kdsTicketStages.startedAt),
    ]);

    return { ...order, items, stages };
  } catch (error) {
    console.error('Failed to retrieve order:', error);
    throw new Error('Unable to look up order ticket.', { cause: error });
  }
}

export async function advanceOrderStage(
  orderId: string,
  nextStage: OrderStage,
  baristaNote?: string
) {
  try {
    const existing = await getOrderByIdOrToken({ id: orderId });
    if (!existing) return null;

    const now = new Date();
    const openStages = existing.stages.filter((s) => !s.completedAt);
    for (const s of openStages) {
      await db
        .update(kdsTicketStages)
        .set({ completedAt: now })
        .where(eq(kdsTicketStages.id, s.id));
    }

    const stageRatio: Record<OrderStage, number> = {
      GRINDING_EXTRACTION: 1,
      STEAMING_POUR: 0.62,
      QUALITY_PLATING: 0.25,
      READY_PICKUP: 0,
      COMPLETED: 0,
    };

    const nextRemaining = Math.round(existing.estimatedSeconds * stageRatio[nextStage]);

    await db.insert(kdsTicketStages).values({
      orderId,
      stage: nextStage,
      startedAt: now,
      completedAt: nextStage === 'COMPLETED' ? now : null,
      baristaNote: baristaNote?.trim() || `Transitioned to ${nextStage}`,
      slaTargetSeconds: 60,
    });

    await db
      .update(orders)
      .set({
        status: nextStage,
        remainingSeconds: nextRemaining,
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));

    return await getOrderByIdOrToken({ id: orderId });
  } catch (error) {
    console.error('Failed to advance order stage:', error);
    throw new Error('Unable to update order stage.', { cause: error });
  }
}

export async function upsertCommunityVibe(params: {
  customerUid: string;
  displayName: string;
  tableZone: string;
  focusTag: string;
  focusDescription: string;
  openToConnect: boolean;
  embedding: number[];
}) {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  try {
    // Replace any previous active check-in for this user to keep table presence clean
    await db
      .delete(communityVibes)
      .where(eq(communityVibes.customerUid, params.customerUid));

    const inserted = await db
      .insert(communityVibes)
      .values({
        customerUid: params.customerUid,
        displayName: params.displayName,
        tableZone: params.tableZone,
        focusTag: params.focusTag,
        focusDescription: params.focusDescription,
        openToConnect: params.openToConnect,
        embedding: params.embedding,
        expiresAt,
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Failed to upsert community vibe:', error);
    throw new Error('Unable to publish table focus tag.', { cause: error });
  }
}

export async function getActiveUserVibe(customerUid: string) {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(communityVibes)
      .where(
        and(
          eq(communityVibes.customerUid, customerUid),
          gt(communityVibes.expiresAt, now)
        )
      )
      .orderBy(desc(communityVibes.createdAt))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to fetch user vibe:', error);
    throw new Error('Unable to fetch active table session.', { cause: error });
  }
}

export async function findVectorMatchedVibes(
  customerUid: string,
  queryEmbedding?: number[] | null
) {
  try {
    const now = new Date();
    if (queryEmbedding && queryEmbedding.length === 768) {
      const similarity = sql<number>`1 - (${cosineDistance(communityVibes.embedding, queryEmbedding)})`;
      const rows = await db
        .select({
          id: communityVibes.id,
          customerUid: communityVibes.customerUid,
          displayName: communityVibes.displayName,
          tableZone: communityVibes.tableZone,
          focusTag: communityVibes.focusTag,
          focusDescription: communityVibes.focusDescription,
          openToConnect: communityVibes.openToConnect,
          expiresAt: communityVibes.expiresAt,
          createdAt: communityVibes.createdAt,
          similarity,
        })
        .from(communityVibes)
        .where(
          and(
            gt(communityVibes.expiresAt, now),
            ne(communityVibes.customerUid, customerUid)
          )
        )
        .orderBy(desc(similarity))
        .limit(12);
      return rows;
    }

    const rows = await db
      .select({
        id: communityVibes.id,
        customerUid: communityVibes.customerUid,
        displayName: communityVibes.displayName,
        tableZone: communityVibes.tableZone,
        focusTag: communityVibes.focusTag,
        focusDescription: communityVibes.focusDescription,
        openToConnect: communityVibes.openToConnect,
        expiresAt: communityVibes.expiresAt,
        createdAt: communityVibes.createdAt,
      })
      .from(communityVibes)
      .where(
        and(
          gt(communityVibes.expiresAt, now),
          ne(communityVibes.customerUid, customerUid)
        )
      )
      .orderBy(desc(communityVibes.createdAt))
      .limit(12);

    return rows.map((r) => ({ ...r, similarity: null as number | null }));
  } catch (error) {
    console.error('Failed to query community vibes:', error);
    throw new Error('Unable to load nearby Table Connect patrons.', {
      cause: error,
    });
  }
}

export async function listAmbientLogs(limitCount = 25) {
  try {
    return await db
      .select()
      .from(ambientTelemetryLogs)
      .orderBy(desc(ambientTelemetryLogs.createdAt))
      .limit(limitCount);
  } catch (error) {
    console.error('Failed to list ambient telemetry logs:', error);
    throw new Error('Unable to load ambient operations logs.', { cause: error });
  }
}

export async function insertAmbientLog(params: {
  zone: string;
  decibels: number | null;
  feedbackType: string;
  rawMessage: string;
  severity: string;
  aiCategory: string;
  aiCorrectiveAction: string;
}) {
  try {
    const inserted = await db
      .insert(ambientTelemetryLogs)
      .values({
        zone: params.zone,
        decibels: params.decibels,
        feedbackType: params.feedbackType,
        rawMessage: params.rawMessage,
        severity: params.severity,
        aiCategory: params.aiCategory,
        aiCorrectiveAction: params.aiCorrectiveAction,
        resolved: false,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Failed to save ambient telemetry:', error);
    throw new Error('Unable to log ambient feedback.', { cause: error });
  }
}

export async function resolveAmbientLog(id: number) {
  try {
    const updated = await db
      .update(ambientTelemetryLogs)
      .set({ resolved: true })
      .where(eq(ambientTelemetryLogs.id, id))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Failed to resolve ambient log:', error);
    throw new Error('Unable to mark alert resolved.', { cause: error });
  }
}

export async function submitOrderFeedback(params: {
  orderId: string;
  orderCode: string;
  customerName: string;
  drinkQualityRating: number;
  serviceExperienceRating: number;
  comment: string;
}) {
  try {
    const inserted = await db
      .insert(orderFeedback)
      .values({
        orderId: params.orderId,
        orderCode: params.orderCode,
        customerName: params.customerName,
        drinkQualityRating: params.drinkQualityRating,
        serviceExperienceRating: params.serviceExperienceRating,
        comment: params.comment,
        acknowledgedByKds: false,
      })
      .onConflictDoUpdate({
        target: orderFeedback.orderId,
        set: {
          drinkQualityRating: params.drinkQualityRating,
          serviceExperienceRating: params.serviceExperienceRating,
          comment: params.comment,
          acknowledgedByKds: false,
        },
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Failed to submit order feedback:', error);
    throw new Error('Unable to save your order feedback.', { cause: error });
  }
}

export async function listOrderFeedback(limitCount = 24) {
  try {
    return await db
      .select()
      .from(orderFeedback)
      .orderBy(desc(orderFeedback.createdAt))
      .limit(limitCount);
  } catch (error) {
    console.error('Failed to list order feedback:', error);
    throw new Error('Unable to load patron feedback.', { cause: error });
  }
}

export async function acknowledgeOrderFeedback(id: number) {
  try {
    const updated = await db
      .update(orderFeedback)
      .set({ acknowledgedByKds: true })
      .where(eq(orderFeedback.id, id))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Failed to acknowledge order feedback:', error);
    throw new Error('Unable to acknowledge feedback on KDS.', { cause: error });
  }
}
