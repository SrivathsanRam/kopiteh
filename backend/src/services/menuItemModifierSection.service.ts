import type { MenuItemModifierSectionPayload } from "../types/payloads";
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

const SECTION_COLUMNS = new Set(["item_id", "name", "min_selections", "max_selections"]);

export const MenuItemModifierSectionService = {
  async findAllByItem(itemId: number): Promise<ServiceResult<any[]>> {
    try {
      return successResponse(
        SuccessCodes.OK,
        sortByNumericId(await getWhere(Collections.modifierSections, "item_id", itemId), "section_id"),
      );
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const section = await getById(Collections.modifierSections, id);
      if (!section) return errorResponse(ErrorCodes.NOT_FOUND, "Modifier section not found");
      return successResponse(SuccessCodes.OK, section);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: MenuItemModifierSectionPayload): Promise<ServiceResult<any>> {
    try {
      const section_id = await nextId(Collections.modifierSections);
      const section = {
        section_id,
        item_id: payload.item_id,
        name: payload.name,
        min_selections: payload.min_selections ?? 0,
        max_selections: payload.max_selections ?? 1,
      };
      await documentById(Collections.modifierSections, section_id).set(section);
      return successResponse(SuccessCodes.CREATED, section);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: Partial<MenuItemModifierSectionPayload>): Promise<ServiceResult<any>> {
    const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => SECTION_COLUMNS.has(key)));
    if (Object.keys(updates).length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
    }
    try {
      const section = await updateDocument(Collections.modifierSections, id, updates);
      if (!section) return errorResponse(ErrorCodes.NOT_FOUND, "Modifier section not found");
      return successResponse(SuccessCodes.OK, section);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.modifierSections, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Modifier section not found");
      }
      const options = await getWhere(Collections.modifiers, "section_id", id);
      await Promise.all(options.map((option) => documentById(Collections.modifiers, option.option_id).delete()));
      await documentById(Collections.modifierSections, id).delete();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
