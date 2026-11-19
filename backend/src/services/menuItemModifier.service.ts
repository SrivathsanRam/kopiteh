import type { MenuItemModifierPayload } from "../types/payloads";
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
  sortByNumericId,
  updateDocument,
} from "./firestore.service";

const MODIFIER_COLUMNS = new Set(["item_id", "section_id", "name", "price_modifier", "is_available"]);

export const MenuItemModifierService = {
  async findAllByItem(itemId: number): Promise<ServiceResult<any[]>> {
    try {
      return successResponse(SuccessCodes.OK, sortByNumericId(await getWhere(Collections.modifiers, "item_id", itemId), "option_id"));
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findAllBySection(sectionId: number): Promise<ServiceResult<any[]>> {
    try {
      return successResponse(SuccessCodes.OK, sortByNumericId(await getWhere(Collections.modifiers, "section_id", sectionId), "option_id"));
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const modifier = await getById(Collections.modifiers, id);
      if (!modifier) return errorResponse(ErrorCodes.NOT_FOUND, "Modifier not found");
      return successResponse(SuccessCodes.OK, modifier);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: MenuItemModifierPayload): Promise<ServiceResult<any>> {
    try {
      const option_id = await nextId(Collections.modifiers);
      const modifier = {
        option_id,
        section_id: payload.section_id,
        item_id: payload.item_id,
        name: payload.name,
        price_modifier: payload.price_modifier ?? 0,
        is_available: payload.is_available ?? true,
      };
      await documentById(Collections.modifiers, option_id).set(modifier);
      return successResponse(SuccessCodes.CREATED, modifier);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: Partial<MenuItemModifierPayload>): Promise<ServiceResult<any>> {
    const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => MODIFIER_COLUMNS.has(key)));
    if (Object.keys(updates).length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
    }
    try {
      const modifier = await updateDocument(Collections.modifiers, id, updates);
      if (!modifier) return errorResponse(ErrorCodes.NOT_FOUND, "Modifier not found");
      return successResponse(SuccessCodes.OK, modifier);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.modifiers, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Modifier not found");
      }
      await documentById(Collections.modifiers, id).delete();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
