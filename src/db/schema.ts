import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('patron'),
  dietaryLimits: jsonb('dietary_limits').$type<string[]>().notNull().default([]),
  tasteNotes: text('taste_notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const menuItems = pgTable('menu_items', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  priceCents: integer('price_cents').notNull(),
  prepComplexity: integer('prep_complexity').notNull().default(2),
  basePrepSeconds: integer('base_prep_seconds').notNull().default(180),
  caffeineLevel: text('caffeine_level').notNull(),
  acidityLevel: text('acidity_level').notNull(),
  dietaryTags: jsonb('dietary_tags').$type<string[]>().notNull().default([]),
  flavorNotes: jsonb('flavor_notes').$type<string[]>().notNull().default([]),
  stockCount: integer('stock_count').notNull().default(25),
  imageUrl: text('image_url').notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderCode: text('order_code').notNull().unique(),
  customerUid: text('customer_uid'),
  customerName: text('customer_name').notNull(),
  channel: text('channel').notNull().default('MOBILE_PWA'),
  tableCode: text('table_code'),
  status: text('status').notNull().default('GRINDING_EXTRACTION'),
  estimatedSeconds: integer('estimated_seconds').notNull().default(240),
  remainingSeconds: integer('remaining_seconds').notNull().default(240),
  complexityScore: real('complexity_score').notNull().default(1.0),
  aiWaitReasoning: text('ai_wait_reasoning').notNull().default(''),
  totalCents: integer('total_cents').notNull().default(0),
  handoffToken: text('handoff_token').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: uuid('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull(),
  menuItemId: integer('menu_item_id')
    .references(() => menuItems.id)
    .notNull(),
  itemName: text('item_name').notNull(),
  quantity: integer('quantity').notNull().default(1),
  modifiers: text('modifiers').notNull().default(''),
  unitPriceCents: integer('unit_price_cents').notNull(),
});

export const kdsTicketStages = pgTable('kds_ticket_stages', {
  id: serial('id').primaryKey(),
  orderId: uuid('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull(),
  stage: text('stage').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  baristaNote: text('barista_note').notNull().default(''),
  slaTargetSeconds: integer('sla_target_seconds').notNull().default(90),
});

export const communityVibes = pgTable(
  'community_vibes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerUid: text('customer_uid').notNull(),
    displayName: text('display_name').notNull(),
    tableZone: text('table_zone').notNull(),
    focusTag: text('focus_tag').notNull(),
    focusDescription: text('focus_description').notNull(),
    openToConnect: boolean('open_to_connect').notNull().default(true),
    embedding: vector('embedding', { dimensions: 768 }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('community_vibes_expires_idx').on(table.expiresAt),
  ]
);

export const ambientTelemetryLogs = pgTable('ambient_telemetry_logs', {
  id: serial('id').primaryKey(),
  zone: text('zone').notNull(),
  decibels: real('decibels'),
  feedbackType: text('feedback_type').notNull(),
  rawMessage: text('raw_message').notNull(),
  severity: text('severity').notNull().default('LOW'),
  aiCategory: text('ai_category').notNull().default('General'),
  aiCorrectiveAction: text('ai_corrective_action').notNull().default(''),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const orderFeedback = pgTable('order_feedback', {
  id: serial('id').primaryKey(),
  orderId: uuid('order_id')
    .references(() => orders.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  orderCode: text('order_code').notNull(),
  customerName: text('customer_name').notNull(),
  drinkQualityRating: integer('drink_quality_rating').notNull(),
  serviceExperienceRating: integer('service_experience_rating').notNull(),
  comment: text('comment').notNull().default(''),
  acknowledgedByKds: boolean('acknowledged_by_kds').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  stages: many(kdsTicketStages),
  feedback: one(orderFeedback, {
    fields: [orders.id],
    references: [orderFeedback.orderId],
  }),
}));

export const orderFeedbackRelations = relations(orderFeedback, ({ one }) => ({
  order: one(orders, {
    fields: [orderFeedback.orderId],
    references: [orders.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
}));

export const kdsTicketStagesRelations = relations(kdsTicketStages, ({ one }) => ({
  order: one(orders, {
    fields: [kdsTicketStages.orderId],
    references: [orders.id],
  }),
}));
