import type { StallPayload, UpdateStallPayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { BaseService } from "./base.service";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";

const STALL_COLUMNS = new Set([
  "venue_id",
  "name",
  "description",
  "stall_image",
  "is_open",
  "allow_remarks"
]);

export const StallService = {
  async findAllByVenue(venue_id: number): Promise<ServiceResult<any[]>> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const result = await BaseService.query(
        `SELECT 
          s.*,
          COALESCE(SUM(CASE 
            WHEN oi.status IN ('INCOMING', 'PREPARING') 
            AND o.created_at >= $2
            THEN m.prep_time 
            ELSE 0 
          END), 0) as waiting_time
        FROM stall s
        LEFT JOIN menu_item m ON s.stall_id = m.stall_id
        LEFT JOIN order_item oi ON m.item_id = oi.item_id
        LEFT JOIN "order" o ON oi.order_id = o.order_id
        WHERE s.venue_id = $1
        GROUP BY s.stall_id
        ORDER BY s.stall_id`,
        [venue_id, oneDayAgo]
      );
      return successResponse(SuccessCodes.OK, result.rows);
    } catch (error) {
      console.error("[StallService.findAllByVenue] DB error:", error);
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const result = await BaseService.query(
        `SELECT 
          s.*,
          COALESCE(SUM(CASE 
            WHEN oi.status IN ('INCOMING', 'PREPARING') 
            AND o.created_at >= $2
            THEN m.prep_time 
            ELSE 0 
          END), 0) as waiting_time
        FROM stall s
        LEFT JOIN menu_item m ON s.stall_id = m.stall_id
        LEFT JOIN order_item oi ON m.item_id = oi.item_id
        LEFT JOIN "order" o ON oi.order_id = o.order_id
        WHERE s.stall_id = $1
        GROUP BY s.stall_id`,
        [id, oneDayAgo]
      );

      const stall = result.rows[0];
      if (!stall) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Stall not found");
      }

      return successResponse(SuccessCodes.OK, stall);
    } catch (error) {
      console.error("[StallService.findById] DB error:", error);
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: StallPayload): Promise<ServiceResult<any>> {
    // allow only valid columns
    const entries = Object.entries(payload).filter(([key]) =>
      STALL_COLUMNS.has(key)
    );

    if (entries.length === 0) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No valid fields to create"
      );
    }

    const columns = entries.map(([field]) => field).join(", ");
    const placeholders = entries.map((_, i) => `$${i + 1}`).join(", ");
    const values = entries.map(([, value]) => value ?? null);

    try {
      const query = `
      INSERT INTO stall (${columns})
      VALUES (${placeholders})
      RETURNING *
    `;

      const result = await BaseService.query(query, values);

      return successResponse(SuccessCodes.CREATED, result.rows[0]);
    } catch (error) {
      console.error("[StallService.create] DB error:", error);
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async importStallsForVenue(venueId: number, data: any): Promise<ServiceResult<any>> {
    try {
      const stallsData = data.stalls || [];
      const itemsData = data.items || [];
      const variantsData = data.variants || [];

      return await BaseService.tx(async (client) => {
        // Collect incoming IDs
        const incomingStallIds = stallsData
          .map((s: any) => Number(s["Stall ID"]))
          .filter((id: number) => !isNaN(id) && id > 0);

        const incomingItemIds = itemsData
          .map((i: any) => Number(i["Item ID"]))
          .filter((id: number) => !isNaN(id) && id > 0);
          
        const incomingSectionIds = variantsData
          .map((v: any) => Number(v["Section ID"]))
          .filter((id: number) => !isNaN(id) && id > 0);
          
        const incomingOptionIds = variantsData
          .map((v: any) => Number(v["Option ID"]))
          .filter((id: number) => !isNaN(id) && id > 0);

        // Get DB IDs
        const oldStallsRes = await client.query('SELECT stall_id FROM stall WHERE venue_id = $1', [venueId]);
        const oldStallIds = oldStallsRes.rows.map(r => r.stall_id);
        
        let oldItemIds: number[] = [];
        let oldSectionIds: number[] = [];
        let oldOptionIds: number[] = [];

        if (oldStallIds.length > 0) {
          const oldItemsRes = await client.query('SELECT item_id FROM menu_item WHERE stall_id = ANY($1)', [oldStallIds]);
          oldItemIds = oldItemsRes.rows.map(r => r.item_id);

          if (oldItemIds.length > 0) {
            const oldSectionsRes = await client.query('SELECT section_id FROM menu_item_modifier_section WHERE item_id = ANY($1)', [oldItemIds]);
            oldSectionIds = oldSectionsRes.rows.map(r => r.section_id);

            const oldOptionsRes = await client.query('SELECT option_id FROM menu_item_modifier WHERE item_id = ANY($1)', [oldItemIds]);
            oldOptionIds = oldOptionsRes.rows.map(r => r.option_id);
          }
        }

        // Delete discarded records bottom-up safely
        const optionsToDelete = oldOptionIds.filter(id => !incomingOptionIds.includes(id));
        for (const id of optionsToDelete) {
          try {
            await client.query('DELETE FROM menu_item_modifier WHERE option_id = $1', [id]);
          } catch (e: any) {
            if (e.code === '23503') {
              await client.query('UPDATE menu_item_modifier SET is_available = false WHERE option_id = $1', [id]);
            } else throw e;
          }
        }

        const sectionsToDelete = oldSectionIds.filter(id => !incomingSectionIds.includes(id));
        for (const id of sectionsToDelete) {
          try {
            await client.query('DELETE FROM menu_item_modifier_section WHERE section_id = $1', [id]);
          } catch (e: any) {
            if (e.code !== '23503') throw e; 
            // Sections don't have is_available, they hold options. The options were soft-deleted above.
          }
        }

        const itemsToDelete = oldItemIds.filter(id => !incomingItemIds.includes(id));
        for (const id of itemsToDelete) {
          try {
            await client.query('DELETE FROM menu_item WHERE item_id = $1', [id]);
          } catch (e: any) {
            if (e.code === '23503') {
              await client.query('UPDATE menu_item SET is_available = false WHERE item_id = $1', [id]);
            } else throw e;
          }
        }

        const stallsToDelete = oldStallIds.filter(id => !incomingStallIds.includes(id));
        for (const id of stallsToDelete) {
          try {
            await client.query('DELETE FROM stall WHERE stall_id = $1', [id]);
          } catch (e: any) {
            if (e.code === '23503') {
              await client.query('UPDATE stall SET is_open = false WHERE stall_id = $1', [id]);
            } else throw e;
          }
        }

        const parseBool = (v: any) => v === true || v === 'true' || v === 'TRUE';

        // 1. STALLS
        const stallIdMap = new Map<number | string, number>(); // old_id or name -> db id
        for (const s of stallsData) {
          const excelId = Number(s["Stall ID"]);
          const name = String(s["Stall Name"] || 'Unnamed Stall');
          const description = s["Description"] ? String(s["Description"]) : null;
          const image = s["Image"] ? String(s["Image"]) : null;
          const isOpen = s.hasOwnProperty("Is Open") ? parseBool(s["Is Open"]) : true;
          const allowRemarks = s.hasOwnProperty("Allow Remarks") ? parseBool(s["Allow Remarks"]) : false;

          let finalStallId = 0;
          if (excelId > 0 && oldStallIds.includes(excelId)) {
            const res = await client.query(
              `UPDATE stall SET name = $1, description = $2, stall_image = $3, is_open = $4, allow_remarks = $5 WHERE stall_id = $6 RETURNING stall_id`,
              [name, description, image, isOpen, allowRemarks, excelId]
            );
            finalStallId = res.rows[0]?.stall_id;
          } else {
            const res = await client.query(
              `INSERT INTO stall (venue_id, name, description, stall_image, is_open, allow_remarks) VALUES ($1, $2, $3, $4, $5, $6) RETURNING stall_id`,
              [venueId, name, description, image, isOpen, allowRemarks]
            );
            finalStallId = res.rows[0].stall_id;
          }
          if (excelId > 0) stallIdMap.set(excelId, finalStallId);
          stallIdMap.set(name, finalStallId);
        }

        // 2. ITEMS
        const itemIdMap = new Map<number | string, number>();
        for (const i of itemsData) {
          const excelStallId = Number(i["Stall ID"]);
          const stallName = i["Stall Name"];
          const stallId = stallIdMap.get(excelStallId) || stallIdMap.get(stallName);

          if (!stallId) continue; // cannot attach item

          const excelId = Number(i["Item ID"]);
          const name = String(i["Item Name"] || 'Unnamed Item');
          const categoryId = Number(i["Category ID"]) || null;
          const price = Number(i["Price"]) || 0;
          const isAvail = i.hasOwnProperty("Is Available") ? parseBool(i["Is Available"]) : true;
          const prepTime = Number(i["Prep Time"]) || 0;
          const desc = i["Description"] ? String(i["Description"]) : null;

          let finalItemId = 0;
          if (excelId > 0 && oldItemIds.includes(excelId)) {
            const res = await client.query(
              `UPDATE menu_item SET stall_id = $1, name = $2, category_id = $3, price = $4, is_available = $5, prep_time = $6, description = $7 WHERE item_id = $8 RETURNING item_id`,
              [stallId, name, categoryId, price, isAvail, prepTime, desc, excelId]
            );
            finalItemId = res.rows[0]?.item_id;
          } else {
            const res = await client.query(
              `INSERT INTO menu_item (stall_id, name, category_id, price, is_available, prep_time, description) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING item_id`,
              [stallId, name, categoryId, price, isAvail, prepTime, desc]
            );
            finalItemId = res.rows[0]?.item_id;
          }
          if (excelId > 0) itemIdMap.set(excelId, finalItemId);
          itemIdMap.set(name, finalItemId);
        }

        // 3. VARIANTS
        const sectionIdMap = new Map<number | string, number>();
        for (const v of variantsData) {
          const excelItemId = Number(v["Item ID"]);
          const itemName = v["Item Name"];
          const itemId = itemIdMap.get(excelItemId) || itemIdMap.get(itemName);

          if (!itemId) continue;

          // Make sure section exists
          const excelSectionId = Number(v["Section ID"]);
          const sectionName = String(v["Section Name"] || 'Unnamed Variant');
          const minSel = Number(v["Min Selections"]) || 0;
          const maxSel = Number(v["Max Selections"]) || 1;

          let finalSectionId = 0;
          if (excelSectionId > 0 && sectionIdMap.has(excelSectionId)) {
             finalSectionId = sectionIdMap.get(excelSectionId)!;
          } else if (excelSectionId > 0 && oldSectionIds.includes(excelSectionId)) {
             const res = await client.query(
               `UPDATE menu_item_modifier_section SET item_id = $1, name = $2, min_selections = $3, max_selections = $4 WHERE section_id = $5 RETURNING section_id`,
               [itemId, sectionName, minSel, maxSel, excelSectionId]
             );
             finalSectionId = res.rows[0]?.section_id;
             sectionIdMap.set(excelSectionId, finalSectionId);
          } else {
             const res = await client.query(
               `INSERT INTO menu_item_modifier_section (item_id, name, min_selections, max_selections) VALUES ($1, $2, $3, $4) RETURNING section_id`,
               [itemId, sectionName, minSel, maxSel]
             );
             finalSectionId = res.rows[0]?.section_id;
             if (excelSectionId > 0) sectionIdMap.set(excelSectionId, finalSectionId);
          }

          // Options
          const excelOptionId = Number(v["Option ID"]);
          const optionName = v["Option Name"];
          if (!optionName) continue; // no actual option for this row

          const optionPrice = Number(v["Price Modifier"]) || 0;
          const isAvail = v.hasOwnProperty("Option Is Available") ? parseBool(v["Option Is Available"]) : true;

          if (excelOptionId > 0 && oldOptionIds.includes(excelOptionId)) {
             await client.query(
               `UPDATE menu_item_modifier SET section_id = $1, item_id = $2, name = $3, price_modifier = $4, is_available = $5 WHERE option_id = $6`,
               [finalSectionId, itemId, optionName, optionPrice, isAvail, excelOptionId]
             );
          } else {
             await client.query(
               `INSERT INTO menu_item_modifier (section_id, item_id, name, price_modifier, is_available) VALUES ($1, $2, $3, $4, $5)`,
               [finalSectionId, itemId, optionName, optionPrice, isAvail]
             );
          }
        }
        
        return successResponse(SuccessCodes.OK, { imported: true });
      });
    } catch (error: any) {
      console.error("[StallService.importStallsForVenue] DB error:", error);
      return errorResponse(ErrorCodes.DATABASE_ERROR, error.message || String(error));
    }
  },

  async update(
    id: number,
    payload: UpdateStallPayload
  ): Promise<ServiceResult<any>> {
    const entries = Object.entries(payload).filter(([key]) =>
      STALL_COLUMNS.has(key)
    );

    if (entries.length === 0) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No valid fields to update"
      );
    }

    const setClause = entries
      .map(([field], i) => `${field} = $${i + 1}`)
      .join(", ");

    const values = entries.map(([, value]) => value ?? null);

    try {
      const query = `
      UPDATE stall
      SET ${setClause}
      WHERE stall_id = $${entries.length + 1}
      RETURNING *
    `;

      const result = await BaseService.query(query, [...values, id]);

      if (!result.rows[0]) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Stall not found");
      }

      return successResponse(SuccessCodes.OK, result.rows[0]);
    } catch (error) {
      console.error("[StallService.update] DB error:", error);
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      const result = await BaseService.query(
        "DELETE FROM stall WHERE stall_id = $1",
        [id]
      );
      if (result.rowCount === 0)
        return errorResponse(ErrorCodes.NOT_FOUND, "Stall not found");
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
