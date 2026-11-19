import type { StallPayload, UpdateStallPayload } from "../types/payloads";
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
  sortByNumericId,
  updateDocument,
} from "./firestore.service";

const STALL_COLUMNS = new Set([
  "venue_id", "name", "description", "stall_image", "is_open", "allow_remarks",
]);

function parseBool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || String(value).toLowerCase() === "true";
}

async function preferredOrNextId(
  collection: string,
  preferred: number,
  canReuse: (existing: Record<string, any>) => boolean,
) {
  if (Number.isInteger(preferred) && preferred > 0) {
    const existing = await getById(collection, preferred);
    if (!existing || canReuse(existing)) {
      await ensureCounterAtLeast(collection, preferred);
      return preferred;
    }
  }
  return nextId(collection);
}

async function waitingTime(stallId: number) {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const items = await getWhere(Collections.orderItems, "stall_id", stallId);
  return items
    .filter((item) =>
      ["INCOMING", "PREPARING"].includes(String(item.status)) &&
      new Date(item.created_at).getTime() >= oneDayAgo,
    )
    .reduce((total, item) => total + Number(item.prep_time ?? 0), 0);
}

export const StallService = {
  async findAllByVenue(venue_id: number): Promise<ServiceResult<any[]>> {
    try {
      const stalls = sortByNumericId(await getWhere(Collections.stalls, "venue_id", venue_id), "stall_id");
      const result = await Promise.all(stalls.map(async (stall) => ({
        ...stall,
        waiting_time: await waitingTime(Number(stall.stall_id)),
      })));
      return successResponse(SuccessCodes.OK, result);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const stall = await getById(Collections.stalls, id);
      if (!stall) return errorResponse(ErrorCodes.NOT_FOUND, "Stall not found");
      return successResponse(SuccessCodes.OK, { ...stall, waiting_time: await waitingTime(id) });
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: StallPayload): Promise<ServiceResult<any>> {
    try {
      if (!(await getById(Collections.venues, payload.venue_id))) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, "Venue does not exist");
      }
      const stall_id = await nextId(Collections.stalls);
      const stall = {
        stall_id,
        venue_id: payload.venue_id,
        name: payload.name,
        description: payload.description ?? null,
        stall_image: payload.stall_image ?? null,
        is_open: payload.is_open ?? true,
        allow_remarks: (payload as any).allow_remarks ?? true,
      };
      await documentById(Collections.stalls, stall_id).set(stall);
      return successResponse(SuccessCodes.CREATED, stall);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async importStallsForVenue(venueId: number, data: any): Promise<ServiceResult<any>> {
    try {
      if (!(await getById(Collections.venues, venueId))) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, `Venue with ID ${venueId} does not exist.`);
      }

      const stallsData: any[] = Array.isArray(data.stalls) ? data.stalls : [];
      const itemsData: any[] = Array.isArray(data.items) ? data.items : [];
      const variantsData: any[] = Array.isArray(data.variants) ? data.variants : [];
      const warnings: string[] = [];

      for (let index = 0; index < stallsData.length; index += 1) {
        if (!String(stallsData[index]["Stall Name"] ?? "").trim()) {
          return errorResponse(ErrorCodes.VALIDATION_ERROR, `Stalls sheet row ${index + 2}: missing required field "Stall Name".`);
        }
      }
      for (let index = 0; index < itemsData.length; index += 1) {
        const row = itemsData[index];
        if (!String(row["Item Name"] ?? "").trim()) {
          return errorResponse(ErrorCodes.VALIDATION_ERROR, `Items sheet row ${index + 2}: missing required field "Item Name".`);
        }
        if (!row["Stall ID"] && !row["Stall Name"]) {
          return errorResponse(ErrorCodes.VALIDATION_ERROR, `Items sheet row ${index + 2}: missing stall identifier.`);
        }
      }

      const oldStalls = await getWhere(Collections.stalls, "venue_id", venueId);
      const oldStallIds = new Set(oldStalls.map((stall) => Number(stall.stall_id)));
      const stallIdMap = new Map<number, number>();
      const stallNameMap = new Map<string, number>();
      const importedStallIds = new Set<number>();

      for (const row of stallsData) {
        const preferred = Number(row["Stall ID"]);
        const stall_id = await preferredOrNextId(
          Collections.stalls,
          preferred,
          (existing) => Number(existing.venue_id) === venueId,
        );
        const name = String(row["Stall Name"]).trim();
        await documentById(Collections.stalls, stall_id).set({
          stall_id,
          venue_id: venueId,
          name,
          description: row.Description ? String(row.Description) : null,
          stall_image: row.Image ? String(row.Image) : null,
          is_open: parseBool(row["Is Open"], true),
          allow_remarks: parseBool(row["Allow Remarks"], true),
        });
        if (preferred > 0) stallIdMap.set(preferred, stall_id);
        stallNameMap.set(name.toLowerCase(), stall_id);
        importedStallIds.add(stall_id);
      }
      for (const stall of oldStalls) {
        if (!importedStallIds.has(Number(stall.stall_id))) {
          await documentById(Collections.stalls, stall.stall_id).update({ is_open: false });
        }
      }

      const oldItems = (
        await Promise.all([...oldStallIds].map((stallId) => getWhere(Collections.menuItems, "stall_id", stallId)))
      ).flat();
      const oldItemIds = new Set(oldItems.map((item) => Number(item.item_id)));
      const importedItemIds = new Set<number>();
      const itemIdMap = new Map<number, number>();
      const itemKeyMap = new Map<string, number>();
      const categoryMap = new Map<string, number>();

      for (const row of itemsData) {
        const sourceStallId = Number(row["Stall ID"]);
        const stallName = String(row["Stall Name"] ?? "").trim();
        const stallId = stallIdMap.get(sourceStallId) ?? stallNameMap.get(stallName.toLowerCase());
        if (!stallId) {
          warnings.push(`Skipped item "${row["Item Name"]}": stall could not be resolved.`);
          continue;
        }

        const sourceCategoryId = Number(row["Category ID"]);
        let categoryId: number | null = null;
        if (sourceCategoryId > 0) {
          const categoryKey = `${stallId}:${sourceCategoryId}`;
          categoryId = categoryMap.get(categoryKey) ?? null;
          if (!categoryId) {
            categoryId = await nextId(Collections.categories);
            await documentById(Collections.categories, categoryId).set({
              category_id: categoryId,
              stall_id: stallId,
              name: String(sourceCategoryId),
              sort_order: 0,
            });
            categoryMap.set(categoryKey, categoryId);
          }
        }

        const price = Number(row.Price ?? 0);
        if (!Number.isFinite(price) || price < 0) {
          warnings.push(`Skipped item "${row["Item Name"]}": invalid price.`);
          continue;
        }
        const preferred = Number(row["Item ID"]);
        const item_id = await preferredOrNextId(
          Collections.menuItems,
          preferred,
          (existing) => oldItemIds.has(Number(existing.item_id)),
        );
        const name = String(row["Item Name"]).trim();
        await documentById(Collections.menuItems, item_id).set({
          item_id,
          stall_id: stallId,
          category_id: categoryId,
          item_image: row.Image ? String(row.Image) : null,
          name,
          description: row.Description ? String(row.Description) : null,
          price,
          prep_time: Number(row["Prep Time"] ?? 0) || 0,
          is_available: parseBool(row["Is Available"], true),
        });
        if (preferred > 0) itemIdMap.set(preferred, item_id);
        itemKeyMap.set(`${stallId}:${name.toLowerCase()}`, item_id);
        importedItemIds.add(item_id);
      }
      for (const item of oldItems) {
        if (!importedItemIds.has(Number(item.item_id))) {
          await documentById(Collections.menuItems, item.item_id).update({ is_available: false });
        }
      }

      const sectionMap = new Map<string, number>();
      for (const row of variantsData) {
        const sourceStallId = Number(row["Stall ID"]);
        const stallName = String(row["Stall Name"] ?? "").trim();
        const stallId = stallIdMap.get(sourceStallId) ?? stallNameMap.get(stallName.toLowerCase());
        if (!stallId) {
          warnings.push(`Skipped modifier for "${row["Item Name"]}": stall could not be resolved.`);
          continue;
        }
        const sourceItemId = Number(row["Item ID"]);
        const itemName = String(row["Item Name"] ?? "").trim();
        const itemId = itemIdMap.get(sourceItemId) ?? itemKeyMap.get(`${stallId}:${itemName.toLowerCase()}`);
        if (!itemId) {
          warnings.push(`Skipped modifier: item "${itemName}" could not be resolved.`);
          continue;
        }
        const sectionName = String(row["Section Name"] ?? "").trim();
        if (!sectionName) continue;
        const sourceSectionId = Number(row["Section ID"]);
        const sectionKey = `${itemId}:${sourceSectionId || sectionName.toLowerCase()}`;
        let sectionId = sectionMap.get(sectionKey);
        if (!sectionId) {
          sectionId = await preferredOrNextId(
            Collections.modifierSections,
            sourceSectionId,
            (existing) => Number(existing.item_id) === itemId,
          );
          const min = Number(row["Min Selections"] ?? 0) || 0;
          const max = Number(row["Max Selections"] ?? 1) || 1;
          if (min > max) {
            warnings.push(`Skipped section "${sectionName}": minimum exceeds maximum.`);
            continue;
          }
          await documentById(Collections.modifierSections, sectionId).set({
            section_id: sectionId,
            item_id: itemId,
            name: sectionName,
            min_selections: min,
            max_selections: max,
          });
          sectionMap.set(sectionKey, sectionId);
        }

        const optionName = String(row["Option Name"] ?? "").trim();
        if (!optionName) continue;
        const sourceOptionId = Number(row["Option ID"]);
        const optionId = await preferredOrNextId(
          Collections.modifiers,
          sourceOptionId,
          (existing) => Number(existing.item_id) === itemId,
        );
        await documentById(Collections.modifiers, optionId).set({
          option_id: optionId,
          section_id: sectionId,
          item_id: itemId,
          name: optionName,
          price_modifier: Number(row["Price Modifier"] ?? 0) || 0,
          is_available: parseBool(row["Option Is Available"], true),
        });
      }

      return successResponse(SuccessCodes.OK, {
        imported: true,
        stallsImported: stallsData.length,
        itemsImported: importedItemIds.size,
        variantsImported: variantsData.length,
        warnings: warnings.length ? warnings : undefined,
      });
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async update(id: number, payload: UpdateStallPayload): Promise<ServiceResult<any>> {
    const updates = Object.fromEntries(Object.entries(payload).filter(([key]) => STALL_COLUMNS.has(key)));
    if (Object.keys(updates).length === 0) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "No valid fields to update");
    }
    try {
      const stall = await updateDocument(Collections.stalls, id, updates);
      if (!stall) return errorResponse(ErrorCodes.NOT_FOUND, "Stall not found");
      return successResponse(SuccessCodes.OK, stall);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.stalls, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Stall not found");
      }
      const history = await getWhere(Collections.orderItems, "stall_id", id);
      if (history.length > 0) {
        await documentById(Collections.stalls, id).update({ is_open: false });
        return successResponse<null>(SuccessCodes.OK, null);
      }
      const [items, categories] = await Promise.all([
        getWhere(Collections.menuItems, "stall_id", id),
        getWhere(Collections.categories, "stall_id", id),
      ]);
      const itemIds = new Set(items.map((item) => Number(item.item_id)));
      const [sections, options] = await Promise.all([
        Promise.all([...itemIds].map((itemId) => getWhere(Collections.modifierSections, "item_id", itemId))).then((all) => all.flat()),
        Promise.all([...itemIds].map((itemId) => getWhere(Collections.modifiers, "item_id", itemId))).then((all) => all.flat()),
      ]);
      const batch = db.batch();
      for (const option of options) batch.delete(documentById(Collections.modifiers, option.option_id));
      for (const section of sections) batch.delete(documentById(Collections.modifierSections, section.section_id));
      for (const item of items) batch.delete(documentById(Collections.menuItems, item.item_id));
      for (const category of categories) batch.delete(documentById(Collections.categories, category.category_id));
      batch.delete(documentById(Collections.stalls, id));
      await batch.commit();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
