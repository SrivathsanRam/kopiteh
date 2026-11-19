import type { VenuePayload, UpdateVenuePayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import {
  Collections,
  deleteDocuments,
  documentById,
  getAll,
  getById,
  getWhere,
  nextId,
  sortByNumericId,
  sortTables,
  updateDocument,
  withoutUndefined,
} from "./firestore.service";

const VENUE_COLUMNS = new Set([
  "name", "address", "description", "image_url", "opening_hours",
]);

export const VenueService = {
  async findAll(): Promise<ServiceResult<any[]>> {
    try {
      return successResponse(
        SuccessCodes.OK,
        sortByNumericId(await getAll(Collections.venues), "venue_id"),
      );
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const venue = await getById(Collections.venues, id);
      if (!venue) return errorResponse(ErrorCodes.NOT_FOUND, "Venue not found");
      return successResponse(SuccessCodes.OK, venue);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: VenuePayload): Promise<ServiceResult<any>> {
    try {
      const venue_id = await nextId(Collections.venues);
      const venue = withoutUndefined({
        venue_id,
        name: payload.name,
        address: payload.address ?? null,
        description: payload.description ?? null,
        image_url: payload.image_url ?? null,
        opening_hours: payload.opening_hours ?? null,
      });
      await documentById(Collections.venues, venue_id).set(venue);
      return successResponse(SuccessCodes.CREATED, venue);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: UpdateVenuePayload): Promise<ServiceResult<any>> {
    const updates = Object.fromEntries(
      Object.entries(payload).filter(([key]) => VENUE_COLUMNS.has(key)),
    );
    if (Object.keys(updates).length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
    }

    try {
      const venue = await updateDocument(Collections.venues, id, updates);
      if (!venue) return errorResponse(ErrorCodes.NOT_FOUND, "Venue not found");
      return successResponse(SuccessCodes.OK, venue);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.venues, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Venue not found");
      }
      const [orders, orderItems] = await Promise.all([
        getWhere(Collections.orders, "venue_id", id),
        getWhere(Collections.orderItems, "venue_id", id),
      ]);
      if (orders.length > 0 || orderItems.length > 0) {
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          "Venue has order history and cannot be removed",
        );
      }

      const [stalls, tables] = await Promise.all([
        getWhere(Collections.stalls, "venue_id", id),
        getWhere(Collections.tables, "venue_id", id),
      ]);
      const stallIds = new Set(stalls.map((stall) => Number(stall.stall_id)));
      const [allCategories, allMenuItems] = await Promise.all([
        getAll(Collections.categories),
        getAll(Collections.menuItems),
      ]);
      const categories = allCategories.filter((category) =>
        stallIds.has(Number(category.stall_id)),
      );
      const menuItems = allMenuItems.filter((item) =>
        stallIds.has(Number(item.stall_id)),
      );
      const itemIds = new Set(menuItems.map((item) => Number(item.item_id)));
      const [allSections, allModifiers] = await Promise.all([
        getAll(Collections.modifierSections),
        getAll(Collections.modifiers),
      ]);
      const sections = allSections.filter((section) =>
        itemIds.has(Number(section.item_id)),
      );
      const modifiers = allModifiers.filter((modifier) =>
        itemIds.has(Number(modifier.item_id)),
      );

      await deleteDocuments([
        ...modifiers.map((modifier) => documentById(Collections.modifiers, modifier.option_id)),
        ...sections.map((section) => documentById(Collections.modifierSections, section.section_id)),
        ...menuItems.map((item) => documentById(Collections.menuItems, item.item_id)),
        ...categories.map((category) => documentById(Collections.categories, category.category_id)),
        ...tables.map((table) => documentById(Collections.tables, table.table_id)),
        ...stalls.map((stall) => documentById(Collections.stalls, stall.stall_id)),
        documentById(Collections.venues, id),
      ]);
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findTables(id: number): Promise<ServiceResult<any[]>> {
    try {
      const tables = (await getWhere(Collections.tables, "venue_id", id)).filter(
        (table) => table.is_active === true,
      );
      return successResponse(SuccessCodes.OK, sortTables(tables));
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
