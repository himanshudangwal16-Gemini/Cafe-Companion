import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, CheckCircle2, Clock, Plus, Printer, QrCode, Star, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { CafeOrder, MenuItem, OrderFeedback } from '../types';

interface BaristaKdsViewProps {
  menu: MenuItem[];
  orders: CafeOrder[];
  feedbackList: OrderFeedback[];
  onRefreshOrders: () => Promise<void>;
  onOrderCreated: (order: CafeOrder) => void;
  onOrderUpdated: (order: CafeOrder) => void;
  onFeedbackAcknowledged: (feedback: OrderFeedback) => void;
  onSimulatePatronScan: (order: CafeOrder) => void;
}

const STAGE_FLOW: Array<{
  key: CafeOrder['status'];
  label: string;
  next?: CafeOrder['status'];
  nextLabel?: string;
}> = [
  {
    key: 'GRINDING_EXTRACTION',
    label: 'Grinding & Extraction',
    next: 'STEAMING_POUR',
    nextLabel: 'Move to Steaming',
  },
  {
    key: 'STEAMING_POUR',
    label: 'Steaming & Pour',
    next: 'QUALITY_PLATING',
    nextLabel: 'Move to Quality Check',
  },
  {
    key: 'QUALITY_PLATING',
    label: 'Quality & Plating',
    next: 'READY_PICKUP',
    nextLabel: 'Mark Ready at Pass',
  },
  {
    key: 'READY_PICKUP',
    label: 'Ready at Pickup',
    next: 'COMPLETED',
    nextLabel: 'Complete Handoff',
  },
];

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export const BaristaKdsView: React.FC<BaristaKdsViewProps> = ({
  menu,
  orders,
  feedbackList,
  onRefreshOrders,
  onOrderCreated,
  onOrderUpdated,
  onFeedbackAcknowledged,
  onSimulatePatronScan,
}) => {
  const { user, signIn, authFetch } = useAuth();

  // Walk-in POS Injector state
  const [guestName, setGuestName] = useState('Maya Lin');
  const [tableCode, setTableCode] = useState('Walk-In Counter');
  const [activeBaristas, setActiveBaristas] = useState(2);
  const [selectedItemId, setSelectedItemId] = useState<number>(menu[0]?.id || 1);
  const [modifiers, setModifiers] = useState('Oat milk, extra hot');
  const [injecting, setInjecting] = useState(false);
  const [posSlip, setPosSlip] = useState<CafeOrder | null>(null);
  const [kdsError, setKdsError] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [ackingFeedbackId, setAckingFeedbackId] = useState<number | null>(null);

  useEffect(() => {
    if (menu.length > 0 && !menu.some((m) => m.id === selectedItemId)) {
      setSelectedItemId(menu[0].id);
    }
  }, [menu, selectedItemId]);

  const handleInjectPosTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      await signIn();
      return;
    }
    setInjecting(true);
    setKdsError(null);
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: guestName.trim() || 'Walk-In Guest',
          channel: 'COUNTER_POS',
          tableCode: tableCode.trim() || undefined,
          activeBaristas,
          items: [
            {
              menuItemId: selectedItemId,
              quantity: 1,
              modifiers: modifiers.trim(),
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inject POS ticket');
      setPosSlip(data.order);
      onOrderCreated(data.order);
    } catch (err: unknown) {
      setKdsError(err instanceof Error ? err.message : 'POS injection failed.');
    } finally {
      setInjecting(false);
    }
  };

  const handleAdvanceStage = async (order: CafeOrder, nextStage: CafeOrder['status']) => {
    if (!user) return;
    setUpdatingOrderId(order.id);
    setKdsError(null);
    try {
      const res = await authFetch(`/api/orders/${order.id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: nextStage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update KDS stage');
      onOrderUpdated(data.order);
      if (posSlip?.id === data.order.id) {
        setPosSlip(data.order);
      }
    } catch (err: unknown) {
      setKdsError(err instanceof Error ? err.message : 'Unable to update stage.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleAcknowledgeFeedback = async (id: number) => {
    if (!user) return;
    setAckingFeedbackId(id);
    setKdsError(null);
    try {
      const res = await authFetch(`/api/feedback/${id}/acknowledge`, {
        method: 'PATCH',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to acknowledge feedback');
      onFeedbackAcknowledged(data.feedback);
    } catch (err: unknown) {
      setKdsError(err instanceof Error ? err.message : 'Unable to acknowledge feedback.');
    } finally {
      setAckingFeedbackId(null);
    }
  };

  const avgDrinkQuality =
    feedbackList.length > 0
      ? (
          feedbackList.reduce((sum, f) => sum + f.drinkQualityRating, 0) /
          feedbackList.length
        ).toFixed(1)
      : '—';
  const avgServiceExp =
    feedbackList.length > 0
      ? (
          feedbackList.reduce((sum, f) => sum + f.serviceExperienceRating, 0) /
          feedbackList.length
        ).toFixed(1)
      : '—';
  const unacknowledgedCount = feedbackList.filter((f) => !f.acknowledgedByKds).length;

  const activeOrders = orders.filter((o) => o.status !== 'COMPLETED');
  const completedOrders = orders.filter((o) => o.status === 'COMPLETED').slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-neutral-500">
            Pillar A · Omnichannel POS Handoff &amp; Kitchen Display System
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[#14171A]">
            Barista KDS &amp; Counter POS
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Key in walk-in counter orders to mint an instant QR handoff slip, then drive live ticket stages across all connected patron lock screens.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-neutral-600 shrink-0">
          <span className="font-mono tabular-nums">
            Active Queue: <strong className="text-[#14171A]">{activeOrders.length}</strong>
          </span>
          <button
            type="button"
            onClick={onRefreshOrders}
            disabled={!user}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Sync Queue
          </button>
        </div>
      </div>

      {!user && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-[#14171A]">
              Sign in to operate the Counter POS &amp; Barista KDS
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              Tickets are persisted with stage SLA timestamps and broadcast over WebSockets in real time.
            </p>
          </div>
          <button
            type="button"
            onClick={signIn}
            className="rounded-lg bg-[#1B4332] px-4 py-2 text-xs font-medium text-white hover:bg-[#143326] whitespace-nowrap shrink-0"
          >
            Sign In with Google
          </button>
        </div>
      )}

      {/* Counter POS Walk-In Injector + Printed Dynamic QR Receipt */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleInjectPosTicket}
          className="rounded-xl border border-neutral-200 bg-white p-6 space-y-4 lg:col-span-7"
        >
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h2 className="font-display text-xl font-semibold text-[#14171A]">
              Walk-In Counter POS Register
            </h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <Users className="h-3.5 w-3.5" />
              {activeBaristas} baristas on bar
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pos-guest" className="block text-xs font-medium text-neutral-600">
                Patron Name
              </label>
              <input
                id="pos-guest"
                type="text"
                required
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="pos-baristas" className="block text-xs font-medium text-neutral-600">
                Active Barista Staffing
              </label>
              <select
                id="pos-baristas"
                value={activeBaristas}
                onChange={(e) => setActiveBaristas(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count} {count === 1 ? 'Barista' : 'Baristas'} on bar
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="pos-item" className="block text-xs font-medium text-neutral-600">
                Menu Item
              </label>
              <select
                id="pos-item"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
              >
                {menu.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} (${(item.priceCents / 100).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="pos-mod" className="block text-xs font-medium text-neutral-600">
                Chit Modifiers
              </label>
              <input
                id="pos-mod"
                type="text"
                value={modifiers}
                onChange={(e) => setModifiers(e.target.value)}
                placeholder="e.g., Oat milk, 65°C, no syrup"
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <input
              type="text"
              value={tableCode}
              onChange={(e) => setTableCode(e.target.value)}
              aria-label="Counter or table code"
              className="rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-xs text-[#14171A] focus:border-[#1B4332] focus:outline-none"
            />
            <button
              type="submit"
              disabled={injecting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1B4332] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#143326] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              {injecting ? 'Computing CounterFlow ETA...' : 'Fire POS Ticket & Print QR Slip'}
            </button>
          </div>

          {kdsError && <p className="text-xs text-[#DC2626]">{kdsError}</p>}
        </form>

        {/* Dynamic QR Counter Receipt Preview */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 lg:col-span-5 flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h2 className="font-display text-lg font-semibold text-[#14171A]">
              Counter Thermal Slip Preview
            </h2>
            <Printer className="h-4 w-4 text-neutral-500" />
          </div>

          {posSlip ? (
            <div className="mt-4 flex flex-1 flex-col items-center justify-between text-center space-y-4">
              <div>
                <p className="font-mono text-xs text-neutral-500">
                  TICKET {posSlip.orderCode} · {posSlip.customerName}
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  {posSlip.items.map((i) => `${i.quantity}× ${i.itemName}`).join(', ')}
                </p>
                <p className="mt-1 font-mono text-xs text-[#1B4332]">
                  CounterFlow ETA: {formatDuration(posSlip.estimatedSeconds)} · Complexity {posSlip.complexityScore}/5
                </p>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-[#F8F9FA] p-3">
                <QRCodeSVG
                  value={`${window.location.origin}/?handoff=${posSlip.handoffToken}`}
                  size={120}
                  bgColor="#F8F9FA"
                  fgColor="#14171A"
                />
              </div>

              <button
                type="button"
                onClick={() => onSimulatePatronScan(posSlip)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#14171A] bg-white px-4 py-2 text-xs font-medium text-[#14171A] hover:bg-[#14171A] hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                <QrCode className="h-3.5 w-3.5" />
                Simulate Patron QR Scan
              </button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
              <QrCode className="h-8 w-8 text-neutral-300" />
              <p className="mt-2 text-xs text-neutral-500 max-w-xs">
                Fire a walk-in POS ticket to generate a dynamic QR handoff code linking the counter slip to an ephemeral patron WebSocket session.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Live 4-Column Barista KDS Board */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl font-semibold text-[#14171A]">
          Live Ticket Queue
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STAGE_FLOW.map((col) => {
            const colOrders = activeOrders.filter((o) => o.status === col.key);
            return (
              <div
                key={col.key}
                className="flex flex-col rounded-xl border border-neutral-200 bg-white"
              >
                <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
                  <h3 className="text-xs font-semibold text-[#14171A]">{col.label}</h3>
                  <span className="font-mono text-xs font-medium tabular-nums text-neutral-500">
                    {colOrders.length}
                  </span>
                </div>

                <div className="flex-1 divide-y divide-neutral-100 p-2">
                  {colOrders.length === 0 ? (
                    <p className="py-10 text-center text-xs text-neutral-400">
                      No tickets in stage
                    </p>
                  ) : (
                    colOrders.map((order) => (
                      <div key={order.id} className="p-3 space-y-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-sm font-semibold text-[#14171A]">
                            {order.orderCode}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums ${
                              order.status === 'READY_PICKUP'
                                ? 'text-[#16A34A]'
                                : order.remainingSeconds <= 45
                                ? 'text-[#D97706]'
                                : 'text-[#1B4332]'
                            }`}
                          >
                            <Clock className="h-3 w-3" />
                            {order.status === 'READY_PICKUP'
                              ? 'Ready'
                              : formatDuration(order.remainingSeconds)}
                          </span>
                        </div>

                        <p className="text-xs text-neutral-500">
                          {order.customerName} · {order.channel === 'COUNTER_POS' ? 'POS' : 'PWA'}
                          {order.tableCode ? ` · ${order.tableCode}` : ''}
                        </p>

                        <ul className="space-y-1 text-xs text-[#14171A]">
                          {order.items.map((item) => (
                            <li key={item.id}>
                              <span className="font-mono font-medium">{item.quantity}×</span>{' '}
                              {item.itemName}
                              {item.modifiers && (
                                <span className="block text-[11px] text-neutral-500">
                                  Note: {item.modifiers}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                        {order.aiWaitReasoning && (
                          <p className="text-[11px] leading-snug text-neutral-500">
                            {order.aiWaitReasoning}
                          </p>
                        )}

                        {col.next && (
                          <button
                            type="button"
                            disabled={updatingOrderId === order.id}
                            onClick={() => handleAdvanceStage(order, col.next!)}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#14171A] px-3 py-2 text-xs font-medium text-white hover:bg-[#1B4332] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                          >
                            <span>{col.nextLabel}</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Live Post-Completion Patron Feedback Feed */}
      <section className="rounded-xl border border-neutral-200 bg-white p-6 space-y-5">
        <div className="flex flex-col gap-3 border-b border-neutral-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-neutral-500">
              Post-Completion Quality Loop · Live from Counter View
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#14171A]">
              Patron Drink &amp; Service Ratings
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-neutral-600 font-mono tabular-nums">
            <span>
              Drink Avg: <strong className="text-[#14171A]">{avgDrinkQuality}</strong>/5
            </span>
            <span>
              Service Avg: <strong className="text-[#14171A]">{avgServiceExp}</strong>/5
            </span>
            <span>
              Unreviewed: <strong className="text-[#1B4332]">{unacknowledgedCount}</strong>
            </span>
          </div>
        </div>

        {feedbackList.length === 0 ? (
          <p className="py-8 text-center text-xs text-neutral-500">
            No post-completion ratings submitted yet. Mark an order Ready at Pickup or Completed to enable customer ratings in the Counter view.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {feedbackList.map((fb) => {
              const lowest = Math.min(fb.drinkQualityRating, fb.serviceExperienceRating);
              const sentimentLabel =
                lowest <= 2
                  ? 'Needs Follow-Up'
                  : lowest === 3
                  ? 'Mixed Feedback'
                  : 'Positive';
              const sentimentClass =
                lowest <= 2
                  ? 'text-[#DC2626] font-semibold'
                  : lowest === 3
                  ? 'text-[#D97706] font-medium'
                  : 'text-[#16A34A] font-medium';

              return (
                <div
                  key={fb.id}
                  className={`py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                    fb.acknowledgedByKds ? 'opacity-65' : ''
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#14171A]">
                        {fb.orderCode}
                      </span>
                      <span className="text-neutral-500">
                        · {fb.customerName} ·{' '}
                        {new Date(fb.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className={sentimentClass}>· {sentimentLabel}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-[#14171A]">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-[#1B4332] text-[#1B4332]" />
                        Drink Quality: <strong>{fb.drinkQualityRating}/5</strong>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-[#1B4332] text-[#1B4332]" />
                        Service Experience: <strong>{fb.serviceExperienceRating}/5</strong>
                      </span>
                    </div>

                    {fb.comment && (
                      <p className="text-sm text-neutral-700">“{fb.comment}”</p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {fb.acknowledgedByKds ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A34A] whitespace-nowrap">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Acknowledged
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={ackingFeedbackId === fb.id || !user}
                        onClick={() => handleAcknowledgeFeedback(fb.id)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:border-[#1B4332] hover:text-[#1B4332] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        {ackingFeedbackId === fb.id ? 'Saving...' : 'Acknowledge'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {completedOrders.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white p-5">
          <h3 className="text-xs font-semibold text-neutral-500">Recently Completed Handoffs</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {completedOrders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between text-xs text-neutral-600 border-b border-neutral-100 pb-2"
              >
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#16A34A]" />
                  <strong className="font-mono text-[#14171A]">{o.orderCode}</strong> · {o.customerName}
                </span>
                <span className="font-mono tabular-nums text-neutral-500">
                  ${(o.totalCents / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
