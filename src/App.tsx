import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { SHOWCASE_MENU_PREVIEW } from './data/previewCatalog';
import { CounterMenuView } from './components/CounterMenuView';
import { TableConnectView } from './components/TableConnectView';
import { BaristaKdsView } from './components/BaristaKdsView';
import { AmbientPulseView } from './components/AmbientPulseView';
import { ArchitectureView } from './components/ArchitectureView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls';
import {
  ActiveTab,
  AmbientTelemetryLog,
  CafeOrder,
  MenuItem,
  OrderFeedback,
} from './types';

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'counter', label: 'Counter' },
  { id: 'table-connect', label: 'Table Connect' },
  { id: 'kds', label: 'Barista KDS' },
  { id: 'ambient', label: 'Ambient Pulse' },
  { id: 'architecture', label: 'Architecture' },
];

export default function App() {
  const { user, loading: authLoading, authError, signIn, logout, authFetch } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('counter');
  const [menu, setMenu] = useState<MenuItem[]>(SHOWCASE_MENU_PREVIEW);
  const [orders, setOrders] = useState<CafeOrder[]>([]);
  const [activeOrder, setActiveOrder] = useState<CafeOrder | null>(null);
  const [ambientLogs, setAmbientLogs] = useState<AmbientTelemetryLog[]>([]);
  const [feedbackList, setFeedbackList] = useState<OrderFeedback[]>([]);

  const hydrateLiveData = useCallback(async () => {
    if (!user) return;
    try {
      const [menuRes, ordersRes, ambientRes, feedbackRes] = await Promise.all([
        authFetch('/api/menu'),
        authFetch('/api/orders'),
        authFetch('/api/ambient'),
        authFetch('/api/feedback'),
      ]);

      if (menuRes.ok) {
        const menuData = await menuRes.json();
        if (Array.isArray(menuData.items) && menuData.items.length > 0) {
          setMenu(menuData.items);
        }
      }

      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        const list: CafeOrder[] = ordersData.orders || [];
        setOrders(list);

        // Hydrate QR handoff token from URL if present, otherwise most recent active order
        const params = new URLSearchParams(window.location.search);
        const handoff = params.get('handoff');
        if (handoff) {
          const handoffRes = await authFetch(`/api/orders/handoff/${encodeURIComponent(handoff)}`);
          if (handoffRes.ok) {
            const hData = await handoffRes.json();
            if (hData.order) {
              setActiveOrder(hData.order);
            }
          }
        } else {
          const newestActive = list.find((o) => o.status !== 'COMPLETED') || list[0] || null;
          setActiveOrder((prev) => prev ?? newestActive);
        }
      }

      if (ambientRes.ok) {
        const ambData = await ambientRes.json();
        setAmbientLogs(ambData.logs || []);
      }

      if (feedbackRes.ok) {
        const fbData = await feedbackRes.json();
        setFeedbackList(fbData.feedback || []);
      }
    } catch (err) {
      console.error('Error hydrating live café data:', err);
    }
  }, [user, authFetch]);

  useEffect(() => {
    if (user) {
      hydrateLiveData();
    } else {
      setOrders([]);
      setActiveOrder(null);
      setAmbientLogs([]);
      setFeedbackList([]);
      setMenu(SHOWCASE_MENU_PREVIEW);
    }
  }, [user, hydrateLiveData]);

  // Persistent KDS & Operations WebSocket listener for real-time cross-view sync
  useEffect(() => {
    if (!user) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/kds`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'order:created' && msg.order) {
          setOrders((prev) => {
            if (prev.some((o) => o.id === msg.order.id)) return prev;
            return [msg.order, ...prev];
          });
        } else if (msg.type === 'order:stage_updated' && msg.order) {
          setOrders((prev) =>
            prev.map((o) => (o.id === msg.order.id ? msg.order : o))
          );
          setActiveOrder((prev) =>
            prev && prev.id === msg.order.id ? msg.order : prev
          );
        } else if (msg.type === 'timer:tick' && msg.orderId) {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === msg.orderId
                ? { ...o, remainingSeconds: msg.remainingSeconds, status: msg.status }
                : o
            )
          );
          setActiveOrder((prev) =>
            prev && prev.id === msg.orderId
              ? { ...prev, remainingSeconds: msg.remainingSeconds, status: msg.status }
              : prev
          );
        } else if (msg.type === 'ambient:alert' && msg.log) {
          setAmbientLogs((prev) => {
            if (prev.some((l) => l.id === msg.log.id)) return prev;
            return [msg.log, ...prev];
          });
        } else if (msg.type === 'ambient:resolved' && msg.log) {
          setAmbientLogs((prev) =>
            prev.map((l) => (l.id === msg.log.id ? msg.log : l))
          );
        } else if (msg.type === 'kds:feedback_received' && msg.feedback) {
          setFeedbackList((prev) => {
            const exists = prev.some((f) => f.id === msg.feedback.id);
            if (exists) {
              return prev.map((f) => (f.id === msg.feedback.id ? msg.feedback : f));
            }
            return [msg.feedback, ...prev];
          });
        } else if (msg.type === 'kds:feedback_acknowledged' && msg.feedback) {
          setFeedbackList((prev) =>
            prev.map((f) => (f.id === msg.feedback.id ? msg.feedback : f))
          );
        }
      } catch {
        // Ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, [user]);

  const handleOrderCreated = useCallback((order: CafeOrder) => {
    setOrders((prev) => {
      if (prev.some((o) => o.id === order.id)) return prev;
      return [order, ...prev];
    });
    setActiveOrder(order);
  }, []);

  const handleOrderUpdated = useCallback((order: CafeOrder) => {
    setOrders((prev) => prev.map((o) => (o.id === order.id ? order : o)));
    setActiveOrder((prev) => (prev && prev.id === order.id ? order : prev));
  }, []);

  const handleSimulatePatronScan = useCallback((order: CafeOrder) => {
    setActiveOrder(order);
    const url = new URL(window.location.href);
    url.searchParams.set('handoff', order.handoffToken);
    window.history.replaceState({}, '', url.toString());
    setActiveTab('counter');
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F9FA] text-[#14171A]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-[#F8F9FA]/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-4 sm:px-6 lg:px-8">
          {/* Zone 1: Single-element brand wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('counter');
            }}
            className="font-display text-xl font-semibold tracking-tight text-[#14171A] whitespace-nowrap shrink-0"
          >
            Café Companion
          </a>

          {/* Zone 2: 5 clean single-line text navigation links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    isActive
                      ? 'border-[#1B4332] text-[#14171A]'
                      : 'border-transparent text-neutral-500 hover:text-[#14171A]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="flex items-center shrink-0">
            {authLoading ? (
              <span className="text-xs text-neutral-400 whitespace-nowrap shrink-0">
                Loading…
              </span>
            ) : user ? (
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-medium text-[#14171A] hover:bg-neutral-50 transition-colors whitespace-nowrap shrink-0"
                title={user.email || undefined}
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={signIn}
                className="rounded-lg bg-[#1B4332] px-4 py-2 text-xs font-medium text-white hover:bg-[#143326] transition-colors whitespace-nowrap shrink-0"
              >
                Sign In with Google
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation row */}
        <nav
          aria-label="Mobile navigation"
          className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-neutral-200 px-4 py-2 text-xs font-medium"
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 whitespace-nowrap shrink-0 ${
                activeTab === item.id
                  ? 'text-[#1B4332] font-semibold'
                  : 'text-neutral-500'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {authError && (
        <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-[#DC2626]">
            {authError}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {activeTab === 'counter' && (
          <CounterMenuView
            menu={menu}
            orders={orders}
            activeOrder={activeOrder}
            feedbackList={feedbackList}
            onOrderCreated={handleOrderCreated}
            onOrderUpdated={handleOrderUpdated}
            onFeedbackSubmitted={(fb) =>
              setFeedbackList((prev) => {
                const exists = prev.some((f) => f.id === fb.id);
                return exists
                  ? prev.map((f) => (f.id === fb.id ? fb : f))
                  : [fb, ...prev];
              })
            }
            onJumpToKds={() => setActiveTab('kds')}
          />
        )}

        {activeTab === 'table-connect' && <TableConnectView />}

        {activeTab === 'kds' && (
          <BaristaKdsView
            menu={menu}
            orders={orders}
            feedbackList={feedbackList}
            onRefreshOrders={hydrateLiveData}
            onOrderCreated={handleOrderCreated}
            onOrderUpdated={handleOrderUpdated}
            onFeedbackAcknowledged={(fb) =>
              setFeedbackList((prev) => prev.map((f) => (f.id === fb.id ? fb : f)))
            }
            onSimulatePatronScan={handleSimulatePatronScan}
          />
        )}

        {activeTab === 'ambient' && (
          <AmbientPulseView
            logs={ambientLogs}
            onLogCreated={(log) =>
              setAmbientLogs((prev) =>
                prev.some((l) => l.id === log.id) ? prev : [log, ...prev]
              )
            }
            onLogResolved={(log) =>
              setAmbientLogs((prev) =>
                prev.map((l) => (l.id === log.id ? log : l))
              )
            }
          />
        )}

        {activeTab === 'architecture' && <ArchitectureView />}
      </main>

      <footer className="mt-16 border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div className="text-xs text-neutral-500">
            <span className="font-medium text-[#14171A]">Café Companion: VibeCraft &amp; CounterFlow</span>
            {' · '}
            Specialty Coffee Ecosystem
          </div>
          <div className="flex items-center gap-3">
            <PWAInstallButton />
          </div>
        </div>
      </footer>

      <OfflineIndicator />
    </div>
  );
}
