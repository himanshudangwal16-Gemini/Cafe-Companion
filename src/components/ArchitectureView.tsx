import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import firestoreRulesRaw from '../../firestore.rules?raw';
import mainPyRaw from '../../backend/app/main.py?raw';
import dockerfileRaw from '../../Dockerfile?raw';
import setupShRaw from '../../infra/setup.sh?raw';

type DeliverableTab = 'diagrams' | 'rules' | 'fastapi' | 'deploy';

export const ArchitectureView: React.FC = () => {
  const [tab, setTab] = useState<DeliverableTab>('diagrams');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked in sandbox
    }
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-neutral-500">
            Google Cloud Serverless Architecture · Hard $5/Month Cap · asia-south1
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[#14171A]">
            Production Deliverables &amp; System Topology
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Scale-to-zero Cloud Run FastAPI service paired with Cloud Firestore Native mode, 768-dim Firestore Vector Search, TTL privacy policies, and the Google GenAI SDK.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-neutral-200/70 p-1 shrink-0">
          {[
            { id: 'diagrams', label: '01. Diagrams' },
            { id: 'rules', label: '02. Firestore Rules' },
            { id: 'fastapi', label: '03. FastAPI Service' },
            { id: 'deploy', label: '04. Docker & Infra' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as DeliverableTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                tab === item.id
                  ? 'bg-white text-[#14171A] shadow-xs'
                  : 'text-neutral-600 hover:text-[#14171A]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'diagrams' && (
        <div className="space-y-8">
          <section className="rounded-xl border border-neutral-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#14171A]">
                01. Cloud-Native System Architecture &amp; Data Flow ($0.50–$2.00/mo)
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                Unified omnichannel flow across Patron PWA, Walk-In Counter POS, and Barista KDS using Firestore Native real-time listeners and scale-to-zero Cloud Run HTTP APIs.
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-[#F8F9FA] p-4">
              <svg
                viewBox="0 0 1040 430"
                className="w-full min-w-[780px] h-auto"
                role="img"
                aria-label="Café Companion Cloud Run, Cloud Firestore Native Vector Search, and Gemini GenAI System Architecture Diagram"
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#4B5563" />
                  </marker>
                </defs>

                {/* Zone 1: Edge / Clients */}
                <rect x="20" y="24" width="230" height="382" rx="10" fill="#FFFFFF" stroke="#D1D5DB" />
                <text x="38" y="52" fontSize="12" fontWeight="600" fill="#6B7280">
                  EDGE &amp; OMNICHANNEL CLIENTS
                </text>

                <rect x="38" y="74" width="194" height="84" rx="8" fill="#F8F9FA" stroke="#1B4332" strokeWidth="1.5" />
                <text x="52" y="100" fontSize="13" fontWeight="700" fill="#14171A">Patron Mobile PWA</text>
                <text x="52" y="119" fontSize="11" fill="#4B5563">Zero-app QR/NFC bootstrap</text>
                <text x="52" y="136" fontSize="11" fill="#4B5563">Live timer + Post-order rating</text>

                <rect x="38" y="176" width="194" height="84" rx="8" fill="#F8F9FA" stroke="#9CA3AF" />
                <text x="52" y="202" fontSize="13" fontWeight="700" fill="#14171A">Counter POS Register</text>
                <text x="52" y="221" fontSize="11" fill="#4B5563">Walk-in ticket injection</text>
                <text x="52" y="238" fontSize="11" fill="#4B5563">Dynamic thermal QR slip</text>

                <rect x="38" y="278" width="194" height="106" rx="8" fill="#F8F9FA" stroke="#9CA3AF" />
                <text x="52" y="304" fontSize="13" fontWeight="700" fill="#14171A">Barista KDS &amp; Cockpit</text>
                <text x="52" y="323" fontSize="11" fill="#4B5563">Firestore onSnapshot board</text>
                <text x="52" y="340" fontSize="11" fill="#4B5563">Rolling drink/service ratings</text>
                <text x="52" y="357" fontSize="11" fill="#4B5563">Acoustic dB &amp; table triage</text>

                {/* Zone 2: Google Cloud Run */}
                <rect x="320" y="24" width="320" height="382" rx="10" fill="#FFFFFF" stroke="#1B4332" strokeWidth="1.5" />
                <text x="340" y="52" fontSize="12" fontWeight="600" fill="#1B4332">
                  GOOGLE CLOUD RUN (asia-south1)
                </text>
                <text x="340" y="70" fontSize="11" fill="#6B7280">
                  min-instances=0 · 512Mi · cafe-api-sa
                </text>

                <rect x="340" y="92" width="280" height="78" rx="8" fill="#F8F9FA" stroke="#D1D5DB" />
                <text x="356" y="117" fontSize="13" fontWeight="700" fill="#14171A">FastAPI REST + Static PWA</text>
                <text x="356" y="136" fontSize="11" fill="#4B5563">Firebase Auth JWT + RBAC guards</text>
                <text x="356" y="153" fontSize="11" fill="#4B5563">Pydantic v2 + prompt-injection fence</text>

                <rect x="340" y="186" width="280" height="82" rx="8" fill="#ECFDF5" stroke="#1B4332" />
                <text x="356" y="211" fontSize="13" fontWeight="700" fill="#14171A">CounterFlow &amp; Feedback API</text>
                <text x="356" y="230" fontSize="11" fill="#1B4332">Transactional stock &amp; ETA writes</text>
                <text x="356" y="247" fontSize="11" fill="#4B5563">QR handoff token + rating validation</text>

                <rect x="340" y="284" width="280" height="100" rx="8" fill="#F8F9FA" stroke="#D1D5DB" />
                <text x="356" y="309" fontSize="13" fontWeight="700" fill="#14171A">AI Orchestration Layer</text>
                <text x="356" y="328" fontSize="11" fill="#4B5563">VibeCraft multimodal palate sommelier</text>
                <text x="356" y="345" fontSize="11" fill="#4B5563">CounterFlow dynamic wait-time model</text>
                <text x="356" y="362" fontSize="11" fill="#4B5563">Table Connect icebreakers + dB triage</text>

                {/* Zone 3: Cloud Firestore Native & Gemini */}
                <rect x="716" y="24" width="304" height="206" rx="10" fill="#FFFFFF" stroke="#D1D5DB" />
                <text x="736" y="52" fontSize="12" fontWeight="600" fill="#6B7280">
                  CLOUD FIRESTORE NATIVE (asia-south1)
                </text>
                <text x="736" y="70" fontSize="11" fill="#1B4332">
                  Always Free Tier · Zero Cloud SQL Cost
                </text>
                <text x="736" y="96" fontSize="11.5" fill="#14171A">• menu_items + transactional orders</text>
                <text x="736" y="118" fontSize="11.5" fill="#14171A">• order_feedback (1-5 quality &amp; service)</text>
                <text x="736" y="140" fontSize="11.5" fill="#14171A">• community_vibes: Vector(768) COSINE</text>
                <text x="736" y="162" fontSize="11.5" fill="#14171A">• Auto-TTL purge on expires_at (2h)</text>
                <text x="736" y="190" fontSize="11" fill="#6B7280">
                  Real-time onSnapshot push → PWA &amp; KDS
                </text>

                <rect x="716" y="250" width="304" height="156" rx="10" fill="#14171A" />
                <text x="736" y="278" fontSize="12" fontWeight="600" fill="#9CA3AF">
                  GOOGLE GENAI SDK + SECRET MANAGER
                </text>
                <text x="736" y="306" fontSize="13" fontWeight="700" fill="#FFFFFF">
                  Gemini Flash &amp; 768-dim Embeddings
                </text>
                <text x="736" y="330" fontSize="11.5" fill="#D1D5DB">• Structured JSON (response_schema)</text>
                <text x="736" y="352" fontSize="11.5" fill="#D1D5DB">• Vision: Receipts, Bean Bags, Allergens</text>
                <text x="736" y="374" fontSize="11.5" fill="#D1D5DB">• 768-dim Cosine Vectors for Matching</text>

                {/* Connectors */}
                <line x1="232" y1="116" x2="338" y2="132" stroke="#1B4332" strokeWidth="1.5" markerEnd="url(#arrow)" />
                <line x1="232" y1="218" x2="338" y2="218" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrow)" />
                <line x1="232" y1="330" x2="338" y2="245" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrow)" />

                <line x1="620" y1="130" x2="714" y2="112" stroke="#4B5563" strokeWidth="1.5" markerEnd="url(#arrow)" />
                <line x1="620" y1="224" x2="714" y2="176" stroke="#1B4332" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrow)" />
                <line x1="620" y1="334" x2="714" y2="334" stroke="#14171A" strokeWidth="1.5" markerEnd="url(#arrow)" />
              </svg>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#14171A]">
                02. Sequence Diagram: QR Handoff, Firestore Push &amp; Post-Completion Rating Loop
              </h2>
              <p className="mt-1 text-xs text-neutral-500">
                End-to-end flow keeping Cloud Run idle billing at zero via Firestore real-time document listeners and authoritative ready timestamps.
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-[#F8F9FA] p-4">
              <svg
                viewBox="0 0 1040 420"
                className="w-full min-w-[780px] h-auto"
                role="img"
                aria-label="POS to Phone QR Handoff, Firestore onSnapshot, and Post-Completion Feedback Sequence Diagram"
              >
                <defs>
                  <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#14171A" />
                  </marker>
                </defs>

                {[
                  { x: 95, label: 'Counter POS' },
                  { x: 295, label: 'Patron PWA' },
                  { x: 510, label: 'Cloud Run FastAPI' },
                  { x: 725, label: 'Gemini GenAI' },
                  { x: 930, label: 'Firestore Native' },
                ].map((actor) => (
                  <g key={actor.label}>
                    <rect x={actor.x - 75} y="16" width="150" height="36" rx="6" fill="#FFFFFF" stroke="#14171A" />
                    <text x={actor.x} y="39" textAnchor="middle" fontSize="12" fontWeight="600" fill="#14171A">
                      {actor.label}
                    </text>
                    <line x1={actor.x} y1="52" x2={actor.x} y2="395" stroke="#D1D5DB" strokeDasharray="5 4" />
                  </g>
                ))}

                <line x1="95" y1="88" x2="504" y2="88" stroke="#14171A" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
                <text x="112" y="81" fontSize="11" fill="#14171A">1. POST /api/orders (confirmed_by_human=true)</text>

                <line x1="510" y1="124" x2="719" y2="124" stroke="#1B4332" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
                <text x="526" y="117" fontSize="11" fill="#1B4332">2. CounterFlow wait-time prediction (JSON schema)</text>

                <line x1="510" y1="162" x2="924" y2="162" stroke="#14171A" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
                <text x="526" y="155" fontSize="11" fill="#14171A">3. Transactional stock decrement + write orders/&#123;id&#125; + ETA</text>

                <line x1="510" y1="200" x2="101" y2="200" stroke="#14171A" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
                <text x="112" y="193" fontSize="11" fill="#14171A">4. Return order_code + handoff_token → Print QR slip</text>

                <line x1="95" y1="238" x2="289" y2="238" stroke="#1B4332" strokeWidth="1.5" strokeDasharray="3 2" markerEnd="url(#seq-arrow)" />
                <text x="112" y="231" fontSize="11" fill="#1B4332">5. Patron scans QR → GET /api/orders/handoff/&#123;token&#125;</text>

                <line x1="930" y1="276" x2="301" y2="276" stroke="#16A34A" strokeWidth="1.8" markerEnd="url(#seq-arrow)" />
                <text x="312" y="269" fontSize="11" fontWeight="600" fill="#16A34A">
                  6. Firestore onSnapshot pushes KDS stage updates (GRIND → POUR → READY)
                </text>

                <line x1="295" y1="316" x2="504" y2="316" stroke="#14171A" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
                <text x="308" y="309" fontSize="11" fill="#14171A">7. Unlock rating form → POST /api/orders/&#123;id&#125;/feedback</text>

                <line x1="510" y1="354" x2="924" y2="354" stroke="#1B4332" strokeWidth="1.5" markerEnd="url(#seq-arrow)" />
                <text x="526" y="347" fontSize="11" fill="#1B4332">8. Persist order_feedback → Live rolling averages on Barista KDS</text>
              </svg>
            </div>
          </section>
        </div>
      )}

      {tab === 'rules' && (
        <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-6 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#14171A]">
                Cloud Firestore Native Security Rules (`firestore.rules`)
              </h2>
              <p className="text-xs text-neutral-500">
                Enforces RBAC, strict 1–5 rating bounds, active 2-hour TTL freshness checks on `community_vibes`, and user PII isolation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy('rules', firestoreRulesRaw)}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 whitespace-nowrap shrink-0"
              >
                {copiedKey === 'rules' ? <Check className="h-3.5 w-3.5 text-[#16A34A]" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === 'rules' ? 'Copied' : 'Copy Rules'}
              </button>
              <button
                type="button"
                onClick={() => handleDownload('firestore.rules', firestoreRulesRaw)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#14171A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1B4332] whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          </div>
          <pre className="max-h-[600px] overflow-auto bg-[#14171A] p-6 font-mono text-xs leading-relaxed text-neutral-100">
            <code>{firestoreRulesRaw}</code>
          </pre>
        </section>
      )}

      {tab === 'fastapi' && (
        <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-6 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#14171A]">
                Production Python FastAPI Service (`backend/app/main.py`)
              </h2>
              <p className="text-xs text-neutral-500">
                Firestore Native repository, 768-dim Vector Search, Firebase Auth verification, and Google GenAI structured outputs.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy('fastapi', mainPyRaw)}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 whitespace-nowrap shrink-0"
              >
                {copiedKey === 'fastapi' ? <Check className="h-3.5 w-3.5 text-[#16A34A]" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === 'fastapi' ? 'Copied' : 'Copy Python'}
              </button>
              <button
                type="button"
                onClick={() => handleDownload('main.py', mainPyRaw)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#14171A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1B4332] whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          </div>
          <pre className="max-h-[600px] overflow-auto bg-[#14171A] p-6 font-mono text-xs leading-relaxed text-neutral-100">
            <code>{mainPyRaw}</code>
          </pre>
        </section>
      )}

      {tab === 'deploy' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#14171A]">
                  Multi-Stage Slim `Dockerfile`
                </h2>
                <p className="text-xs text-neutral-500">Bundles Vite PWA + non-root Python 3.12 Cloud Run runtime</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy('docker', dockerfileRaw)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'docker' ? <Check className="h-3.5 w-3.5 text-[#16A34A]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === 'docker' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload('Dockerfile', dockerfileRaw)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#14171A] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1B4332] whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <pre className="max-h-[540px] overflow-auto bg-[#14171A] p-5 font-mono text-xs leading-relaxed text-neutral-100">
              <code>{dockerfileRaw}</code>
            </pre>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[#14171A]">
                  GCP Bootstrap Script (`infra/setup.sh`)
                </h2>
                <p className="text-xs text-neutral-500">Firestore Native, 768-dim Vector Index, TTL, Secret Manager &amp; $5 Budget</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy('setup', setupShRaw)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-[#14171A] hover:bg-neutral-50 whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'setup' ? <Check className="h-3.5 w-3.5 text-[#16A34A]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedKey === 'setup' ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload('setup.sh', setupShRaw)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#14171A] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#1B4332] whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <pre className="max-h-[540px] overflow-auto bg-[#14171A] p-5 font-mono text-xs leading-relaxed text-neutral-100">
              <code>{setupShRaw}</code>
            </pre>
          </section>
        </div>
      )}
    </div>
  );
};
