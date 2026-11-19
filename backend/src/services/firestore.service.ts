import type {
  DocumentData,
  DocumentReference,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase";

export const Collections = {
  venues: "venues",
  tables: "tables",
  stalls: "stalls",
  categories: "menuItemCategories",
  menuItems: "menuItems",
  modifierSections: "modifierSections",
  modifiers: "modifiers",
  users: "users",
  orders: "orders",
  orderItems: "orderItems",
  counters: "_counters",
} as const;

export function documentById(
  collection: string,
  id: number | string,
): DocumentReference<DocumentData> {
  return db.collection(collection).doc(String(id));
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

export function snapshotData(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): Record<string, any> {
  return snapshot.data() as Record<string, any>;
}

export async function getById(
  collection: string,
  id: number | string,
): Promise<Record<string, any> | null> {
  const snapshot = await documentById(collection, id).get();
  return snapshot.exists ? (snapshot.data() as Record<string, any>) : null;
}

export async function getAll(collection: string): Promise<Record<string, any>[]> {
  const snapshot = await db.collection(collection).get();
  return snapshot.docs.map(snapshotData);
}

export async function getWhere(
  collection: string,
  field: string,
  value: string | number | boolean | null,
): Promise<Record<string, any>[]> {
  const snapshot = await db.collection(collection).where(field, "==", value).get();
  return snapshot.docs.map(snapshotData);
}

export async function reserveIds(collection: string, count = 1): Promise<number[]> {
  if (count <= 0) return [];

  const counterRef = documentById(Collections.counters, collection);
  return db.runTransaction(async (transaction) => {
    const counter = await transaction.get(counterRef);
    const current = Number(counter.data()?.value ?? 0);
    const ids = Array.from({ length: count }, (_, index) => current + index + 1);
    transaction.set(counterRef, { value: current + count }, { merge: true });
    return ids;
  });
}

export async function nextId(collection: string): Promise<number> {
  return (await reserveIds(collection, 1))[0];
}

export async function ensureCounterAtLeast(
  collection: string,
  minimum: number,
): Promise<void> {
  const counterRef = documentById(Collections.counters, collection);
  await db.runTransaction(async (transaction) => {
    const counter = await transaction.get(counterRef);
    const current = Number(counter.data()?.value ?? 0);
    if (minimum > current) transaction.set(counterRef, { value: minimum });
  });
}

export async function deleteDocuments(
  references: DocumentReference<DocumentData>[],
): Promise<void> {
  for (let start = 0; start < references.length; start += 450) {
    const batch = db.batch();
    for (const reference of references.slice(start, start + 450)) {
      batch.delete(reference);
    }
    await batch.commit();
  }
}

export async function updateDocument(
  collection: string,
  id: number | string,
  payload: Record<string, unknown>,
): Promise<Record<string, any> | null> {
  const reference = documentById(collection, id);
  const snapshot = await reference.get();
  if (!snapshot.exists) return null;
  await reference.update(withoutUndefined(payload));
  return getById(collection, id);
}

export const serverTimestamp = FieldValue.serverTimestamp;

export function sortByNumericId<T extends Record<string, any>>(
  items: T[],
  field: keyof T,
): T[] {
  return items.sort((left, right) => Number(left[field]) - Number(right[field]));
}

export function sortTables<T extends { table_number?: unknown }>(items: T[]): T[] {
  return items.sort((left, right) => {
    const a = String(left.table_number ?? "");
    const b = String(right.table_number ?? "");
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) - Number(b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.localeCompare(b);
  });
}
