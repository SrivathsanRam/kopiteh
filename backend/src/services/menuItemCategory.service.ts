import type { MenuItemCategoryPayload, UpdateMenuItemCategoryPayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import {
  Collections,
  documentById,
  getById,
  getWhere,
  nextId,
  updateDocument,
} from "./firestore.service";

const CATEGORY_COLUMNS = new Set(["stall_id", "name", "sort_order"]);

export const MenuItemCategoryService = {
  async findAllByStall(stall_id: number): Promise<ServiceResult<any[]>> {
    try {
      const categories = await getWhere(Collections.categories, "stall_id", stall_id);
      categories.sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || Number(a.category_id) - Number(b.category_id));
      return successResponse(SuccessCodes.OK, categories);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const category = await getById(Collections.categories, id);
      if (!category) return errorResponse(ErrorCodes.NOT_FOUND, "Menu item category not found");
      return successResponse(SuccessCodes.OK, category);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: MenuItemCategoryPayload): Promise<ServiceResult<any>> {
    try {
      const category_id = await nextId(Collections.categories);
      const category = {
        category_id,
        stall_id: payload.stall_id,
        name: payload.name,
        sort_order: payload.sort_order ?? await this.nextSortOrderForStall(payload.stall_id),
      };
      await documentById(Collections.categories, category_id).set(category);
      return successResponse(SuccessCodes.CREATED, category);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: UpdateMenuItemCategoryPayload): Promise<ServiceResult<any>> {
    const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => CATEGORY_COLUMNS.has(key)));
    if (Object.keys(updates).length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
    }
    try {
      const category = await updateDocument(Collections.categories, id, updates);
      if (!category) return errorResponse(ErrorCodes.NOT_FOUND, "Menu item category not found");
      return successResponse(SuccessCodes.OK, category);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.categories, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Menu item category not found");
      }
      const items = await getWhere(Collections.menuItems, "category_id", id);
      for (const item of items) {
        await documentById(Collections.menuItems, item.item_id).update({ category_id: null });
      }
      await documentById(Collections.categories, id).delete();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async nextSortOrderForStall(stall_id: number): Promise<number> {
    const categories = await getWhere(Collections.categories, "stall_id", stall_id);
    return Math.max(-1, ...categories.map((category) => Number(category.sort_order ?? -1))) + 1;
  },
};
