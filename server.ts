import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { requireAuth } from './src/middleware/auth.ts';
import type { AuthRequest } from './src/middleware/auth.ts';
import { updateCustomerPreferences } from './src/db/customers.ts';
import {
  acknowledgeOrderFeedback,
  advanceOrderStage,
  createOrderWithItems,
  findVectorMatchedVibes,
  getActiveQueueDepth,
  getActiveUserVibe,
  getCustomerByUid,
  getOrderByIdOrToken,
  insertAmbientLog,
  listAmbientLogs,
  listMenuItems,
  listOrderFeedback,
  listOrdersWithDetails,
  ORDER_STAGES,
  resolveAmbientLog,
  submitOrderFeedback,
  upsertCommunityVibe,
} from './src/db/repository.ts';
import type { OrderStage } from './src/db/repository.ts';
import {
  generateContextualIcebreaker,
  generateVibeEmbedding,
  matchConversationalPalate,
  predictCounterFlowWaitTime,
  triageAmbientPulse,
} from './src/lib/gemini.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// Real-time room-based WebSocket manager for live countdowns & KDS broadcasts
interface ActiveOrderState {
  orderId: string;
  orderCode: string;
  status: string;
  estimatedSeconds: number;
  remainingSeconds: number;
}

class CounterFlowSocketManager {
  private orderRooms = new Map<string, Set<WebSocket>>();
  private kdsClients = new Set<WebSocket>();
  private activeOrders = new Map<string, ActiveOrderState>();

  constructor() {
    // Authoritative 1-second timer ticker for active in-progress orders (purely in-memory, zero DB polling)
    setInterval(() => {
      for (const [orderId, state] of this.activeOrders.entries()) {
        if (
          state.status === 'READY_PICKUP' ||
          state.status === 'COMPLETED' ||
          state.remainingSeconds <= 0
        ) {
          continue;
        }
        state.remainingSeconds = Math.max(0, state.remainingSeconds - 1);
        const payload = JSON.stringify({
          type: 'timer:tick',
          orderId,
          orderCode: state.orderCode,
          status: state.status,
          estimatedSeconds: state.estimatedSeconds,
          remainingSeconds: state.remainingSeconds,
        });
        this.broadcastToOrder(orderId, payload);
        this.broadcastToKds(payload);
      }
    }, 1000);
  }

  trackOrder(state: ActiveOrderState) {
    if (state.status === 'COMPLETED' || state.status === 'READY_PICKUP') {
      this.activeOrders.delete(state.orderId);
      return;
    }
    this.activeOrders.set(state.orderId, { ...state });
  }

  getTrackedRemaining(orderId: string): number | null {
    return this.activeOrders.get(orderId)?.remainingSeconds ?? null;
  }

  joinOrderRoom(orderId: string, ws: WebSocket) {
    if (!this.orderRooms.has(orderId)) {
      this.orderRooms.set(orderId, new Set());
    }
    this.orderRooms.get(orderId)!.add(ws);
    ws.on('close', () => {
      const room = this.orderRooms.get(orderId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          this.orderRooms.delete(orderId);
        }
      }
    });
  }

  joinKds(ws: WebSocket) {
    this.kdsClients.add(ws);
    ws.on('close', () => {
      this.kdsClients.delete(ws);
    });
  }

  broadcastToOrder(orderId: string, payload: string) {
    const room = this.orderRooms.get(orderId);
    if (!room) return;
    for (const client of room) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  broadcastToKds(payload: string) {
    for (const client of this.kdsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

const wsManager = new CounterFlowSocketManager();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'cafe-companion-counterflow' });
  });

  // Customer Profile
  app.get('/api/customer/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const customer = await getCustomerByUid(req.user!.uid);
      res.json({ customer });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load profile';
      res.status(500).json({ error: message });
    }
  });

  // Live Cloud SQL Menu Inventory
  app.get('/api/menu', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const items = await listMenuItems();
      res.json({ items });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to load menu';
      res.status(500).json({ error: message });
    }
  });

  // Pillar B: Multimodal Conversational Palate & Receipt/Bean Scanner
  app.post('/api/palate/match', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { prompt, imageBase64, imageMimeType } = req.body as {
        prompt?: string;
        imageBase64?: string;
        imageMimeType?: string;
      };

      const cleanPrompt = (prompt || '').trim();
      if (!cleanPrompt && !imageBase64) {
        return res.status(400).json({ error: 'Provide a mood prompt or attach a photo to analyze.' });
      }

      const menu = await listMenuItems();
      const recommendation = await matchConversationalPalate({
        prompt:
          cleanPrompt ||
          'Analyze this attached café receipt, bean bag, or dietary allergen card and recommend tailored pairings from the live menu.',
        menu,
        imageBase64,
        imageMimeType,
      });

      if (recommendation.detectedDietaryLimits?.length > 0) {
        await updateCustomerPreferences(
          req.user!.uid,
          recommendation.detectedDietaryLimits,
          recommendation.inferredMood
        );
      }

      res.json({ recommendation });
    } catch (error: unknown) {
      console.error('Palate matching error:', error);
      const message = error instanceof Error ? error.message : 'Unable to generate palate recommendations.';
      res.status(500).json({ error: message });
    }
  });

  // Pillar A: Create Order (Mobile PWA or Walk-in Counter POS Handoff) + CounterFlow AI Wait-Time
  app.post('/api/orders', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { customerName, channel, tableCode, activeBaristas, items } = req.body as {
        customerName?: string;
        channel?: 'COUNTER_POS' | 'MOBILE_PWA';
        tableCode?: string;
        activeBaristas?: number;
        items?: Array<{ menuItemId: number; quantity: number; modifiers?: string }>;
      };

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Select at least one menu item to place an order.' });
      }

      const menu = await listMenuItems();
      const menuById = new Map(menu.map((m) => [m.id, m]));

      const resolvedItems = [];
      for (const reqItem of items) {
        const found = menuById.get(Number(reqItem.menuItemId));
        if (!found) {
          return res.status(400).json({ error: `Menu item #${reqItem.menuItemId} not found.` });
        }
        const qty = Math.max(1, Math.min(20, Math.round(Number(reqItem.quantity) || 1)));
        resolvedItems.push({
          menuItemId: found.id,
          itemName: found.name,
          quantity: qty,
          modifiers: (reqItem.modifiers || '').slice(0, 140),
          unitPriceCents: found.priceCents,
          prepComplexity: found.prepComplexity,
          basePrepSeconds: found.basePrepSeconds,
        });
      }

      const activeQueueDepth = await getActiveQueueDepth();
      const baristaCount = Math.max(1, Math.min(8, Number(activeBaristas) || 2));

      const waitPrediction = await predictCounterFlowWaitTime({
        items: resolvedItems.map((i) => ({
          name: i.itemName,
          quantity: i.quantity,
          prepComplexity: i.prepComplexity,
          basePrepSeconds: i.basePrepSeconds,
          modifiers: i.modifiers,
        })),
        activeQueueDepth,
        activeBaristas: baristaCount,
      });

      const safeChannel = channel === 'COUNTER_POS' ? 'COUNTER_POS' : 'MOBILE_PWA';
      const safeName =
        customerName?.trim() ||
        req.user?.name ||
        req.user?.email?.split('@')[0] ||
        'Walk-In Guest';

      const createdOrder = await createOrderWithItems({
        customerUid: req.user!.uid,
        customerName: safeName,
        channel: safeChannel,
        tableCode: tableCode?.trim(),
        items: resolvedItems,
        estimatedSeconds: waitPrediction.estimatedSeconds,
        complexityScore: waitPrediction.complexityScore,
        aiWaitReasoning: `${waitPrediction.recommendedStation}: ${waitPrediction.reasoning}`,
      });

      wsManager.trackOrder({
        orderId: createdOrder.id,
        orderCode: createdOrder.orderCode,
        status: createdOrder.status,
        estimatedSeconds: createdOrder.estimatedSeconds,
        remainingSeconds: createdOrder.remainingSeconds,
      });

      const eventPayload = JSON.stringify({
        type: 'order:created',
        order: createdOrder,
      });
      wsManager.broadcastToKds(eventPayload);

      res.status(201).json({ order: createdOrder });
    } catch (error: unknown) {
      console.error('Order creation error:', error);
      const message = error instanceof Error ? error.message : 'Unable to submit order.';
      res.status(500).json({ error: message });
    }
  });

  // List Orders (Active + Recent)
  app.get('/api/orders', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const orderList = await listOrdersWithDetails(24);
      const hydrated = orderList.map((order) => {
        const liveRemaining = wsManager.getTrackedRemaining(order.id);
        if (liveRemaining !== null) {
          return { ...order, remainingSeconds: liveRemaining };
        }
        if (
          order.status !== 'READY_PICKUP' &&
          order.status !== 'COMPLETED' &&
          order.remainingSeconds > 0
        ) {
          wsManager.trackOrder({
            orderId: order.id,
            orderCode: order.orderCode,
            status: order.status,
            estimatedSeconds: order.estimatedSeconds,
            remainingSeconds: order.remainingSeconds,
          });
        }
        return order;
      });
      res.json({ orders: hydrated });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to fetch orders.';
      res.status(500).json({ error: message });
    }
  });

  // Ephemeral POS QR Handoff Lookup
  app.get('/api/orders/handoff/:token', requireAuth, async (req: AuthRequest, res) => {
    try {
      const token = req.params.token;
      const order = await getOrderByIdOrToken({ handoffToken: token });
      if (!order) {
        return res.status(404).json({ error: 'Handoff session not found.' });
      }
      const liveRemaining = wsManager.getTrackedRemaining(order.id);
      res.json({
        order: liveRemaining !== null ? { ...order, remainingSeconds: liveRemaining } : order,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to look up order handoff.';
      res.status(500).json({ error: message });
    }
  });

  // Barista KDS Stage Transition
  app.patch('/api/orders/:id/stage', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = req.params.id;
      const { stage, baristaNote } = req.body as {
        stage?: string;
        baristaNote?: string;
      };

      if (!stage || !ORDER_STAGES.includes(stage as OrderStage)) {
        return res.status(400).json({ error: 'Invalid KDS ticket stage.' });
      }

      const updated = await advanceOrderStage(orderId, stage as OrderStage, baristaNote);
      if (!updated) {
        return res.status(404).json({ error: 'Order ticket not found.' });
      }

      wsManager.trackOrder({
        orderId: updated.id,
        orderCode: updated.orderCode,
        status: updated.status,
        estimatedSeconds: updated.estimatedSeconds,
        remainingSeconds: updated.remainingSeconds,
      });

      const payload = JSON.stringify({
        type: 'order:stage_updated',
        order: updated,
      });
      wsManager.broadcastToOrder(updated.id, payload);
      wsManager.broadcastToKds(payload);

      res.json({ order: updated });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to advance KDS stage.';
      res.status(500).json({ error: message });
    }
  });

  // Post-Completion Order Feedback -> Persisted in Cloud SQL & Broadcast Live to KDS
  app.get('/api/feedback', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const feedback = await listOrderFeedback(24);
      res.json({ feedback });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to load patron feedback.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/orders/:id/feedback', requireAuth, async (req: AuthRequest, res) => {
    try {
      const orderId = req.params.id;
      const { drinkQualityRating, serviceExperienceRating, comment } = req.body as {
        drinkQualityRating?: number;
        serviceExperienceRating?: number;
        comment?: string;
      };

      const drinkScore = Math.round(Number(drinkQualityRating));
      const serviceScore = Math.round(Number(serviceExperienceRating));
      if (
        Number.isNaN(drinkScore) ||
        Number.isNaN(serviceScore) ||
        drinkScore < 1 ||
        drinkScore > 5 ||
        serviceScore < 1 ||
        serviceScore > 5
      ) {
        return res
          .status(400)
          .json({ error: 'Provide both drink quality and service experience ratings from 1 to 5.' });
      }

      const order = await getOrderByIdOrToken({ id: orderId });
      if (!order) {
        return res.status(404).json({ error: 'Order ticket not found.' });
      }

      if (order.status !== 'READY_PICKUP' && order.status !== 'COMPLETED') {
        return res
          .status(400)
          .json({ error: 'Feedback opens once your order is ready for pickup or completed.' });
      }

      const saved = await submitOrderFeedback({
        orderId: order.id,
        orderCode: order.orderCode,
        customerName: order.customerName,
        drinkQualityRating: drinkScore,
        serviceExperienceRating: serviceScore,
        comment: (comment || '').trim().slice(0, 500),
      });

      wsManager.broadcastToKds(
        JSON.stringify({
          type: 'kds:feedback_received',
          feedback: saved,
        })
      );

      res.status(201).json({ feedback: saved });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to submit order feedback.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/feedback/:id/acknowledge', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid feedback ID.' });
      }
      const updated = await acknowledgeOrderFeedback(id);
      if (!updated) {
        return res.status(404).json({ error: 'Feedback record not found.' });
      }
      wsManager.broadcastToKds(
        JSON.stringify({
          type: 'kds:feedback_acknowledged',
          feedback: updated,
        })
      );
      res.json({ feedback: updated });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to acknowledge feedback.';
      res.status(500).json({ error: message });
    }
  });

  // Pillar C: Table Connect Opt-In + 768-dim pgvector Embedding
  app.post('/api/table-connect/opt-in', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { tableZone, focusTag, focusDescription, openToConnect, displayName } = req.body as {
        tableZone?: string;
        focusTag?: string;
        focusDescription?: string;
        openToConnect?: boolean;
        displayName?: string;
      };

      if (!tableZone?.trim() || !focusTag?.trim() || !focusDescription?.trim()) {
        return res.status(400).json({ error: 'Table zone, focus tag, and description are required.' });
      }

      const embeddingText = `${focusTag.trim()}. ${focusDescription.trim()}. Zone: ${tableZone.trim()}`;
      const embedding = await generateVibeEmbedding(embeddingText);

      const vibe = await upsertCommunityVibe({
        customerUid: req.user!.uid,
        displayName:
          displayName?.trim() ||
          req.user?.name ||
          req.user?.email?.split('@')[0] ||
          'Café Patron',
        tableZone: tableZone.trim(),
        focusTag: focusTag.trim(),
        focusDescription: focusDescription.trim(),
        openToConnect: openToConnect !== false,
        embedding,
      });

      const matches = await findVectorMatchedVibes(req.user!.uid, embedding);
      res.status(201).json({
        myVibe: {
          id: vibe.id,
          displayName: vibe.displayName,
          tableZone: vibe.tableZone,
          focusTag: vibe.focusTag,
          focusDescription: vibe.focusDescription,
          openToConnect: vibe.openToConnect,
          expiresAt: vibe.expiresAt,
        },
        matches,
      });
    } catch (error: unknown) {
      console.error('Table Connect opt-in error:', error);
      const message = error instanceof Error ? error.message : 'Unable to publish Table Connect tag.';
      res.status(500).json({ error: message });
    }
  });

  // Pillar C: Query pgvector Cosine Matches
  app.get('/api/table-connect/matches', requireAuth, async (req: AuthRequest, res) => {
    try {
      const myVibe = await getActiveUserVibe(req.user!.uid);
      const matches = await findVectorMatchedVibes(req.user!.uid, myVibe?.embedding ?? null);
      res.json({
        myVibe: myVibe
          ? {
              id: myVibe.id,
              displayName: myVibe.displayName,
              tableZone: myVibe.tableZone,
              focusTag: myVibe.focusTag,
              focusDescription: myVibe.focusDescription,
              openToConnect: myVibe.openToConnect,
              expiresAt: myVibe.expiresAt,
            }
          : null,
        matches,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to load Table Connect matches.';
      res.status(500).json({ error: message });
    }
  });

  // Pillar C: Contextual Icebreaker Generation
  app.post('/api/table-connect/icebreaker', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { peerName, peerZone, peerFocusTag, peerFocusDescription } = req.body as {
        peerName?: string;
        peerZone?: string;
        peerFocusTag?: string;
        peerFocusDescription?: string;
      };

      const myVibe = await getActiveUserVibe(req.user!.uid);
      if (!myVibe) {
        return res.status(400).json({ error: 'Set your own 2-hour table focus tag first to generate an icebreaker.' });
      }

      const icebreaker = await generateContextualIcebreaker({
        myFocusTag: myVibe.focusTag,
        myFocusDescription: myVibe.focusDescription,
        peerName: peerName || 'Neighboring Patron',
        peerZone: peerZone || 'Café Floor',
        peerFocusTag: peerFocusTag || 'Working',
        peerFocusDescription: peerFocusDescription || '',
      });

      res.json({ icebreaker });
    } catch (error: unknown) {
      console.error('Icebreaker generation error:', error);
      const message = error instanceof Error ? error.message : 'Unable to generate icebreaker.';
      res.status(500).json({ error: message });
    }
  });

  // Pillar D: Ambient Vibe & Operations Pulse
  app.get('/api/ambient', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const logs = await listAmbientLogs(25);
      res.json({ logs });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to load ambient logs.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ambient/report', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { zone, decibels, feedbackType, rawMessage } = req.body as {
        zone?: string;
        decibels?: number | null;
        feedbackType?: string;
        rawMessage?: string;
      };

      if (!zone?.trim() || !rawMessage?.trim()) {
        return res.status(400).json({ error: 'Zone and feedback message are required.' });
      }

      const safeType = feedbackType?.trim() || 'SERVICE';
      const parsedDb =
        decibels !== undefined && decibels !== null && !Number.isNaN(Number(decibels))
          ? Number(decibels)
          : null;

      const triage = await triageAmbientPulse({
        zone: zone.trim(),
        decibels: parsedDb,
        feedbackType: safeType,
        rawMessage: rawMessage.trim(),
      });

      const saved = await insertAmbientLog({
        zone: zone.trim(),
        decibels: parsedDb,
        feedbackType: safeType,
        rawMessage: rawMessage.trim(),
        severity: triage.severity,
        aiCategory: triage.aiCategory,
        aiCorrectiveAction: triage.aiCorrectiveAction,
      });

      wsManager.broadcastToKds(
        JSON.stringify({
          type: 'ambient:alert',
          log: saved,
        })
      );

      res.status(201).json({ log: saved });
    } catch (error: unknown) {
      console.error('Ambient triage error:', error);
      const message = error instanceof Error ? error.message : 'Unable to triage ambient report.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/ambient/:id/resolve', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid log ID.' });
      }
      const resolved = await resolveAmbientLog(id);
      if (!resolved) {
        return res.status(404).json({ error: 'Telemetry alert not found.' });
      }
      wsManager.broadcastToKds(
        JSON.stringify({
          type: 'ambient:resolved',
          log: resolved,
        })
      );
      res.json({ log: resolved });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to resolve telemetry alert.';
      res.status(500).json({ error: message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = request.url ? request.url.split('?')[0] : '';
    const orderMatch = urlPath.match(/^\/ws\/orders\/([a-zA-Z0-9-]+)$/);
    if (orderMatch) {
      const orderId = orderMatch[1];
      wss.handleUpgrade(request, socket, head, (ws) => {
        wsManager.joinOrderRoom(orderId, ws);
        ws.send(JSON.stringify({ type: 'ws:connected', channel: `order:${orderId}` }));
      });
      return;
    }

    if (urlPath === '/ws/kds') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wsManager.joinKds(ws);
        ws.send(JSON.stringify({ type: 'ws:connected', channel: 'kds' }));
      });
      return;
    }

    socket.destroy();
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Café Companion server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
