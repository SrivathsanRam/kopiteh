import type { MenuItemPayload, UpdateMenuItemPayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { db } from "../config/firebase";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import {
  Collections,
  documentById,
  ensureCounterAtLeast,
  getById,
  getWhere,
  nextId,
  reserveIds,
  sortByNumericId,
  withoutUndefined,
} from "./firestore.service";

const ITEM_COLUMNS = new Set([
  "stall_id", "category_id", "item_image", "name", "description",
  "price", "prep_time", "is_available",
]);

function menuItemDocument(item_id: number, payload: MenuItemPayload | UpdateMenuItemPayload) {
  return withoutUndefined({
    item_id,
    stall_id: payload.stall_id,
    category_id: payload.category_id ?? null,
    item_image: payload.item_image ?? null,
    name: payload.name,
    description: payload.description ?? null,
    price: payload.price,
    prep_time: payload.prep_time ?? 0,
    is_available: payload.is_available ?? true,
  });
}

async function writeModifierTree(
  itemId: number,
  sections: NonNullable<MenuItemPayload["modifier_sections"]>,
  batch: FirebaseFirestore.WriteBatch,
) {
  const missingSectionCount = sections.filter((section) => !section.section_id).length;
  const missingOptionCount = sections.reduce(
    (count, section) => count + (section.options ?? []).filter((option) => !option.option_id).length,
    0,
  );
  const newSectionIds = await reserveIds(Collections.modifierSections, missingSectionCount);
  const newOptionIds = await reserveIds(Collections.modifiers, missingOptionCount);
  let sectionIndex = 0;
  let optionIndex = 0;

  for (const section of sections) {
    const section_id = section.section_id
      ? Number(section.section_id)
      : newSectionIds[sectionIndex++];
    if (section.section_id) await ensureCounterAtLeast(Collections.modifierSections, section_id);

    batch.set(documentById(Collections.modifierSections, section_id), {
      section_id,
      item_id: itemId,
      name: section.name.trim(),
      min_selections: Number(section.min_selections),
      max_selections: Number(section.max_selections),
    });

    for (const option of section.options ?? []) {
      const option_id = option.option_id
        ? Number(option.option_id)
        : newOptionIds[optionIndex++];
      if (option.option_id) await ensureCounterAtLeast(Collections.modifiers, option_id);
      batch.set(documentById(Collections.modifiers, option_id), {
        option_id,
        section_id,
        item_id: itemId,
        name: option.name.trim(),
        price_modifier: Number(option.price_modifier),
        is_available: option.is_available ?? true,
      });
    }
  }
}

export const MenuItemService = {
  async findAllByStall(stall_id: number, category_id?: number): Promise<ServiceResult<any[]>> {
    try {
      let items = await getWhere(Collections.menuItems, "stall_id", stall_id);
      if (typeof category_id === "number" && !Number.isNaN(category_id)) {
        items = items.filter((item) => Number(item.category_id) === category_id);
      }
      return successResponse(SuccessCodes.OK, sortByNumericId(items, "item_id"));
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const item = await getById(Collections.menuItems, id);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Menu item not found");
      return successResponse(SuccessCodes.OK, item);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findDefault(stall_id: number): Promise<ServiceResult<any>> {
    try {
      const item = (await getWhere(Collections.menuItems, "stall_id", stall_id)).find(
        (candidate) => candidate.name === "Default Item",
      );
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Default menu item not found");
      return successResponse(SuccessCodes.OK, item);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: MenuItemPayload): Promise<ServiceResult<any>> {
    try {
      const item_id = await nextId(Collections.menuItems);
      const item = menuItemDocument(item_id, payload);
      const batch = db.batch();
      batch.set(documentById(Collections.menuItems, item_id), item);
      await writeModifierTree(item_id, payload.modifier_sections ?? [], batch);
      await batch.commit();
      return successResponse(SuccessCodes.CREATED, item);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: UpdateMenuItemPayload): Promise<ServiceResult<any>> {
    try {
      const current = await getById(Collections.menuItems, id);
      if (!current) return errorResponse(ErrorCodes.NOT_FOUND, "Menu item not found");

      const updates = Object.fromEntries(
        Object.entries(payload)
          .filter(([key]) => key !== "modifier_sections" && ITEM_COLUMNS.has(key))
          .map(([key, value]) => [key, value ?? null]),
      );
      const batch = db.batch();
      if (Object.keys(updates).length > 0) {
        batch.update(documentById(Collections.menuItems, id), updates);
      }

      if (payload.modifier_sections) {
        const [sections, options] = await Promise.all([
          getWhere(Collections.modifierSections, "item_id", id),
          getWhere(Collections.modifiers, "item_id", id),
        ]);
        for (const option of options) batch.delete(documentById(Collections.modifiers, option.option_id));
        for (const section of sections) batch.delete(documentById(Collections.modifierSections, section.section_id));
        await writeModifierTree(id, payload.modifier_sections, batch);
      }

      await batch.commit();
      return successResponse(SuccessCodes.OK, { ...current, ...updates });
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.menuItems, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Menu item not found");
      }
      const history = await getWhere(Collections.orderItems, "item_id", id);
      if (history.length > 0) {
        await documentById(Collections.menuItems, id).update({ is_available: false });
        return successResponse<null>(SuccessCodes.OK, null);
      }
      const [sections, options] = await Promise.all([
        getWhere(Collections.modifierSections, "item_id", id),
        getWhere(Collections.modifiers, "item_id", id),
      ]);
      const batch = db.batch();
      for (const option of options) batch.delete(documentById(Collections.modifiers, option.option_id));
      for (const section of sections) batch.delete(documentById(Collections.modifierSections, section.section_id));
      batch.delete(documentById(Collections.menuItems, id));
      await batch.commit();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async toggleAvailability(id: number): Promise<ServiceResult<any>> {
    try {
      const item = await getById(Collections.menuItems, id);
      if (!item) return errorResponse(ErrorCodes.NOT_FOUND, "Menu item not found");
      const updated = { ...item, is_available: !item.is_available };
      await documentById(Collections.menuItems, id).update({ is_available: updated.is_available });
      return successResponse(SuccessCodes.OK, updated);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
