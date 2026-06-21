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

      const warnings: string[] = [];

      // Log raw data keys for diagnosis
      if (itemsData.length > 0) {
        console.log("[import] ItemsData[0] keys:", Object.keys(itemsData[0]));
        console.log("[import] ItemsData[0] sample:", JSON.stringify(itemsData[0]));
      }
      if (variantsData.length > 0) {
        console.log("[import] VariantsData[0] keys:", Object.keys(variantsData[0]));
        console.log("[import] VariantsData[0] sample:", JSON.stringify(variantsData[0]));
      }
      if (stallsData.length > 0) {
        console.log("[import] StallsData[0] keys:", Object.keys(stallsData[0]));
        console.log("[import] StallsData[0] sample:", JSON.stringify(stallsData[0]));
      }
      console.log("[import] stallsData.length:", stallsData.length, "itemsData.length:", itemsData.length, "variantsData.length:", variantsData.length);

      // --- Validate input ---
      const venueCheck = await BaseService.query('SELECT venue_id FROM venue WHERE venue_id = $1', [venueId]);
      if (!venueCheck.rows[0]) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, `Venue with ID ${venueId} does not exist.`);
      }

      for (let i = 0; i < stallsData.length; i++) {
        const name = stallsData[i]["Stall Name"];
        if (!name || String(name).trim() === '') {
          return errorResponse(ErrorCodes.VALIDATION_ERROR,
            `Stalls sheet row ${i + 2}: missing required field "Stall Name".`);
        }
      }

      for (let i = 0; i < itemsData.length; i++) {
        const item = itemsData[i];
        if (!item["Item Name"] || String(item["Item Name"]).trim() === '') {
          return errorResponse(ErrorCodes.VALIDATION_ERROR,
            `Items sheet row ${i + 2}: missing required field "Item Name".`);
        }
        if (!item["Stall ID"] && !item["Stall Name"]) {
          return errorResponse(ErrorCodes.VALIDATION_ERROR,
            `Items sheet row ${i + 2} ("${item["Item Name"]}"): missing both "Stall ID" and "Stall Name" — cannot determine which stall this item belongs to.`);
        }
      }

      const parseBool = (v: any) => v === true || v === 'true' || v === 'TRUE';

      return await BaseService.tx(async (client) => {
        // Collect incoming Excel IDs
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

        // Get existing DB IDs under this venue
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

        console.log(`[import] oldStallIds (${oldStallIds.length}):`, oldStallIds);
        console.log(`[import] oldItemIds (${oldItemIds.length}):`, oldItemIds);
        console.log(`[import] oldSectionIds (${oldSectionIds.length}):`, oldSectionIds);
        console.log(`[import] incomingStallIds (${incomingStallIds.length}):`, incomingStallIds);
        console.log(`[import] incomingItemIds (${incomingItemIds.length}):`, incomingItemIds);

        // Delete discarded records bottom-up using SAVEPOINTS
        // FK violations are handled by falling back to soft-delete

        const optionsToDelete = oldOptionIds.filter(id => !incomingOptionIds.includes(id));
        for (const id of optionsToDelete) {
          try {
            await client.query('SAVEPOINT sp_del_opt');
            await client.query('DELETE FROM menu_item_modifier WHERE option_id = $1', [id]);
            await client.query('RELEASE SAVEPOINT sp_del_opt');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT sp_del_opt');
            if (e.code === '23503') {
              await client.query('UPDATE menu_item_modifier SET is_available = false WHERE option_id = $1', [id]);
            } else {
              throw new Error(`Cannot remove modifier option ${id}: ${e.message}`);
            }
          }
        }

        const sectionsToDelete = oldSectionIds.filter(id => !incomingSectionIds.includes(id));
        for (const id of sectionsToDelete) {
          try {
            await client.query('SAVEPOINT sp_del_sec');
            await client.query('DELETE FROM menu_item_modifier_section WHERE section_id = $1', [id]);
            await client.query('RELEASE SAVEPOINT sp_del_sec');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT sp_del_sec');
            if (e.code !== '23503') {
              throw new Error(`Cannot remove modifier section ${id}: ${e.message}`);
            }
          }
        }

        const itemsToDelete = oldItemIds.filter(id => !incomingItemIds.includes(id));
        for (const id of itemsToDelete) {
          try {
            await client.query('SAVEPOINT sp_del_item');
            await client.query('DELETE FROM menu_item WHERE item_id = $1', [id]);
            await client.query('RELEASE SAVEPOINT sp_del_item');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT sp_del_item');
            if (e.code === '23503') {
              await client.query('UPDATE menu_item SET is_available = false WHERE item_id = $1', [id]);
            } else {
              throw new Error(`Cannot remove menu item ${id}: ${e.message}`);
            }
          }
        }

        const stallsToDelete = oldStallIds.filter(id => !incomingStallIds.includes(id));
        for (const id of stallsToDelete) {
          try {
            await client.query('SAVEPOINT sp_del_stall');
            await client.query('DELETE FROM stall WHERE stall_id = $1', [id]);
            await client.query('RELEASE SAVEPOINT sp_del_stall');
          } catch (e: any) {
            await client.query('ROLLBACK TO SAVEPOINT sp_del_stall');
            if (e.code === '23503') {
              await client.query('UPDATE stall SET is_open = false WHERE stall_id = $1', [id]);
            } else {
              throw new Error(`Cannot remove stall ${id}: ${e.message}`);
            }
          }
        }

        // --- UPSERT STALLS ---
        const stallIdMap = new Map<number, number>();   // Excel ID -> DB ID
        const stallNameMap = new Map<string, number>();  // lowercase name -> DB ID

        for (const s of stallsData) {
          const excelId = Number(s["Stall ID"]);
          const name = String(s["Stall Name"] || '').trim();
          const description = s["Description"] ? String(s["Description"]) : null;
          const image = s["Image"] ? String(s["Image"]) : null;
          const isOpen = s.hasOwnProperty("Is Open") ? parseBool(s["Is Open"]) : true;
          const allowRemarks = s.hasOwnProperty("Allow Remarks") ? parseBool(s["Allow Remarks"]) : false;

          let finalStallId = 0;
          try {
            if (excelId > 0 && oldStallIds.includes(excelId)) {
              const res = await client.query(
                `UPDATE stall SET name = $1, description = $2, stall_image = $3, is_open = $4, allow_remarks = $5 WHERE stall_id = $6 RETURNING stall_id`,
                [name, description, image, isOpen, allowRemarks, excelId]
              );
              finalStallId = res.rows[0]?.stall_id;
              if (!finalStallId) {
                // stall was cleaned up; insert a new one
                const insRes = await client.query(
                  `INSERT INTO stall (venue_id, name, description, stall_image, is_open, allow_remarks) VALUES ($1, $2, $3, $4, $5, $6) RETURNING stall_id`,
                  [venueId, name, description, image, isOpen, allowRemarks]
                );
                finalStallId = insRes.rows[0]?.stall_id;
              }
            } else {
              const res = await client.query(
                `INSERT INTO stall (venue_id, name, description, stall_image, is_open, allow_remarks) VALUES ($1, $2, $3, $4, $5, $6) RETURNING stall_id`,
                [venueId, name, description, image, isOpen, allowRemarks]
              );
              finalStallId = res.rows[0]?.stall_id;
            }
          } catch (e: any) {
            throw new Error(`Failed to import stall "${name}": ${e.message}`);
          }

          if (!finalStallId) {
            throw new Error(`Failed to import stall "${name}": could not get database ID.`);
          }

          if (excelId > 0) stallIdMap.set(excelId, finalStallId);
          stallNameMap.set(name.toLowerCase(), finalStallId);
        }

        // --- RESOLVE CATEGORIES ---
        const categoryMap = new Map<number, number>(); // Excel category_id -> DB category_id
        const catStallMap = new Map<number, number>(); // Excel category_id -> stall_id

        for (const i of itemsData) {
          const catId = Number(i["Category ID"]);
          if (!catId || catId <= 0 || categoryMap.has(catId)) continue;

          const excelStallId = Number(i["Stall ID"]);
          const stallName = String(i["Stall Name"] || '').trim();
          const stallId = (excelStallId > 0 ? stallIdMap.get(excelStallId) : undefined)
            ?? stallNameMap.get(stallName.toLowerCase());

          if (stallId) catStallMap.set(catId, stallId);
        }

        if (catStallMap.size > 0) {
          for (const [catId, stallId] of catStallMap) {
            const existing = await client.query(
              'SELECT category_id FROM menu_item_category WHERE stall_id = $1 AND name = $2',
              [stallId, String(catId)]
            );
            if (existing.rows.length > 0) {
              categoryMap.set(catId, existing.rows[0].category_id);
            } else {
              const res = await client.query(
                `INSERT INTO menu_item_category (stall_id, name, sort_order) VALUES ($1, $2, $3) RETURNING category_id`,
                [stallId, String(catId), 0]
              );
              const newCatId = res.rows[0]?.category_id;
              if (newCatId) categoryMap.set(catId, newCatId);
            }
          }
        }

        // --- UPSERT ITEMS ---
        const itemIdMap = new Map<number, number>();      // Excel Item ID -> DB ID
        const itemKeyMap = new Map<string, number>();     // "stallId::name" -> DB ID

        for (const i of itemsData) {
          const excelStallId = Number(i["Stall ID"]);
          const stallName = String(i["Stall Name"] || '').trim();
          const stallId = (excelStallId > 0 ? stallIdMap.get(excelStallId) : undefined)
            ?? stallNameMap.get(stallName.toLowerCase());

          console.log(`[import] Item "${i["Item Name"]}": excelStallId=${excelStallId} stallName="${stallName}" resolvedStallId=${stallId} stallIdMapSize=${stallIdMap.size} stallNameMapSize=${stallNameMap.size}`);

          if (!stallId) {
            warnings.push(`Skipped item "${i["Item Name"]}": could not find stall "${stallName || excelStallId}".`);
            continue;
          }

          const excelId = Number(i["Item ID"]);
          const name = String(i["Item Name"] || '').trim();
          const rawCatId = Number(i["Category ID"]);
          const categoryId = rawCatId > 0 ? (categoryMap.get(rawCatId) || null) : null;
          const priceRaw = i["Price"];
          const price = (priceRaw === undefined || priceRaw === null || priceRaw === '') ? 0 : Number(priceRaw);
          const isAvail = i.hasOwnProperty("Is Available") ? parseBool(i["Is Available"]) : true;
          const rawPrepTime = Number(i["Prep Time"]);
          const prepTime = Number.isNaN(rawPrepTime) ? 0 : rawPrepTime;
          const desc = i["Description"] ? String(i["Description"]) : null;

          console.log(`[import] Item "${name}": price=${price} isAvail=${isAvail} prepTime=${prepTime} categoryId=${categoryId}`);

          if (isNaN(price) || price < 0) {
            warnings.push(`Skipped item "${name}": invalid price "${i["Price"]}".`);
            continue;
          }

          let finalItemId = 0;
          try {
            if (excelId > 0 && oldItemIds.includes(excelId)) {
              const res = await client.query(
                `UPDATE menu_item SET stall_id = $1, name = $2, category_id = $3, price = $4, is_available = $5, prep_time = $6, description = $7 WHERE item_id = $8 RETURNING item_id`,
                [stallId, name, categoryId, price, isAvail, prepTime, desc, excelId]
              );
              finalItemId = res.rows[0]?.item_id;
              if (!finalItemId) {
                // item was cascade-deleted by the cleanup above; insert a new one
                const insRes = await client.query(
                  `INSERT INTO menu_item (stall_id, name, category_id, price, is_available, prep_time, description) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING item_id`,
                  [stallId, name, categoryId, price, isAvail, prepTime, desc]
                );
                finalItemId = insRes.rows[0]?.item_id;
              }
            } else {
              const res = await client.query(
                `INSERT INTO menu_item (stall_id, name, category_id, price, is_available, prep_time, description) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING item_id`,
                [stallId, name, categoryId, price, isAvail, prepTime, desc]
              );
              finalItemId = res.rows[0]?.item_id;
            }
          } catch (e: any) {
            throw new Error(`Failed to import item "${name}" (stall "${stallName || excelStallId}"): ${e.message}`);
          }

          if (!finalItemId) {
            throw new Error(`Failed to import item "${name}": could not get database ID.`);
          }

          if (excelId > 0) itemIdMap.set(excelId, finalItemId);
          itemKeyMap.set(`${stallId}::${name.toLowerCase()}`, finalItemId);
        }

        // --- UPSERT VARIANTS (modifier sections + options) ---
        const sectionIdMap = new Map<number, number>();   // Excel Section ID -> DB ID
        let variantIdx = 0;

        for (const v of variantsData) {
          const variantRow = variantIdx++;          const excelStallId = Number(v["Stall ID"]);
          const stallName = String(v["Stall Name"] || '').trim();
          const stallId = (excelStallId > 0 ? stallIdMap.get(excelStallId) : undefined)
            ?? stallNameMap.get(stallName.toLowerCase());

          if (!stallId) {
            warnings.push(`Skipped variant row for "${v["Item Name"]}": could not find stall.`);
            continue;
          }

          const excelItemId = Number(v["Item ID"]);
          const itemName = String(v["Item Name"] || '').trim();
          const itemId = (excelItemId > 0 ? itemIdMap.get(excelItemId) : undefined)
            ?? itemKeyMap.get(`${stallId}::${itemName.toLowerCase()}`);

          if (!itemId) {
            warnings.push(`Skipped variant row: could not find item "${itemName}" in stall "${stallName || excelStallId}".`);
            continue;
          }

          const excelSectionId = Number(v["Section ID"]);
          const sectionName = String(v["Section Name"] || '').trim();
          if (!sectionName) {
            warnings.push(`Skipped variant row: missing "Section Name".`);
            continue;
          }

          const rawMinSel = Number(v["Min Selections"]);
          const minSel = Number.isNaN(rawMinSel) ? 0 : rawMinSel;
          const rawMaxSel = Number(v["Max Selections"]);
          const maxSel = Number.isNaN(rawMaxSel) ? 1 : rawMaxSel;

          if (minSel > maxSel) {
            warnings.push(`Skipped variant "${sectionName}" for item "${itemName}": Min Selections (${minSel}) cannot exceed Max Selections (${maxSel}).`);
            continue;
          }

          let finalSectionId = 0;
          const spSec = `sp_var_sec_${variantRow}`;
          try {
            await client.query(`SAVEPOINT ${spSec}`);
            if (excelSectionId > 0 && sectionIdMap.has(excelSectionId)) {
              finalSectionId = sectionIdMap.get(excelSectionId)!;
            } else if (excelSectionId > 0 && oldSectionIds.includes(excelSectionId)) {
              const res = await client.query(
                `UPDATE menu_item_modifier_section SET item_id = $1, name = $2, min_selections = $3, max_selections = $4 WHERE section_id = $5 RETURNING section_id`,
                [itemId, sectionName, minSel, maxSel, excelSectionId]
              );
              if (res.rows.length > 0) {
                finalSectionId = res.rows[0].section_id;
              } else {
                // section was cascade-deleted by the cleanup above; insert a new one
                const insRes = await client.query(
                  `INSERT INTO menu_item_modifier_section (item_id, name, min_selections, max_selections) VALUES ($1, $2, $3, $4) RETURNING section_id`,
                  [itemId, sectionName, minSel, maxSel]
                );
                finalSectionId = insRes.rows[0]?.section_id;
              }
              if (finalSectionId) sectionIdMap.set(excelSectionId, finalSectionId);
            } else {
              const res = await client.query(
                `INSERT INTO menu_item_modifier_section (item_id, name, min_selections, max_selections) VALUES ($1, $2, $3, $4) RETURNING section_id`,
                [itemId, sectionName, minSel, maxSel]
              );
              finalSectionId = res.rows[0]?.section_id;
              if (finalSectionId && excelSectionId > 0) sectionIdMap.set(excelSectionId, finalSectionId);
            }
            await client.query(`RELEASE SAVEPOINT ${spSec}`);
          } catch (e: any) {
            await client.query(`ROLLBACK TO SAVEPOINT ${spSec}`);
            warnings.push(`Failed to import modifier section "${sectionName}" for item "${itemName}": ${e.message}`);
            continue;
          }

          if (!finalSectionId) continue;

          // Options
          const excelOptionId = Number(v["Option ID"]);
          const optionName = v["Option Name"];
          if (!optionName) continue;

          const rawOptionPrice = Number(v["Price Modifier"]);
          const optionPrice = Number.isNaN(rawOptionPrice) ? 0 : rawOptionPrice;
          const isAvail = v.hasOwnProperty("Option Is Available") ? parseBool(v["Option Is Available"]) : true;

          const spOpt = `sp_var_opt_${variantRow}`;
          try {
            await client.query(`SAVEPOINT ${spOpt}`);
            if (excelOptionId > 0 && oldOptionIds.includes(excelOptionId)) {
              const updRes = await client.query(
                `UPDATE menu_item_modifier SET section_id = $1, item_id = $2, name = $3, price_modifier = $4, is_available = $5 WHERE option_id = $6`,
                [finalSectionId, itemId, optionName, optionPrice, isAvail, excelOptionId]
              );
              if (updRes.rowCount === 0) {
                // option was cascade-deleted by the cleanup above; insert a new one
                await client.query(
                  `INSERT INTO menu_item_modifier (section_id, item_id, name, price_modifier, is_available) VALUES ($1, $2, $3, $4, $5)`,
                  [finalSectionId, itemId, optionName, optionPrice, isAvail]
                );
              }
            } else {
              await client.query(
                `INSERT INTO menu_item_modifier (section_id, item_id, name, price_modifier, is_available) VALUES ($1, $2, $3, $4, $5)`,
                [finalSectionId, itemId, optionName, optionPrice, isAvail]
              );
            }
            await client.query(`RELEASE SAVEPOINT ${spOpt}`);
          } catch (e: any) {
            await client.query(`ROLLBACK TO SAVEPOINT ${spOpt}`);
            warnings.push(`Failed to import option "${optionName}" for section "${sectionName}": ${e.message}`);
          }
        }

        if (warnings.length > 0) {
          console.warn("[StallService.importStallsForVenue] Warnings:", warnings);
        }

        return successResponse(SuccessCodes.OK, {
          imported: true,
          stallsImported: stallsData.length,
          itemsImported: itemsData.length,
          variantsImported: variantsData.length,
          warnings: warnings.length > 0 ? warnings : undefined,
        });
      });
    } catch (error: any) {
      console.error("[StallService.importStallsForVenue]", error);
      return errorResponse(ErrorCodes.DATABASE_ERROR,
        `Import failed: ${error.message || String(error)}`);
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
