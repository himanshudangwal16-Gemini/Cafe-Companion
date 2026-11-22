import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const MODEL_FAST = 'gemini-4-hydrogen';
const MODEL_EMBED = 'gemini-embedding-2';

export interface MenuCatalogItem {
  id: number;
  sku: string;
  name: string;
  category: string;
  description: string;
  priceCents: number;
  prepComplexity: number;
  basePrepSeconds: number;
  caffeineLevel: string;
  acidityLevel: string;
  dietaryTags: string[];
  flavorNotes: string[];
  stockCount: number;
}

export interface WaitTimePrediction {
  estimatedSeconds: number;
  complexityScore: number;
  reasoning: string;
  recommendedStation: string;
}

export async function predictCounterFlowWaitTime(params: {
  items: Array<{ name: string; quantity: number; prepComplexity: number; basePrepSeconds: number; modifiers: string }>;
  activeQueueDepth: number;
  activeBaristas: number;
}): Promise<WaitTimePrediction> {
  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: `You are CounterFlow, a specialty café operations engine.
Calculate an accurate, realistic preparation time estimate in seconds for an incoming ticket.
Active queue depth ahead of this order: ${params.activeQueueDepth} tickets.
Baristas currently on bar: ${params.activeBaristas}.
Incoming order items: ${JSON.stringify(params.items)}.
Consider extraction method complexity (manual pour-over, oat milk steaming, matcha whisking, batch cold brew), barista concurrency, and queue depth. Return strictly structured JSON.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          estimatedSeconds: {
            type: Type.INTEGER,
            description: 'Total predicted wait time in seconds (between 60 and 900).',
          },
          complexityScore: {
            type: Type.NUMBER,
            description: 'Ticket complexity score from 1.0 (simple) to 5.0 (high craft).',
          },
          reasoning: {
            type: Type.STRING,
            description: 'Concise 1-sentence operational explanation of the wait estimate.',
          },
          recommendedStation: {
            type: Type.STRING,
            description: 'Primary bar station assignment (Espresso Bar, Slow Pour Bar, Cold Station, Matcha & Pastry).',
          },
        },
        required: ['estimatedSeconds', 'complexityScore', 'reasoning', 'recommendedStation'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as WaitTimePrediction;
  return {
    estimatedSeconds: Math.max(60, Math.min(900, Math.round(parsed.estimatedSeconds || 180))),
    complexityScore: Number((parsed.complexityScore || 2.0).toFixed(1)),
    reasoning: parsed.reasoning || 'Calculated based on current queue depth and craft complexity.',
    recommendedStation: parsed.recommendedStation || 'Espresso Bar',
  };
}

export interface PalateRecommendationResponse {
  inferredMood: string;
  detectedDietaryLimits: string[];
  sommelierSummary: string;
  pairings: Array<{
    menuItemId: number;
    itemName: string;
    matchScore: number;
    flavorRationale: string;
    suggestedModifier: string;
  }>;
}

export async function matchConversationalPalate(params: {
  prompt: string;
  menu: MenuCatalogItem[];
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<PalateRecommendationResponse> {
  const menuContext = params.menu
    .filter((m) => m.stockCount > 0)
    .map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      description: m.description,
      caffeineLevel: m.caffeineLevel,
      acidityLevel: m.acidityLevel,
      dietaryTags: m.dietaryTags,
      flavorNotes: m.flavorNotes,
      stockCount: m.stockCount,
      priceUsd: (m.priceCents / 100).toFixed(2),
    }));

  const textPrompt = `You are VibeCraft, a specialty coffee sommelier and dietary concierge.
Analyze the patron's request (and any attached receipt, allergen chart, or coffee bean photo if provided) and recommend 2 to 3 exact in-stock items from the live Cloud SQL menu inventory below.
Only recommend menuItemId values that exist in the provided menu list.

Patron Request: "${params.prompt}"

Live In-Stock Menu Inventory:
${JSON.stringify(menuContext)}`;

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (params.imageBase64 && params.imageMimeType) {
    parts.push({
      inlineData: {
        mimeType: params.imageMimeType,
        data: params.imageBase64,
      },
    });
  }
  parts.push({ text: textPrompt });

  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          inferredMood: {
            type: Type.STRING,
            description: 'Short editorial mood/session descriptor (e.g., Deep Analytical Focus, Calm Afternoon Reset).',
          },
          detectedDietaryLimits: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Extracted dietary constraints or caffeine/acidity preferences.',
          },
          sommelierSummary: {
            type: Type.STRING,
            description: 'Warm 2-sentence explanation of why these pairings fit the request and any uploaded image.',
          },
          pairings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                menuItemId: { type: Type.INTEGER },
                itemName: { type: Type.STRING },
                matchScore: { type: Type.INTEGER, description: 'Match fit percentage 75-99.' },
                flavorRationale: { type: Type.STRING, description: 'Concise sensory pairing note.' },
                suggestedModifier: { type: Type.STRING, description: 'Optional barista tweak (e.g., Light ice, Oat milk).' },
              },
              required: ['menuItemId', 'itemName', 'matchScore', 'flavorRationale', 'suggestedModifier'],
            },
          },
        },
        required: ['inferredMood', 'detectedDietaryLimits', 'sommelierSummary', 'pairings'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  return JSON.parse(raw) as PalateRecommendationResponse;
}

export async function generateVibeEmbedding(text: string): Promise<number[]> {
  const result = await ai.models.embedContent({
    model: MODEL_EMBED,
    contents: [text],
    config: {
      outputDimensionality: 768,
    },
  });

  const values = result.embeddings?.[0]?.values;
  if (!values || values.length !== 768) {
    throw new Error('Failed to generate 768-dimensional embedding vector.');
  }
  return values;
}

export interface IcebreakerResponse {
  sharedGround: string;
  icebreakerPrompt: string;
  suggestedTableAction: string;
}

export async function generateContextualIcebreaker(params: {
  myFocusTag: string;
  myFocusDescription: string;
  peerName: string;
  peerZone: string;
  peerFocusTag: string;
  peerFocusDescription: string;
}): Promise<IcebreakerResponse> {
  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: `Two café patrons opted into Table Connect open networking.
Patron A: "${params.myFocusTag}" — ${params.myFocusDescription}
Patron B (${params.peerName} at ${params.peerZone}): "${params.peerFocusTag}" — ${params.peerFocusDescription}
Identify latent common ground and craft a respectful, low-friction, non-intrusive introduction prompt.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sharedGround: { type: Type.STRING, description: '1-sentence shared interest summary.' },
          icebreakerPrompt: { type: Type.STRING, description: 'A natural, low-pressure conversation opener.' },
          suggestedTableAction: { type: Type.STRING, description: 'Optional café etiquette suggestion (e.g., 10-minute chat at the high-top communal table).' },
        },
        required: ['sharedGround', 'icebreakerPrompt', 'suggestedTableAction'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  return JSON.parse(raw) as IcebreakerResponse;
}

export interface AmbientTriageResult {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  aiCategory: string;
  aiCorrectiveAction: string;
}

export async function triageAmbientPulse(params: {
  zone: string;
  decibels?: number | null;
  feedbackType: string;
  rawMessage: string;
}): Promise<AmbientTriageResult> {
  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: `You are the Shift Lead Operations AI for a specialty café.
Triage this live floor telemetry / table feedback signal and output an immediate, concrete corrective action for the barista shift lead.
Zone: ${params.zone}
Ambient Decibels: ${params.decibels != null ? `${params.decibels} dB` : 'Not metered'}
Signal Type: ${params.feedbackType}
Patron/Sensor Report: "${params.rawMessage}"`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          severity: {
            type: Type.STRING,
            description: 'Exactly one of: LOW, MEDIUM, HIGH, CRITICAL',
          },
          aiCategory: {
            type: Type.STRING,
            description: 'Short operational category (Acoustics, Climate HVAC, Network Wi-Fi, Bar Queue, Hospitality).',
          },
          aiCorrectiveAction: {
            type: Type.STRING,
            description: 'Concrete, actionable 1-sentence instruction for the shift lead (e.g., Reduce Zone B speaker gain by 3 dB).',
          },
        },
        required: ['severity', 'aiCategory', 'aiCorrectiveAction'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as AmbientTriageResult;
  const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
  const severity = validSeverities.includes(parsed.severity) ? parsed.severity : 'MEDIUM';
  return {
    severity,
    aiCategory: parsed.aiCategory || 'Floor Operations',
    aiCorrectiveAction: parsed.aiCorrectiveAction || 'Inspect reported zone and adjust ambient settings.',
  };
}
