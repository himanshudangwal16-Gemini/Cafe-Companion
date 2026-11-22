import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Camera,
  Check,
  Clock,
  Coffee,
  Minus,
  Plus,
  Send,
  ShoppingBag,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { HERO_BAR_IMAGE } from '../data/previewCatalog';
import { CafeOrder, MenuItem, OrderFeedback, PalateRecommendation } from '../types';

interface CartLine {
  item: MenuItem;
  quantity: number;
  modifiers: string;
}

interface CounterMenuViewProps {
  menu: MenuItem[];
  orders: CafeOrder[];
  activeOrder: CafeOrder | null;
  feedbackList: OrderFeedback[];
  onOrderCreated: (order: CafeOrder) => void;
  onOrderUpdated: (order: CafeOrder) => void;
  onFeedbackSubmitted: (feedback: OrderFeedback) => void;
  onJumpToKds: () => void;
}

const PHASE_STEPS = [
  { key: 'GRINDING_EXTRACTION', label: 'Grinding & Extraction', sub: 'Single-origin dial-in' },
  { key: 'STEAMING_POUR', label: 'Steaming & Pour', sub: 'Microfoam & latte art' },
  { key: 'QUALITY_PLATING', label: 'Quality & Plating', sub: 'Final tasting check' },
  { key: 'READY_PICKUP', label: 'Ready at Counter', sub: 'Waiting at pickup pass' },
];

function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const ProductImage: React.FC<{ src: string; alt: string; className?: string }> = ({
  src,
  alt,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-neutral-100 text-neutral-500 ${className}`}
      >
        <Coffee className="h-8 w-8 stroke-[1.5]" />
        <span className="mt-2 text-xs font-medium">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

export const CounterMenuView: React.FC<CounterMenuViewProps> = ({
  menu,
  orders,
  activeOrder,
  feedbackList,
  onOrderCreated,
  onOrderUpdated,
  onFeedbackSubmitted,
  onJumpToKds,
}) => {
  const { user, signIn, authFetch } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tableCode, setTableCode] = useState('Table 4');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Post-completion rating state
  const [drinkRating, setDrinkRating] = useState<number>(5);
  const [serviceRating, setServiceRating] = useState<number>(5);
  const [feedbackComment, setFeedbackComment] = useState<string>('');
  const [submittingFeedback, setSubmittingFeedback] = useState<boolean>(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Pillar B: Multimodal Palate Discovery state
  const [palatePrompt, setPalatePrompt] = useState('');
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [uploadedBase64, setUploadedBase64] = useState<string | null>(null);
  const [uploadedMime, setUploadedMime] = useState<string | null>(null);
  const [palateLoading, setPalateLoading] = useState(false);
  const [palateError, setPalateError] = useState<string | null>(null);
  const [palateResult, setPalateResult] = useState<PalateRecommendation | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Real-time WebSocket subscription for active order countdown & stage changes
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    if (!activeOrder?.id) {
      setWsConnected(false);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/orders/${activeOrder.id}`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => setWsConnected(true);
    socket.onclose = () => setWsConnected(false);
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'timer:tick' && msg.orderId === activeOrder.id) {
          onOrderUpdated({
            ...activeOrder,
            remainingSeconds: msg.remainingSeconds,
            status: msg.status,
          });
        } else if (msg.type === 'order:stage_updated' && msg.order?.id === activeOrder.id) {
          onOrderUpdated(msg.order);
        }
      } catch {
        // Ignore malformed frame
      }
    };

    return () => {
      socket.close();
    };
  }, [activeOrder?.id, activeOrder?.status]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(menu.map((m) => m.category)));
    return ['All', ...unique];
  }, [menu]);

  const filteredMenu = useMemo(() => {
    if (selectedCategory === 'All') return menu;
    return menu.filter((item) => item.category === selectedCategory);
  }, [menu, selectedCategory]);

  const cartCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart]
  );
  const cartTotalCents = useMemo(
    () => cart.reduce((sum, line) => sum + line.item.priceCents * line.quantity, 0),
    [cart]
  );

  const addToCart = (item: MenuItem, modifier = '') => {
    setCart((prev) => {
      const existing = prev.find(
        (line) => line.item.id === item.id && line.modifiers === modifier
      );
      if (existing) {
        return prev.map((line) =>
          line.item.id === item.id && line.modifiers === modifier
            ? { ...line, quantity: line.quantity + 1 }
            : line
        );
      }
      return [...prev, { item, quantity: 1, modifiers: modifier }];
    });
  };

  const updateCartQty = (index: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((line, i) =>
          i === index ? { ...line, quantity: line.quantity + delta } : line
        )
        .filter((line) => line.quantity > 0)
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const [, base64] = dataUrl.split(',');
      setUploadedPreview(dataUrl);
      setUploadedBase64(base64 || null);
      setUploadedMime(file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
  };

  const handlePalateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      await signIn();
      return;
    }
    setPalateError(null);
    setPalateLoading(true);
    try {
      const res = await authFetch('/api/palate/match', {
        method: 'POST',
        body: JSON.stringify({
          prompt: palatePrompt,
          imageBase64: uploadedBase64 || undefined,
          imageMimeType: uploadedMime || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not match your palate right now.');
      }
      setPalateResult(data.recommendation);
    } catch (err: unknown) {
      setPalateError(err instanceof Error ? err.message : 'Palate request failed.');
    } finally {
      setPalateLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!user) {
      await signIn();
      return;
    }
    if (cart.length === 0) return;

    setOrderError(null);
    setSubmittingOrder(true);
    try {
      const res = await authFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: user.displayName || user.email?.split('@')[0] || 'Café Patron',
          channel: 'MOBILE_PWA',
          tableCode: tableCode.trim() || undefined,
          activeBaristas: 2,
          items: cart.map((line) => ({
            menuItemId: line.item.id,
            quantity: line.quantity,
            modifiers: line.modifiers,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Order submission failed.');
      }
      onOrderCreated(data.order);
      setCart([]);
      setDrawerOpen(false);
    } catch (err: unknown) {
      setOrderError(err instanceof Error ? err.message : 'Unable to submit order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const activePhaseIndex = activeOrder
    ? Math.max(
        0,
        PHASE_STEPS.findIndex((p) => p.key === activeOrder.status)
      )
    : -1;

  const handoffUrl = activeOrder
    ? `${window.location.origin}/?handoff=${activeOrder.handoffToken}`
    : '';

  // Identify the most relevant ready/completed order eligible for post-completion feedback
  const ratableOrder = useMemo(() => {
    if (
      activeOrder &&
      (activeOrder.status === 'READY_PICKUP' || activeOrder.status === 'COMPLETED')
    ) {
      return activeOrder;
    }
    return (
      orders.find((o) => o.status === 'COMPLETED' || o.status === 'READY_PICKUP') ||
      null
    );
  }, [activeOrder, orders]);

  const existingFeedback = useMemo(() => {
    if (!ratableOrder) return null;
    return feedbackList.find((f) => f.orderId === ratableOrder.id) || null;
  }, [ratableOrder, feedbackList]);

  useEffect(() => {
    if (existingFeedback) {
      setDrinkRating(existingFeedback.drinkQualityRating);
      setServiceRating(existingFeedback.serviceExperienceRating);
      setFeedbackComment(existingFeedback.comment);
    } else {
      setDrinkRating(5);
      setServiceRating(5);
      setFeedbackComment('');
    }
    setFeedbackError(null);
  }, [ratableOrder?.id, existingFeedback?.id]);

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ratableOrder) return;
    if (!user) {
      await signIn();
      return;
    }
    setSubmittingFeedback(true);
    setFeedbackError(null);
    try {
      const res = await authFetch(`/api/orders/${ratableOrder.id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          drinkQualityRating: drinkRating,
          serviceExperienceRating: serviceRating,
          comment: feedbackComment.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not send feedback to the bar.');
      }
      onFeedbackSubmitted(data.feedback);
    } catch (err: unknown) {
      setFeedbackError(
        err instanceof Error ? err.message : 'Unable to submit order feedback.'
      );
    } finally {
      setSubmittingFeedback(false);
    }
  };

  return (
    <div className="space-y-12">
      {/* Editorial Split Hero */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
        <div className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-8 lg:col-span-6 lg:p-10">
          <div>
            <p className="text-xs font-medium tracking-wide text-neutral-500">
              VibeCraft &amp; CounterFlow · Specialty Roastery Bar
            </p>
            <h1 className="mt-4 max-w-xl font-display text-4xl font-semibold leading-[1.12] tracking-tight text-[#14171A] [text-wrap:balance] sm:text-5xl">
              Crafted to your exact mood, tracked to the second.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-neutral-600">
              Describe your focus session or scan a past café receipt for tailored single-origin pairings. Walk-in counter slips and mobile orders stay synchronized in real time from grind to pickup pass.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 pt-6 border-t border-neutral-100">
            <a
              href="#palate-sommelier"
              className="inline-flex items-center justify-center rounded-lg bg-[#1B4332] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#143326] transition-colors whitespace-nowrap shrink-0"
            >
              Ask VibeCraft Sommelier
            </a>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium text-[#14171A] hover:bg-neutral-50 transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Order Tray ({cartCount})</span>
            </button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-900 lg:col-span-6 min-h-[320px]">
          <ProductImage
            src={HERO_BAR_IMAGE}
            alt="Minimalist specialty coffee bar with pour-over drippers and stainless espresso machine"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-6 text-white">
            <p className="text-xs text-neutral-200">
              Single-Origin Slow Bar · Live Queue Orchestration
            </p>
            <p className="mt-1 font-display text-xl font-medium">
              Zero-app QR handoff from counter register to your lock screen.
            </p>
          </div>
        </div>
      </section>

      {/* Active CounterFlow Live Order Tracker (Pillar A) */}
      {activeOrder && (
        <section className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex-1 space-y-5">
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-neutral-100 pb-4">
                <div>
                  <p className="text-xs text-neutral-500">
                    Active Ticket · {activeOrder.channel === 'COUNTER_POS' ? 'Counter POS Handoff' : 'Mobile PWA'}
                    {activeOrder.tableCode ? ` · ${activeOrder.tableCode}` : ''}
                    {wsConnected ? ' · Live stream synced' : ''}
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-semibold text-[#14171A]">
                    Order <span className="font-mono">{activeOrder.orderCode}</span> for {activeOrder.customerName}
                  </h2>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-neutral-500">CounterFlow Estimate</p>
                  <p className="font-mono text-3xl font-semibold tabular-nums text-[#1B4332]">
                    {activeOrder.status === 'READY_PICKUP' || activeOrder.status === 'COMPLETED'
                      ? 'Ready'
                      : formatDuration(activeOrder.remainingSeconds)}
                  </p>
                </div>
              </div>

              {/* 4-Stage Visual Progression */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                {PHASE_STEPS.map((phase, idx) => {
                  const isCompleted = activeOrder.status === 'COMPLETED' || idx < activePhaseIndex;
                  const isCurrent = activeOrder.status !== 'COMPLETED' && idx === activePhaseIndex;
                  return (
                    <div
                      key={phase.key}
                      className={`rounded-lg border p-3.5 transition-colors ${
                        isCurrent
                          ? 'border-[#1B4332] bg-[#1B4332]/5'
                          : isCompleted
                          ? 'border-neutral-200 bg-neutral-50'
                          : 'border-neutral-200 bg-white opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="font-mono tabular-nums text-neutral-500">0{idx + 1}</span>
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 text-[#16A34A]">
                            <Check className="h-3.5 w-3.5" /> Done
                          </span>
                        ) : isCurrent ? (
                          <span className="text-[#1B4332] font-semibold">In Progress</span>
                        ) : (
                          <span className="text-neutral-400">Queued</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[#14171A]">{phase.label}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">{phase.sub}</p>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-sm text-neutral-600">
                <p className="max-w-2xl">
                  <span className="font-medium text-[#14171A]">Wait-Time Analysis:</span>{' '}
                  {activeOrder.aiWaitReasoning || 'Calculated from live ticket depth and drink complexity.'}
                </p>
                <button
                  type="button"
                  onClick={onJumpToKds}
                  className="text-xs font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#143326] whitespace-nowrap shrink-0"
                >
                  Advance ticket on Barista KDS
                </button>
              </div>
            </div>

            {/* Dynamic QR Handoff Card */}
            <div className="flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-[#F8F9FA] p-5 lg:w-56 shrink-0">
              <QRCodeSVG value={handoffUrl} size={132} bgColor="#F8F9FA" fgColor="#14171A" />
              <p className="mt-3 text-center text-xs font-medium text-[#14171A]">
                Scan for Live Lock-Screen Sync
              </p>
              <p className="mt-1 font-mono text-[11px] text-neutral-500">
                {activeOrder.orderCode} · {formatPrice(activeOrder.totalCents)}
              </p>
            </div>
          </div>

          {activeOrder.status !== 'READY_PICKUP' && activeOrder.status !== 'COMPLETED' && (
            <p className="mt-5 border-t border-neutral-100 pt-4 text-xs text-neutral-500">
              Post-completion rating opens here as soon as your ticket reaches Ready at Counter or Completed.
            </p>
          )}
        </section>
      )}

      {/* Post-Completion Drink Quality & Service Experience Feedback Form -> KDS */}
      {ratableOrder && (
        <section
          aria-labelledby="feedback-heading"
          className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-8"
        >
          <div className="flex flex-col gap-2 border-b border-neutral-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500">
                Post-Completion Feedback · Order{' '}
                <span className="font-mono">{ratableOrder.orderCode}</span> ·{' '}
                {ratableOrder.status === 'COMPLETED' ? 'Completed' : 'Ready at Pickup'}
              </p>
              <h2
                id="feedback-heading"
                className="mt-1 font-display text-2xl font-semibold text-[#14171A]"
              >
                Rate your drink quality &amp; counter service
              </h2>
            </div>
            <button
              type="button"
              onClick={onJumpToKds}
              className="text-xs font-medium text-[#1B4332] underline underline-offset-4 hover:text-[#143326] whitespace-nowrap shrink-0"
            >
              View live ratings on Barista KDS
            </button>
          </div>

          {existingFeedback ? (
            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-[#16A34A] flex items-center gap-1.5">
                  <Check className="h-4 w-4" />
                  Feedback delivered to Barista KDS
                </p>
                <p className="text-xs text-neutral-600 font-mono tabular-nums">
                  Drink Quality: <strong className="text-[#14171A]">{existingFeedback.drinkQualityRating}/5</strong>
                  {' · '}
                  Service Experience:{' '}
                  <strong className="text-[#14171A]">{existingFeedback.serviceExperienceRating}/5</strong>
                  {existingFeedback.acknowledgedByKds ? ' · Acknowledged by bar team' : ' · Live on KDS board'}
                </p>
                {existingFeedback.comment && (
                  <p className="text-sm text-neutral-700">“{existingFeedback.comment}”</p>
                )}
              </div>
              <p className="text-xs text-neutral-500 shrink-0">
                Thank you for helping us dial in every pour.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmitFeedback} className="mt-6 space-y-5">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Drink Quality Rating */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-[#14171A]">Drink Quality</span>
                    <span className="font-mono text-xs tabular-nums text-[#1B4332] font-semibold">
                      {drinkRating} / 5
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Extraction balance, milk microfoam texture, and serving temperature
                  </p>
                  <div className="flex items-center gap-1.5 pt-1" role="radiogroup" aria-label="Drink quality rating">
                    {[1, 2, 3, 4, 5].map((value) => {
                      const active = value <= drinkRating;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDrinkRating(value)}
                          aria-label={`Rate drink quality ${value} out of 5`}
                          aria-checked={drinkRating === value}
                          role="radio"
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                            active
                              ? 'border-[#1B4332] bg-[#1B4332]/10 text-[#1B4332]'
                              : 'border-neutral-200 bg-[#F8F9FA] text-neutral-400 hover:border-neutral-300'
                          }`}
                        >
                          <Star className={`h-4 w-4 ${active ? 'fill-current' : ''}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Service Experience Rating */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-[#14171A]">
                      Service Experience
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#1B4332] font-semibold">
                      {serviceRating} / 5
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Counter hospitality, pickup pass clarity, and wait-time accuracy
                  </p>
                  <div className="flex items-center gap-1.5 pt-1" role="radiogroup" aria-label="Service experience rating">
                    {[1, 2, 3, 4, 5].map((value) => {
                      const active = value <= serviceRating;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setServiceRating(value)}
                          aria-label={`Rate service experience ${value} out of 5`}
                          aria-checked={serviceRating === value}
                          role="radio"
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                            active
                              ? 'border-[#1B4332] bg-[#1B4332]/10 text-[#1B4332]'
                              : 'border-neutral-200 bg-[#F8F9FA] text-neutral-400 hover:border-neutral-300'
                          }`}
                        >
                          <Star className={`h-4 w-4 ${active ? 'fill-current' : ''}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="order-feedback-comment"
                  className="block text-xs font-medium text-neutral-600"
                >
                  Tasting or Service Note (sent directly to the bar team)
                </label>
                <textarea
                  id="order-feedback-comment"
                  rows={2}
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  placeholder="Optional note on extraction, temperature, or counter pickup..."
                  className="w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3.5 py-2.5 text-sm text-[#14171A] placeholder:text-neutral-400 focus:border-[#1B4332] focus:bg-white focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    'Silky microfoam & spot-on extraction',
                    'Fast QR handoff and warm pickup',
                    'Slightly lukewarm — needed hotter steam',
                  ].map((note) => (
                    <button
                      key={note}
                      type="button"
                      onClick={() => setFeedbackComment(note)}
                      className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:border-neutral-300 hover:text-[#14171A] transition-colors"
                    >
                      {note}
                    </button>
                  ))}
                </div>
              </div>

              {feedbackError && <p className="text-xs text-[#DC2626]">{feedbackError}</p>}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-neutral-500">
                  Items: {ratableOrder.items.map((i) => `${i.quantity}× ${i.itemName}`).join(', ')}
                </p>
                <button
                  type="submit"
                  disabled={submittingFeedback}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1B4332] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#143326] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submittingFeedback ? 'Sending to KDS...' : 'Send Rating to Barista KDS'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Pillar B: Multimodal Conversational Palate & Receipt/Bean Scanner */}
      <section
        id="palate-sommelier"
        className="rounded-xl border border-neutral-200 bg-white p-6 sm:p-8"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between border-b border-neutral-100 pb-5">
          <div>
            <p className="text-xs font-medium text-neutral-500">
              01. VibeCraft Multimodal Sommelier
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-[#14171A]">
              Describe your session, palate, or scan a past receipt
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>Reconciled against live in-stock menu inventory</span>
          </div>
        </div>

        <form onSubmit={handlePalateSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <label htmlFor="palate-input" className="sr-only">
                Describe your drink and food preferences
              </label>
              <textarea
                id="palate-input"
                rows={3}
                value={palatePrompt}
                onChange={(e) => setPalatePrompt(e.target.value)}
                placeholder="Example: I need a low-acidity iced brew that won't spike my anxiety during a 2-hour financial modeling session, plus a gluten-free savory snack."
                className="w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-4 py-3 text-sm text-[#14171A] placeholder:text-neutral-400 focus:border-[#1B4332] focus:bg-white focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  'Low-acidity iced brew for 2h financial modeling + gluten-free savory snack',
                  'Velvety oat espresso drink with nutty sweetness for a rainy morning',
                  'Calm afternoon L-theanine focus pairing with light citrus notes',
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setPalatePrompt(sample)}
                    className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:border-neutral-300 hover:text-[#14171A] transition-colors text-left"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-col justify-between rounded-lg border border-dashed border-neutral-300 bg-[#F8F9FA] p-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              {uploadedPreview ? (
                <div className="relative flex items-center gap-3">
                  <img
                    src={uploadedPreview}
                    alt="Uploaded receipt or coffee bean photo"
                    className="h-16 w-16 rounded-md object-cover border border-neutral-200"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[#14171A] truncate">
                      Visual reference attached
                    </p>
                    <p className="text-xs text-neutral-500">
                      Ready for receipt, bean, or allergen parsing
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedPreview(null);
                      setUploadedBase64(null);
                      setUploadedMime(null);
                    }}
                    className="rounded-md p-1 text-neutral-500 hover:bg-neutral-200 hover:text-[#14171A]"
                    aria-label="Remove attached photo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start justify-between h-full gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#14171A] flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-neutral-600" />
                      Receipt, Bean Bag, or Allergen Scan
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Upload a photo of a previous café receipt or roast label to personalize pairings.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 whitespace-nowrap shrink-0"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Attach Photo
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={palateLoading}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1B4332] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#143326] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                {palateLoading
                  ? 'Analyzing palate & inventory...'
                  : user
                  ? 'Find Tailored Pairings'
                  : 'Sign In to Match Palate'}
              </button>
            </div>
          </div>

          {palateError && (
            <p className="text-sm text-[#DC2626]">{palateError}</p>
          )}
        </form>

        {palateResult && (
          <div className="mt-6 border-t border-neutral-200 pt-6 space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-[#1B4332]">
                  {palateResult.inferredMood}
                  {palateResult.detectedDietaryLimits.length > 0
                    ? ` · ${palateResult.detectedDietaryLimits.join(' · ')}`
                    : ''}
                </p>
                <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-neutral-700">
                  {palateResult.sommelierSummary}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {palateResult.pairings.map((pairing) => {
                const matchedItem = menu.find((m) => m.id === pairing.menuItemId);
                return (
                  <div
                    key={`${pairing.menuItemId}-${pairing.itemName}`}
                    className="flex flex-col justify-between rounded-lg border border-neutral-200 bg-[#F8F9FA] p-4"
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-display text-base font-semibold text-[#14171A]">
                          {pairing.itemName}
                        </h3>
                        <span className="font-mono text-xs font-semibold tabular-nums text-[#1B4332]">
                          {pairing.matchScore}% match
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-neutral-600">
                        {pairing.flavorRationale}
                      </p>
                      {pairing.suggestedModifier && (
                        <p className="mt-2 text-xs text-neutral-500">
                          Barista note: {pairing.suggestedModifier}
                        </p>
                      )}
                    </div>
                    {matchedItem && (
                      <button
                        type="button"
                        onClick={() => {
                          addToCart(matchedItem, pairing.suggestedModifier || '');
                          setDrawerOpen(true);
                        }}
                        className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-[#1B4332] bg-white px-3 py-2 text-xs font-medium text-[#1B4332] hover:bg-[#1B4332] hover:text-white transition-colors whitespace-nowrap shrink-0"
                      >
                        Add to Tray · {formatPrice(matchedItem.priceCents)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Live Specialty Menu Catalog */}
      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-neutral-500">02. Live Counter Menu</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-[#14171A]">
              Single-Origin Craft &amp; Artisan Bakery
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-neutral-200/70 p-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-white text-[#14171A] shadow-xs'
                    : 'text-neutral-600 hover:text-[#14171A]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMenu.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-neutral-100">
                <ProductImage
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>

              <div className="flex flex-1 flex-col justify-between p-5">
                <div>
                  <p className="text-xs text-neutral-500">
                    {item.category} · {item.acidityLevel} acidity · {item.caffeineLevel} caffeine
                  </p>
                  <div className="mt-1.5 flex items-baseline justify-between gap-3">
                    <h3 className="font-display text-lg font-semibold text-[#14171A]">
                      {item.name}
                    </h3>
                    <span className="font-mono text-sm font-semibold tabular-nums text-[#14171A] shrink-0">
                      {formatPrice(item.priceCents)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                    {item.description}
                  </p>
                  <p className="mt-3 text-xs text-neutral-500">
                    Notes: {item.flavorNotes.join(' · ')}
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3 border-t border-neutral-100 pt-4">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-neutral-500">
                    <Clock className="h-3.5 w-3.5" />
                    ~{Math.round(item.basePrepSeconds / 60)}m · {item.stockCount} left
                  </span>
                  <button
                    type="button"
                    disabled={item.stockCount <= 0}
                    onClick={() => addToCart(item)}
                    className="rounded-lg bg-[#14171A] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#1B4332] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                  >
                    Add to Tray
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Slide-Over Order Tray Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-5">
              <div>
                <h3 className="font-display text-lg font-semibold text-[#14171A]">
                  Your Café Tray
                </h3>
                <p className="text-xs text-neutral-500">
                  CounterFlow predicts live wait time on submission
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-[#14171A]"
                aria-label="Close tray"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {cart.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingBag className="mx-auto h-8 w-8 text-neutral-300" />
                  <p className="mt-3 text-sm font-medium text-[#14171A]">Your tray is empty</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Add single-origin drinks or pastries from the menu or VibeCraft sommelier.
                  </p>
                </div>
              ) : (
                cart.map((line, index) => (
                  <div
                    key={`${line.item.id}-${index}`}
                    className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#14171A]">{line.item.name}</p>
                      <p className="mt-0.5 font-mono text-xs tabular-nums text-neutral-500">
                        {formatPrice(line.item.priceCents)} each
                      </p>
                      <input
                        type="text"
                        value={line.modifiers}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCart((prev) =>
                            prev.map((l, i) => (i === index ? { ...l, modifiers: val } : l))
                          );
                        }}
                        placeholder="Add modifier (e.g., Oat milk, light ice)"
                        className="mt-2 w-full rounded-md border border-neutral-200 bg-[#F8F9FA] px-2.5 py-1.5 text-xs text-[#14171A] placeholder:text-neutral-400 focus:border-[#1B4332] focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateCartQty(index, -1)}
                        className="rounded-md border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-50"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-5 text-center font-mono text-sm tabular-nums">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateCartQty(index, 1)}
                        className="rounded-md border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-50"
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-neutral-200 bg-[#F8F9FA] px-6 py-5 space-y-4">
              <div>
                <label htmlFor="table-code" className="block text-xs font-medium text-neutral-600">
                  Table or Pickup Zone
                </label>
                <input
                  id="table-code"
                  type="text"
                  value={tableCode}
                  onChange={(e) => setTableCode(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-[#14171A] focus:border-[#1B4332] focus:outline-none"
                />
              </div>

              <div className="flex items-baseline justify-between text-sm">
                <span className="text-neutral-600">Total</span>
                <span className="font-mono text-lg font-semibold tabular-nums text-[#14171A]">
                  {formatPrice(cartTotalCents)}
                </span>
              </div>

              {orderError && <p className="text-xs text-[#DC2626]">{orderError}</p>}

              <button
                type="button"
                disabled={cart.length === 0 || submittingOrder}
                onClick={handleCheckout}
                className="w-full rounded-lg bg-[#1B4332] py-3 text-sm font-medium text-white hover:bg-[#143326] disabled:opacity-50 transition-colors"
              >
                {submittingOrder
                  ? 'Sending to Barista KDS...'
                  : user
                  ? 'Place Mobile Order & Start Live Timer'
                  : 'Sign In with Google to Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
