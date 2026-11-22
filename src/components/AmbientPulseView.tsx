import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Thermometer, Volume2, Wifi } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AmbientTelemetryLog } from '../types';

interface AmbientPulseViewProps {
  logs: AmbientTelemetryLog[];
  onLogCreated: (log: AmbientTelemetryLog) => void;
  onLogResolved: (log: AmbientTelemetryLog) => void;
}

const ONE_TAP_REPORTS = [
  {
    label: 'Wi-Fi dropping near Table 8',
    zone: 'High-Top Bar (Table 8)',
    feedbackType: 'WIFI',
    decibels: 62.4,
    rawMessage: 'Wi-Fi dropping near Table 8 during video standup.',
  },
  {
    label: 'Music volume high at Tables 3–5',
    zone: 'Window Lounge (Tables 3-5)',
    feedbackType: 'MUSIC',
    decibels: 78.6,
    rawMessage: 'Overhead speaker above Tables 3-5 is too loud for focus reading.',
  },
  {
    label: 'A/C too cold near Roastery Alcove',
    zone: 'Roastery Alcove (Tables 6-7)',
    feedbackType: 'CLIMATE',
    decibels: 59.1,
    rawMessage: 'HVAC vent directly above Table 6 is blowing very cold air.',
  },
  {
    label: 'Steam wand acoustics spiking at pass',
    zone: 'Espresso Bar Pass',
    feedbackType: 'ACOUSTIC',
    decibels: 83.2,
    rawMessage: 'Peak morning rush decibel meter crossed 83 dB at the espresso pass.',
  },
];

function severityStyle(severity: AmbientTelemetryLog['severity']): {
  text: string;
  label: string;
} {
  switch (severity) {
    case 'CRITICAL':
      return { text: 'text-[#DC2626] font-semibold', label: 'Critical · Immediate Action' };
    case 'HIGH':
      return { text: 'text-[#DC2626] font-medium', label: 'High Priority' };
    case 'MEDIUM':
      return { text: 'text-[#D97706] font-medium', label: 'Medium Priority' };
    default:
      return { text: 'text-[#16A34A] font-medium', label: 'Low · Nominal' };
  }
}

export const AmbientPulseView: React.FC<AmbientPulseViewProps> = ({
  logs,
  onLogCreated,
  onLogResolved,
}) => {
  const { user, signIn, authFetch } = useAuth();
  const [zone, setZone] = useState('Window Lounge (Tables 3-5)');
  const [feedbackType, setFeedbackType] = useState('ACOUSTIC');
  const [decibels, setDecibels] = useState<string>('72.5');
  const [rawMessage, setRawMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openAlerts = logs.filter((l) => !l.resolved);
  const avgDb =
    logs.filter((l) => l.decibels != null).length > 0
      ? (
          logs
            .filter((l) => l.decibels != null)
            .reduce((sum, l) => sum + (l.decibels || 0), 0) /
          logs.filter((l) => l.decibels != null).length
        ).toFixed(1)
      : '64.0';

  const submitReport = async (payload: {
    zone: string;
    decibels: number | null;
    feedbackType: string;
    rawMessage: string;
  }) => {
    if (!user) {
      await signIn();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch('/api/ambient/report', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to triage ambient report');
      onLogCreated(data.log);
      setRawMessage('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ambient report failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawMessage.trim()) return;
    await submitReport({
      zone,
      decibels: decibels ? Number(decibels) : null,
      feedbackType,
      rawMessage,
    });
  };

  const handleResolve = async (id: number) => {
    if (!user) return;
    setResolvingId(id);
    try {
      const res = await authFetch(`/api/ambient/${id}/resolve`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve alert');
      onLogResolved(data.log);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not resolve alert.');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-neutral-500">
            Pillar D · Staff Cockpit &amp; Acoustic Sentiment Triage
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[#14171A]">
            Ambient Vibe &amp; Operations Pulse
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Consolidates zone decibel telemetry and 1-tap patron comfort signals. Gemini triages severity and dispatches concrete shift-lead actions to the KDS in real time.
          </p>
        </div>
      </div>

      {/* Floor KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <p className="text-xs text-neutral-500 flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5" /> Mean Acoustic Floor
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#14171A]">
            {avgDb} dB
          </p>
          <p className="mt-1 text-xs text-neutral-500">Target range: 58–68 dB</p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <p className="text-xs text-neutral-500 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Open Shift-Lead Actions
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#14171A]">
            {openAlerts.length}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {openAlerts.some((a) => a.severity === 'HIGH' || a.severity === 'CRITICAL')
              ? 'High-priority floor adjustment needed'
              : 'All dining zones within comfort thresholds'}
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <p className="text-xs text-neutral-500 flex items-center gap-1.5">
            <Wifi className="h-3.5 w-3.5" /> Resolved Today
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[#16A34A]">
            {logs.filter((l) => l.resolved).length}
          </p>
          <p className="mt-1 text-xs text-neutral-500">Closed-loop corrective actions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: 1-Tap Anonymous Table Feedback & Decibel Sensor Input */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 space-y-6 lg:col-span-5">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#14171A]">
              1-Tap Table Comfort Signals
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Trigger an instant anonymous patron or acoustic sensor signal for Gemini triage.
            </p>
          </div>

          <div className="space-y-2">
            {ONE_TAP_REPORTS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={submitting}
                onClick={() =>
                  submitReport({
                    zone: preset.zone,
                    decibels: preset.decibels,
                    feedbackType: preset.feedbackType,
                    rawMessage: preset.rawMessage,
                  })
                }
                className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-[#F8F9FA] px-3.5 py-2.5 text-left text-xs font-medium text-[#14171A] hover:border-[#1B4332] hover:bg-white transition-colors"
              >
                <span>{preset.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-neutral-500 shrink-0 ml-2">
                  {preset.decibels} dB
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-4 border-t border-neutral-100 pt-5">
            <p className="text-xs font-semibold text-[#14171A]">Custom Floor Signal</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="amb-zone" className="block text-xs text-neutral-600">
                  Zone
                </label>
                <input
                  id="amb-zone"
                  type="text"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-xs text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="amb-db" className="block text-xs text-neutral-600">
                  Decibels (dB)
                </label>
                <input
                  id="amb-db"
                  type="number"
                  step="0.1"
                  value={decibels}
                  onChange={(e) => setDecibels(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 font-mono text-xs tabular-nums text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="amb-type" className="block text-xs text-neutral-600">
                Signal Category
              </label>
              <select
                id="amb-type"
                value={feedbackType}
                onChange={(e) => setFeedbackType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-xs text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
              >
                <option value="ACOUSTIC">Acoustic Telemetry</option>
                <option value="MUSIC">Music Volume</option>
                <option value="WIFI">Wi-Fi Connectivity</option>
                <option value="CLIMATE">Climate / HVAC</option>
                <option value="SERVICE">Service &amp; Queue</option>
              </select>
            </div>

            <div>
              <label htmlFor="amb-msg" className="block text-xs text-neutral-600">
                Observation / Patron Feedback
              </label>
              <textarea
                id="amb-msg"
                rows={2}
                required
                value={rawMessage}
                onChange={(e) => setRawMessage(e.target.value)}
                placeholder="Describe comfort, acoustics, lighting, or network feedback..."
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-[#F8F9FA] px-3 py-2 text-xs text-[#14171A] focus:border-[#1B4332] focus:bg-white focus:outline-none"
              />
            </div>

            {error && <p className="text-xs text-[#DC2626]">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#1B4332] py-2.5 text-xs font-medium text-white hover:bg-[#143326] disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Triaging with Gemini...' : 'Run AI Triage & Notify Shift Lead'}
            </button>
          </form>
        </div>

        {/* Right: Shift Lead Triage Feed */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#14171A]">
                Shift-Lead Triage Queue
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Categorized severity and immediate corrective instructions
              </p>
            </div>
            <Thermometer className="h-4 w-4 text-neutral-400" />
          </div>

          <div className="mt-4 divide-y divide-neutral-100">
            {logs.length === 0 ? (
              <p className="py-12 text-center text-xs text-neutral-500">
                Sign in and submit a floor signal to see Gemini operational triage.
              </p>
            ) : (
              logs.map((log) => {
                const sev = severityStyle(log.severity);
                return (
                  <div
                    key={log.id}
                    className={`py-4 space-y-2 ${log.resolved ? 'opacity-60' : ''}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <span className="text-neutral-500">
                        <strong className="text-[#14171A]">{log.zone}</strong> · {log.aiCategory}
                        {log.decibels != null ? ` · ${log.decibels.toFixed(1)} dB` : ''}
                      </span>
                      <span className={sev.text}>{sev.label}</span>
                    </div>

                    <p className="text-sm text-neutral-700">“{log.rawMessage}”</p>

                    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-[#F8F9FA] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs leading-relaxed text-[#14171A]">
                        <span className="font-semibold">Shift Action:</span>{' '}
                        {log.aiCorrectiveAction}
                      </p>
                      {log.resolved ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16A34A] whitespace-nowrap shrink-0">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={resolvingId === log.id || !user}
                          onClick={() => handleResolve(log.id)}
                          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:border-[#16A34A] hover:text-[#16A34A] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                        >
                          {resolvingId === log.id ? 'Updating...' : 'Mark Resolved'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
