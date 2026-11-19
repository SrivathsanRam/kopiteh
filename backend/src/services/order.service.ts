import type { OrderPayload, UpdateOrderPayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { db } from "../config/firebase";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import { OrderStatusCodes, OrderItemStatusCodes } from "../types/orderStatus";
import { WebSocketService } from "./websocket.service";
import {
  Collections,
  documentById,
  getAll,
  getById,
  getWhere,
  nextId,
  reserveIds,
  updateDocument,
} from "./firestore.service";
import { orderItemTotal, recalculateOrder } from "./order-state.service";

const ORDER_COLUMNS = new Set(["status", "total_price", "created_at", "volunteer_name"]);

function inLastSevenDays(value: string) {
  return new Date(value).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000;
}

export const OrderService = {
  async findByUser(user_id: number): Promise<ServiceResult<any[]>> {
    try {
      const orders = (await getWhere(Collections.orders, "user_id", user_id))
        .filter((order) => inLastSevenDays(order.created_at))
        .sort((a, b) => Number(a.order_id) - Number(b.order_id));
      return successResponse(SuccessCodes.OK, orders);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findByStall(stall_id: number): Promise<ServiceResult<any[]>> {
    try {
      const items = (await getWhere(Collections.orderItems, "stall_id", stall_id)).filter(
        (item) => item.type === "STANDARD" && inLastSevenDays(item.created_at),
      );
      const ids = [...new Set(items.map((item) => Number(item.order_id)))];
      const orders = (await Promise.all(ids.map((id) => getById(Collections.orders, id))))
        .filter(Boolean)
        .sort((a, b) => Number(a!.order_id) - Number(b!.order_id));
      return successResponse(SuccessCodes.OK, orders);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findByTable(table_id: number): Promise<ServiceResult<any[]>> {
    try {
      const orders = (await getWhere(Collections.orders, "table_id", table_id))
        .filter((order) => inLastSevenDays(order.created_at))
        .sort((a, b) => Number(a.order_id) - Number(b.order_id));
      return successResponse(SuccessCodes.OK, orders);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const order = await getById(Collections.orders, id);
      if (!order) return errorResponse(ErrorCodes.NOT_FOUND, "Order not found");
      return successResponse(SuccessCodes.OK, order);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(request: OrderPayload): Promise<ServiceResult<any>> {
    try {
      const table = await getById(Collections.tables, request.table_id);
      if (!table || table.is_active !== true) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, `Table ID ${request.table_id} does not exist or is inactive`);
      }
      const venue = await getById(Collections.venues, table.venue_id);
      const order_id = await nextId(Collections.orders);
      const itemIds = await reserveIds(Collections.orderItems, request.items.length);
      const created_at = new Date().toISOString();
      const orderItems: Record<string, any>[] = [];

      for (let index = 0; index < request.items.length; index += 1) {
        const requestedItem = request.items[index];
        const menuItem = await getById(Collections.menuItems, requestedItem.item_id);
        if (!menuItem || menuItem.is_available === false) {
          return errorResponse(ErrorCodes.VALIDATION_ERROR, `Menu item ${requestedItem.item_id} is unavailable`);
        }
        const stall = await getById(Collections.stalls, menuItem.stall_id);
        if (!stall || stall.is_open === false) {
          return errorResponse(ErrorCodes.VALIDATION_ERROR, `Stall for item ${requestedItem.item_id} is closed`);
        }

        const selectedModifiers: Record<string, any>[] = [];
        for (const requestedModifier of requestedItem.modifiers ?? []) {
          const modifier = await getById(Collections.modifiers, requestedModifier.option_id);
          if (!modifier || Number(modifier.item_id) !== Number(menuItem.item_id) || modifier.is_available === false) {
            return errorResponse(ErrorCodes.VALIDATION_ERROR, `Modifier ${requestedModifier.option_id} is unavailable for this item`);
          }
          selectedModifiers.push({
            option_id: modifier.option_id,
            name: modifier.name,
            price: Number(modifier.price_modifier),
            price_modifier: Number(modifier.price_modifier),
          });
        }

        const price = Number(menuItem.price);
        const quantity = Number(requestedItem.quantity);
        const modifierTotal = selectedModifiers.reduce((sum, modifier) => sum + Number(modifier.price), 0);
        orderItems.push({
          order_item_id: itemIds[index],
          order_id,
          type: "STANDARD",
          item_id: menuItem.item_id,
          stall_id: stall.stall_id,
          stall_name: stall.name,
          venue_id: table.venue_id,
          venue_name: venue?.name ?? null,
          table_id: table.table_id,
          table_number: table.table_number,
          user_id: null,
          order_item_name: menuItem.name,
          status: OrderItemStatusCodes.INCOMING,
          quantity,
          price,
          prep_time: Number(menuItem.prep_time ?? 0),
          modifiers: selectedModifiers,
          line_total: Number(((price + modifierTotal) * quantity).toFixed(2)),
          created_at,
          remarks: requestedItem.remarks ?? requestedItem.notes ?? null,
          volunteer_name: request.volunteer_name,
        });
      }

      const total_price = Number(orderItems.reduce((sum, item) => sum + Number(item.line_total), 0).toFixed(2));
      const order = {
        order_id,
        table_id: table.table_id,
        table_number: table.table_number,
        venue_id: table.venue_id,
        venue_name: venue?.name ?? null,
        user_id: null,
        status: OrderStatusCodes.PENDING,
        total_price,
        created_at,
        volunteer_name: request.volunteer_name,
      };

      const batch = db.batch();
      batch.set(documentById(Collections.orders, order_id), order);
      for (const item of orderItems) {
        batch.set(documentById(Collections.orderItems, item.order_item_id), item);
      }
      await batch.commit();

      for (const item of orderItems) {
        WebSocketService.notifyStallOrderItemCreated(item.stall_id, item);
        WebSocketService.notifyTableOrderItemCreated(item.table_id, item);
      }
      return successResponse(SuccessCodes.CREATED, { order_id });
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: UpdateOrderPayload): Promise<ServiceResult<any>> {
    const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => ORDER_COLUMNS.has(key)));
    if (Object.keys(updates).length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
    }
    try {
      const order = await updateDocument(Collections.orders, id, updates);
      if (!order) return errorResponse(ErrorCodes.NOT_FOUND, "Order not found");
      return successResponse(SuccessCodes.OK, order);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async updateStatus(id: number): Promise<ServiceResult<any>> {
    try {
      const order = await recalculateOrder(id);
      if (!order) return errorResponse(ErrorCodes.NOT_FOUND, "Order not found");
      WebSocketService.notifyTableOrderStatusChange(order.table_id, id, order.status);
      return successResponse(SuccessCodes.OK, order);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.orders, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Order not found");
      }
      const items = await getWhere(Collections.orderItems, "order_id", id);
      const batch = db.batch();
      for (const item of items) batch.delete(documentById(Collections.orderItems, item.order_item_id));
      batch.delete(documentById(Collections.orders, id));
      await batch.commit();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async getMonthlyAnalytics(year: number, month: number, venueId?: number): Promise<ServiceResult<any>> {
    try {
      const start = new Date(year, month - 1, 1).getTime();
      const end = new Date(year, month, 1).getTime();
      const orders = await getAll(Collections.orders);
      const completedOrderIds = new Set(
        orders
          .filter((order) => order.status === OrderStatusCodes.COMPLETED)
          .map((order) => Number(order.order_id)),
      );
      const items = (await getAll(Collections.orderItems)).filter((item) => {
        const time = new Date(item.created_at).getTime();
        const correctDate = time >= start && time < end;
        const correctVenue = venueId === undefined || Number(item.venue_id) === venueId;
        const completed = item.type === "CUSTOM"
          ? item.status === OrderItemStatusCodes.SERVED
          : completedOrderIds.has(Number(item.order_id));
        return correctDate && correctVenue && completed;
      });

      const orderKeys = new Set(items.map((item) => String(item.order_id)));
      const stallTotals = new Map<number, { stall_id: number; stall_name: string; keys: Set<string>; total_amount: number }>();
      let totalAmount = 0;
      for (const item of items) {
        const amount = Number(item.line_total ?? orderItemTotal(item));
        totalAmount += amount;
        const stallId = Number(item.stall_id);
        const current = stallTotals.get(stallId) ?? {
          stall_id: stallId,
          stall_name: String(item.stall_name ?? ""),
          keys: new Set<string>(),
          total_amount: 0,
        };
        current.keys.add(String(item.order_id));
        current.total_amount += amount;
        stallTotals.set(stallId, current);
      }

      return successResponse(SuccessCodes.OK, {
        total_orders: orderKeys.size,
        total_amount: Number(totalAmount.toFixed(2)),
        stalls: [...stallTotals.values()]
          .map((stall) => ({
            stall_id: stall.stall_id,
            stall_name: stall.stall_name,
            total_orders: stall.keys.size,
            total_amount: Number(stall.total_amount.toFixed(2)),
          }))
          .sort((a, b) => a.stall_name.localeCompare(b.stall_name)),
      });
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async getAllWithFilters(filters: {
    startDate?: string;
    endDate?: string;
    tableNumber?: string;
    tableId?: number;
    venueId?: number;
    stallId?: number;
    page?: number;
    limit?: number;
  }): Promise<ServiceResult<any>> {
    try {
      const allItems = await getAll(Collections.orderItems);
      const standardItems = allItems.filter((item) => item.type === "STANDARD");
      const customItems = allItems.filter((item) => item.type === "CUSTOM");
      const stallOrderIds = filters.stallId === undefined
        ? null
        : new Set(
            standardItems
              .filter((item) => Number(item.stall_id) === filters.stallId)
              .map((item) => Number(item.order_id)),
          );

      const standardOrders: any[] = (await getAll(Collections.orders)).map((order) => ({
        ...order,
        user_name: order.volunteer_name,
        order_type: "STANDARD",
      }));
      const customOrders: any[] = customItems.map((item) => ({
        order_id: item.order_id,
        table_id: item.table_id,
        user_id: item.user_id ?? null,
        status: item.status,
        user_name: item.volunteer_name,
        total_price: item.line_total ?? orderItemTotal(item),
        created_at: item.created_at,
        table_number: item.table_number,
        venue_id: item.venue_id,
        venue_name: item.venue_name,
        order_type: "CUSTOM",
        order_item_name: item.order_item_name,
        quantity: item.quantity,
        unit_price: item.price,
        stall_id: item.stall_id,
        stall_name: item.stall_name,
      }));

      const start = filters.startDate ? new Date(filters.startDate).getTime() : null;
      const end = filters.endDate ? new Date(filters.endDate).getTime() : null;
      const rows: any[] = [...standardOrders, ...customOrders]
        .filter((order) => {
          const time = new Date(order.created_at).getTime();
          if (start !== null && time < start) return false;
          if (end !== null && time > end) return false;
          if (filters.tableNumber !== undefined && String(order.table_number) !== filters.tableNumber) return false;
          if (filters.tableId !== undefined && Number(order.table_id) !== filters.tableId) return false;
          if (filters.venueId !== undefined && Number(order.venue_id) !== filters.venueId) return false;
          if (filters.stallId !== undefined) {
            return order.order_type === "CUSTOM"
              ? Number(order.stall_id) === filters.stallId
              : stallOrderIds!.has(Number(order.order_id));
          }
          return true;
        })
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      const page = filters.page || 1;
      const limit = filters.limit || 15;
      const offset = (page - 1) * limit;
      return successResponse(SuccessCodes.OK, {
        orders: rows.slice(offset, offset + limit),
        pagination: {
          page,
          limit,
          total: rows.length,
          totalPages: Math.ceil(rows.length / limit),
        },
      });
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
