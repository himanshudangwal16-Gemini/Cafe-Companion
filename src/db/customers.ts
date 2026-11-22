import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { customers } from './schema.ts';

export async function getOrCreateCustomer(
  uid: string,
  email: string,
  displayName?: string
) {
  const safeName = displayName?.trim() || email.split('@')[0] || 'Café Guest';
  try {
    const result = await db
      .insert(customers)
      .values({
        uid,
        email,
        displayName: safeName,
      })
      .onConflictDoUpdate({
        target: customers.uid,
        set: {
          email,
          displayName: safeName,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to upsert customer record:', error);
    throw new Error('Unable to synchronize customer profile.', { cause: error });
  }
}

export async function updateCustomerPreferences(
  uid: string,
  dietaryLimits: string[],
  tasteNotes: string
) {
  try {
    const result = await db
      .update(customers)
      .set({
        dietaryLimits,
        tasteNotes,
      })
      .where(eq(customers.uid, uid))
      .returning();
    return result[0] ?? null;
  } catch (error) {
    console.error('Failed to update customer preferences:', error);
    throw new Error('Unable to update dietary and taste preferences.', {
      cause: error,
    });
  }
}
