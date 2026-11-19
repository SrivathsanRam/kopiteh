import type { TablePayload } from "../types/payloads";
import type { ServiceResult } from "../types/responses";
import { successResponse, errorResponse } from "../types/responses";
import { ErrorCodes } from "../types/errors";
import { SuccessCodes } from "../types/success";
import { db } from "../config/firebase";
import {
  Collections,
  documentById,
  getById,
  getWhere,
  reserveIds,
  sortTables,
} from "./firestore.service";

export const TableService = {
  async findAllByVenue(venue_id: number): Promise<ServiceResult<any[]>> {
    try {
      const tables = (await getWhere(Collections.tables, "venue_id", venue_id)).filter(
        (table) => table.is_active === true,
      );
      return successResponse(SuccessCodes.OK, sortTables(tables));
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async findById(id: number): Promise<ServiceResult<any>> {
    try {
      const table = await getById(Collections.tables, id);
      if (!table) return errorResponse(ErrorCodes.NOT_FOUND, "Table not found");
      return successResponse(SuccessCodes.OK, table);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async create(payload: TablePayload): Promise<ServiceResult<any>> {
    try {
      const table_id = (await reserveIds(Collections.tables))[0];
      const table = {
        table_id,
        venue_id: payload.venue_id,
        table_number: String(payload.table_number),
        is_active: payload.is_active ?? true,
      };
      await documentById(Collections.tables, table_id).set(table);
      return successResponse(SuccessCodes.CREATED, table);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async createBulk(
    venue_id: number,
    startNum: number,
    endNum: number,
  ): Promise<ServiceResult<any[]>> {
    try {
      const ids = await reserveIds(Collections.tables, Math.max(0, endNum - startNum + 1));
      const tables = ids.map((table_id, index) => ({
        table_id,
        venue_id,
        table_number: String(startNum + index),
        is_active: true,
      }));
      const batch = db.batch();
      for (const table of tables) batch.set(documentById(Collections.tables, table.table_id), table);
      await batch.commit();
      return successResponse(SuccessCodes.CREATED, tables);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async delete(id: number): Promise<ServiceResult<null>> {
    try {
      if (!(await getById(Collections.tables, id))) {
        return errorResponse(ErrorCodes.NOT_FOUND, "Table not found");
      }
      await documentById(Collections.tables, id).update({ is_active: false });
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },

  async deleteBulk(
    venue_id: number,
    tableNumbers: string[],
  ): Promise<ServiceResult<null>> {
    try {
      const wanted = new Set(tableNumbers.map(String));
      const tables = (await getWhere(Collections.tables, "venue_id", venue_id)).filter(
        (table) => wanted.has(String(table.table_number)),
      );
      const batch = db.batch();
      for (const table of tables) {
        batch.update(documentById(Collections.tables, table.table_id), { is_active: false });
      }
      await batch.commit();
      return successResponse<null>(SuccessCodes.OK, null);
    } catch (error) {
      return errorResponse(ErrorCodes.DATABASE_ERROR, String(error));
    }
  },
};
