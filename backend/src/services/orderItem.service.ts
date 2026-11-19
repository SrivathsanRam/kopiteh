import type {
  CustomOrderItemPayload,
  FetchOrderItemResponsePayload,
  OrderItemPayload,
  UpdateCustomOrderItemPayload,
  UpdateOrderItemPayload,
} from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import {
  NextOrderItemStatusMap,
  OrderItemStatusCodes,
  PreviousOrderItemStatusMap,
} from "../types/orderStatus";
import { WebSocketService } from "./websocket.service";
import {
  Collections,
  documentById,
  getById,
  getWhere,
  nextId,
} from "./firestore.service";
import { orderItemTotal, recalculateOrder } from "./order-state.service";

function recent(item: Record<string, any>) {
  return new Date(item.created_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000;
}

async function withMenuModifiers(item: Record<string, any>) {
  if (item.type !== "STANDARD" || !item.item_id) return item;
  const menuModifiers = await getWhere(Collections.modifiers, "item_id", Number(item.item_id));
  return {
    ...item,
    modifiers: item.modifiers ?? [],
    menuModifiers: menuModifiers.map((modifier) => ({
      option_id: modifier.option_id,
      name: modifier.name,
      price: modifier.price_modifier,
      price_modifier: modifier.price_modifier,
    })),
  };
}

function notifyUpdated(item: Record<string, any>) {
  WebSocketService.notifyStallOrderItemUpdated(Number(item.stall_id), item);
  WebSocketService.notifyTableOrderItemUpdated(Number(item.table_id), item);
}

async function syncOrderStatus(orderId: number) {
  const order = await recalculateOrder(orderId);
  if (order) {
    WebSocketService.notifyTableOrderStatusChange(
      Number(order.table_id),
      orderId,
      String(order.status),
    );
  }
}

async function getTypedItem(id: number, type: "STANDARD" | "CUSTOM") {
  const item = await getById(Collections.orderItems, id);
  return item?.type === type ? item : null;
}

export const OrderItemService = {
  async findByOrder(order_id: number): Promise<ServiceResult<FetchOrderItemResponsePayload[]>> {
    try {
      const items = (await getWhere(Collections.orderItems, "order_id", order_id))
        .filter((item) => item.type === "STANDARD")
        .sort((a, b) => Number(a.order_item_id) - Number(b.order_item_id));
      return successResponse(SuccessCodes.OK, items as FetchOrderItemResponsePayload[]);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findByStall(stall_id: number): Promise<ServiceResult<FetchOrderItemResponsePayload[]>> {
    try {
      const items = (await getWhere(Collections.orderItems, "stall_id", stall_id))
        .filter(recent)
        .sort((a, b) => Number(a.order_item_id) - Number(b.order_item_id));
      return successResponse(SuccessCodes.OK, items as FetchOrderItemResponsePayload[]);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number, type: "STANDARD" | "CUSTOM"): Promise<ServiceResult<FetchOrderItemResponsePayload>> {
    try {
      const item = await getTypedItem(id, type);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, `${type === "CUSTOM" ? "Custom " : ""}Order Item not found`);
      return successResponse(SuccessCodes.OK, await withMenuModifiers(item) as FetchOrderItemResponsePayload);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(
    request: OrderItemPayload | CustomOrderItemPayload,
    type: "STANDARD" | "CUSTOM",
  ): Promise<ServiceResult<any>> {
    try {
      const order_item_id = await nextId(Collections.orderItems);
      const created_at = new Date().toISOString();

      if (type === "STANDARD") {
        const payload = request as OrderItemPayload;
        if (!payload.order_id) return errorResponse(ErrorCodes.VALIDATION_ERROR, "order_id is required");
        const [order, menuItem] = await Promise.all([
          getById(Collections.orders, payload.order_id),
          getById(Collections.menuItems, payload.item_id),
        ]);
        if (!order || !menuItem) return errorResponse(ErrorCodes.NOT_FOUND, "Order or menu item not found");
        const stall = await getById(Collections.stalls, menuItem.stall_id);
        const modifiers = (payload.modifiers ?? []).map((modifier) => ({
          option_id: modifier.option_id,
          name: modifier.name,
          price: Number(modifier.price),
          price_modifier: Number(modifier.price),
        }));
        const item = {
          order_item_id,
          order_id: payload.order_id,
          type,
          item_id: menuItem.item_id,
          stall_id: menuItem.stall_id,
          stall_name: stall?.name ?? null,
          venue_id: order.venue_id,
          venue_name: order.venue_name,
          table_id: order.table_id,
          table_number: order.table_number,
          user_id: order.user_id ?? null,
          order_item_name: menuItem.name,
          status: OrderItemStatusCodes.INCOMING,
          quantity: Number(payload.quantity),
          price: Number(menuItem.price),
          prep_time: Number(menuItem.prep_time ?? 0),
          modifiers,
          created_at,
          remarks: payload.remarks ?? payload.notes ?? null,
          volunteer_name: order.volunteer_name,
        };
        (item as any).line_total = Number(orderItemTotal(item).toFixed(2));
        await documentById(Collections.orderItems, order_item_id).set(item);
        await syncOrderStatus(payload.order_id);
        WebSocketService.notifyStallOrderItemCreated(Number(item.stall_id), item);
        WebSocketService.notifyTableOrderItemCreated(Number(item.table_id), item);
        return successResponse(SuccessCodes.CREATED, item);
      }

      const payload = request as CustomOrderItemPayload;
      const [stall, table] = await Promise.all([
        getById(Collections.stalls, payload.stall_id),
        getById(Collections.tables, payload.table_id),
      ]);
      if (!stall || !table || table.is_active !== true) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, "Stall or active table not found");
      }
      const venue = await getById(Collections.venues, stall.venue_id);
      const item = {
        order_item_id,
        order_id: `CUSTOM-${order_item_id}`,
        type,
        stall_id: payload.stall_id,
        stall_name: stall.name,
        venue_id: stall.venue_id,
        venue_name: venue?.name ?? null,
        table_id: payload.table_id,
        table_number: table.table_number,
        user_id: null,
        order_item_name: payload.order_item_name,
        status: OrderItemStatusCodes.INCOMING,
        quantity: Number(payload.quantity),
        price: Number(payload.price),
        prep_time: 0,
        modifiers: [],
        line_total: Number((Number(payload.price) * Number(payload.quantity)).toFixed(2)),
        created_at,
        remarks: payload.remarks ?? null,
        volunteer_name: payload.volunteer_name,
      };
      await documentById(Collections.orderItems, order_item_id).set(item);
      WebSocketService.notifyStallOrderItemCreated(Number(item.stall_id), item);
      WebSocketService.notifyTableOrderItemCreated(Number(item.table_id), item);
      return successResponse(SuccessCodes.CREATED, item);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(
    id: number,
    payload: UpdateOrderItemPayload | UpdateCustomOrderItemPayload,
    type: "STANDARD" | "CUSTOM",
  ): Promise<ServiceResult<FetchOrderItemResponsePayload>> {
    try {
      const item = await getTypedItem(id, type);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Order Item not found");
      const updates: Record<string, any> = {};
      if (payload.quantity !== undefined) updates.quantity = Number(payload.quantity);
      if (payload.remarks !== undefined) updates.remarks = payload.remarks ?? null;
      if (type === "CUSTOM") {
        const custom = payload as UpdateCustomOrderItemPayload & { name?: string };
        if (custom.order_item_name !== undefined || custom.name !== undefined) {
          updates.order_item_name = custom.order_item_name ?? custom.name;
        }
        if (custom.volunteer_name !== undefined) updates.volunteer_name = custom.volunteer_name;
        if (custom.price !== undefined) updates.price = Number(custom.price);
      } else if ((payload as UpdateOrderItemPayload).modifiers !== undefined) {
        updates.modifiers = ((payload as UpdateOrderItemPayload).modifiers ?? []).map((modifier: any) => ({
          option_id: Number(modifier.option_id),
          name: modifier.name,
          price: Number(modifier.price_modifier ?? modifier.price ?? 0),
          price_modifier: Number(modifier.price_modifier ?? modifier.price ?? 0),
        }));
      }
      if (Object.keys(updates).length === 0) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
      }
      const merged = { ...item, ...updates };
      updates.line_total = Number(orderItemTotal(merged).toFixed(2));
      await documentById(Collections.orderItems, id).update(updates);
      const updated = { ...merged, line_total: updates.line_total };
      if (type === "STANDARD") await syncOrderStatus(Number(item.order_id));
      notifyUpdated(updated);
      return successResponse(SuccessCodes.OK, await withMenuModifiers(updated) as FetchOrderItemResponsePayload);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async updateStatus(id: number, type: "STANDARD" | "CUSTOM"): Promise<ServiceResult<FetchOrderItemResponsePayload>> {
    try {
      const item = await getTypedItem(id, type);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Order Item not found");
      const nextStatus = NextOrderItemStatusMap[item.status as OrderItemStatusCodes];
      if (!nextStatus) return errorResponse(ErrorCodes.VALIDATION_ERROR, "Order Item is already in final status");
      const updated: Record<string, any> = { ...item, status: nextStatus };
      await documentById(Collections.orderItems, id).update({ status: nextStatus });
      if (type === "STANDARD") await syncOrderStatus(Number(item.order_id));
      notifyUpdated(updated);
      return successResponse(SuccessCodes.OK, updated as FetchOrderItemResponsePayload);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async revertStatus(id: number, type: "STANDARD" | "CUSTOM"): Promise<ServiceResult<FetchOrderItemResponsePayload>> {
    try {
      const item = await getTypedItem(id, type);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Order Item not found");
      const previous = PreviousOrderItemStatusMap[item.status as OrderItemStatusCodes];
      if (!previous) return errorResponse(ErrorCodes.VALIDATION_ERROR, "Cannot revert from current status");
      const updated: Record<string, any> = { ...item, status: previous };
      await documentById(Collections.orderItems, id).update({ status: previous });
      if (type === "STANDARD") await syncOrderStatus(Number(item.order_id));
      notifyUpdated(updated);
      return successResponse(SuccessCodes.OK, updated as FetchOrderItemResponsePayload);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async cancel(id: number, type: "STANDARD" | "CUSTOM"): Promise<ServiceResult<FetchOrderItemResponsePayload>> {
    try {
      const item = await getTypedItem(id, type);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Order Item not found");
      const updated: Record<string, any> = { ...item, status: OrderItemStatusCodes.CANCELLED };
      await documentById(Collections.orderItems, id).update({ status: OrderItemStatusCodes.CANCELLED });
      if (type === "STANDARD") await syncOrderStatus(Number(item.order_id));
      notifyUpdated(updated);
      return successResponse(SuccessCodes.OK, updated as FetchOrderItemResponsePayload);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number, type: "STANDARD" | "CUSTOM"): Promise<ServiceResult<null>> {
    try {
      const item = await getTypedItem(id, type);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Order Item not found");
      await documentById(Collections.orderItems, id).delete();
      if (type === "STANDARD") await syncOrderStatus(Number(item.order_id));
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findModifiersByOrderItem(orderItemId: number): Promise<ServiceResult<any[]>> {
    try {
      const item = await getById(Collections.orderItems, orderItemId);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Order Item not found");
      const modifiers = (item.modifiers ?? []).map((modifier: Record<string, any>, index: number) => ({
        order_item_option_id: index + 1,
        option_id: modifier.option_id,
        price_modifier: modifier.price ?? modifier.price_modifier ?? 0,
        option_name: modifier.name,
      }));
      return successResponse(SuccessCodes.OK, modifiers);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
