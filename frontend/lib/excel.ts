"use client";

export interface WorkbookSheet {
  name: string;
  rows: unknown[][];
}

function safeSheetName(name: string) {
  return name.replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || "Sheet";
}

export async function downloadWorkbook(
  sheets: WorkbookSheet[],
  filename: string,
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(safeSheetName(sheet.name));
    worksheet.addRows(sheet.rows as any[][]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cellValue(cell: any): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("result" in value && value.result !== undefined) return value.result;
  if ("text" in value && typeof value.text === "string") return value.text;
  return cell.text;
}

export async function readWorkbookSheets(
  data: ArrayBuffer,
  requiredSheets: string[],
): Promise<Record<string, Record<string, unknown>[]>> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const result: Record<string, Record<string, unknown>[]> = {};
  for (const sheetName of requiredSheets) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(
        `Invalid format. Make sure the Excel file has a '${sheetName}' sheet.`,
      );
    }

    const headerRow = worksheet.getRow(1);
    const headers = Array.from({ length: worksheet.columnCount }, (_, index) =>
      headerRow.getCell(index + 1).text.trim(),
    );
    const rows: Record<string, unknown>[] = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const record: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        if (!header) return;
        const value = cellValue(row.getCell(index + 1));
        if (value !== "") hasValue = true;
        record[header] = value;
      });
      if (hasValue) rows.push(record);
    }
    result[sheetName] = rows;
  }

  return result;
}
