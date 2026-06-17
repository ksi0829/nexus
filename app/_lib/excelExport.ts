"use client";

export type ExcelCellValue = string | number | boolean | null | undefined;

export type ExcelRow = ExcelCellValue[];

export type ExcelSheet = {
  name: string;
  rows: ExcelRow[];
  widths?: number[];
};

const workbookHeader = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="title">
      <Font ss:Bold="1" ss:Size="15" />
      <Interior ss:Color="#F8FAFC" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="header">
      <Font ss:Bold="1" />
      <Interior ss:Color="#E5E7EB" ss:Pattern="Solid" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" />
      </Borders>
    </Style>
    <Style ss:ID="label">
      <Font ss:Bold="1" />
      <Interior ss:Color="#F3F4F6" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="wrap">
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
    </Style>
  </Styles>`;

function escapeXml(value: ExcelCellValue) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getCellType(value: ExcelCellValue) {
  if (typeof value === "number" && Number.isFinite(value)) return "Number";
  if (typeof value === "boolean") return "Boolean";
  return "String";
}

function getStyle(rowIndex: number, cellIndex: number, row: ExcelRow) {
  if (rowIndex === 0) return "title";
  if (rowIndex === 2) return "header";
  if (cellIndex === 0 && row.length === 2) return "label";
  return "wrap";
}

function sanitizeSheetName(name: string) {
  const cleaned = name
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || "Sheet").slice(0, 31);
}

function toWorksheet(sheet: ExcelSheet, usedNames: Set<string>) {
  let sheetName = sanitizeSheetName(sheet.name);
  let suffix = 2;

  while (usedNames.has(sheetName)) {
    const suffixText = ` ${suffix}`;
    sheetName = `${sanitizeSheetName(sheet.name).slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  usedNames.add(sheetName);

  const columns = (sheet.widths || [])
    .map((width) => `<Column ss:Width="${width}" />`)
    .join("");
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, cellIndex) => {
          const type = getCellType(value);
          const style = getStyle(rowIndex, cellIndex, row);

          return `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
        })
        .join("");

      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${columns}${rows}</Table></Worksheet>`;
}

export function exportExcelWorkbook(filename: string, sheets: ExcelSheet[]) {
  if (typeof document === "undefined" || sheets.length === 0) return;

  const usedNames = new Set<string>();
  const workbook = `${workbookHeader}${sheets
    .map((sheet) => toWorksheet(sheet, usedNames))
    .join("")}</Workbook>`;
  const blob = new Blob([workbook], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportDateStamp() {
  const now = new Date();

  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(now.getDate()).padStart(2, "0")}`;
}
