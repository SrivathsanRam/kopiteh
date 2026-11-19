import { Collections, documentById, getById, getWhere } from "./firestore.service";
import { OrderItemStatusCodes, OrderStatusCodes } from "../types/orderStatus";

export function orderItemTotal(item: Record<string, any>): number {
  const modifierTotal = (item.modifiers ?? []).reduce(
    (sum: number, modifier: Record<string, any>) =>
      sum + Number(modifier.price ?? modifier.price_modifier ?? 0),
    0,
  );
  return (Number(item.price ?? 0) + modifierTotal) * Number(item.quantity ?? 0);
}

export async function recalculateOrder(orderId: number): Promise<Record<string, any> | null> {
  const order = await getById(Collections.orders, orderId);
  if (!order) return null;

  const items = (await getWhere(Collections.orderItems, "order_id", orderId)).filter(
    (item) => item.type === "STANDARD",
  );
  const allFinal = items.length > 0 && items.every((item) =>
    [OrderItemStatusCodes.SERVED, OrderItemStatusCodes.CANCELLED].includes(item.status),
  );
  const allCancelled = items.length === 0 || items.every(
    (item) => item.status === OrderItemStatusCodes.CANCELLED,
  );
  const status = allFinal
    ? allCancelled
      ? OrderStatusCodes.CANCELLED
      : OrderStatusCodes.COMPLETED
    : OrderStatusCodes.PENDING;
  const total_price = Number(
    items.reduce((sum, item) => sum + orderItemTotal(item), 0).toFixed(2),
  );
  await documentById(Collections.orders, orderId).update({ status, total_price });
  return { ...order, status, total_price };
}
