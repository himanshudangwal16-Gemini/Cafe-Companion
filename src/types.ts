export interface MenuItem {
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
  imageUrl: string;
  isAvailable: boolean;
}

export interface OrderItem {
  id: number;
  orderId: string;
  menuItemId: number;
  itemName: string;
  quantity: number;
  modifiers: string;
  unitPriceCents: number;
}

export interface KdsTicketStage {
  id: number;
  orderId: string;
  stage: string;
  startedAt: string;
  completedAt: string | null;
  baristaNote: string;
  slaTargetSeconds: number;
}

export interface CafeOrder {
  id: string;
  orderCode: string;
  customerUid: string | null;
  customerName: string;
  channel: 'COUNTER_POS' | 'MOBILE_PWA';
  tableCode: string | null;
  status:
    | 'QUEUED'
    | 'GRINDING_EXTRACTION'
    | 'STEAMING_POUR'
    | 'QUALITY_PLATING'
    | 'READY_PICKUP'
    | 'COMPLETED';
  estimatedSeconds: number;
  remainingSeconds: number;
  complexityScore: number;
  aiWaitReasoning: string;
  totalCents: number;
  handoffToken: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  stages: KdsTicketStage[];
}

export interface PalatePairing {
  menuItemId: number;
  itemName: string;
  matchScore: number;
  flavorRationale: string;
  suggestedModifier: string;
}

export interface PalateRecommendation {
  inferredMood: string;
  detectedDietaryLimits: string[];
  sommelierSummary: string;
  pairings: PalatePairing[];
}

export interface CommunityVibe {
  id: string;
  customerUid?: string;
  displayName: string;
  tableZone: string;
  focusTag: string;
  focusDescription: string;
  openToConnect: boolean;
  expiresAt: string;
  createdAt?: string;
  similarity?: number | null;
}

export interface Icebreaker {
  sharedGround: string;
  icebreakerPrompt: string;
  suggestedTableAction: string;
}

export interface AmbientTelemetryLog {
  id: number;
  zone: string;
  decibels: number | null;
  feedbackType: string;
  rawMessage: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  aiCategory: string;
  aiCorrectiveAction: string;
  resolved: boolean;
  createdAt: string;
}

export interface OrderFeedback {
  id: number;
  orderId: string;
  orderCode: string;
  customerName: string;
  drinkQualityRating: number;
  serviceExperienceRating: number;
  comment: string;
  acknowledgedByKds: boolean;
  createdAt: string;
}

export type ActiveTab =
  | 'counter'
  | 'table-connect'
  | 'kds'
  | 'ambient'
  | 'architecture';
