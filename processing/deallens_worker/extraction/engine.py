"""Document-level extraction entry point."""
from __future__ import annotations

from .grid import extract_grid
from .models import ExtractionResult
from .readers import hidden_sheets, read_csv, read_pdf, read_xls, read_xlsx
from .signatures import detect_type

CATEGORY_TO_STATEMENT = {
    "income_statement": "income_statement", "balance_sheet": "balance_sheet", "cash_flow_statement": "cash_flow",
}


def extract_document(data: bytes, declared_type: str, filename: str, category: str, fye: tuple[int, int] = (12, 31)) -> ExtractionResult:
    file_type = detect_type(data, declared_type)
    result = ExtractionResult(metadata={"verified_file_type": file_type})
    # The uploader's category is only a hint for unlabelled tables; it is never treated as proof of content.
    default_statement = CATEGORY_TO_STATEMENT.get(category, "supporting" if category != "other_supporting" else "unknown")
    if file_type == "xlsx":
        grids, method = read_xlsx(data), "excel_cell"
        hidden = hidden_sheets(data)
        if hidden:
            result.metadata["hidden_sheets_skipped"] = hidden
    elif file_type == "xls":
        grids, method = read_xls(data), "excel_cell_xls"
    elif file_type == "csv":
        grids, method = read_csv(data, filename), "csv_cell"
    else:
        grids = read_pdf(data)
        method = "pdf_table"
    for grid in grids:
        grid_method = method
        if file_type == "pdf" and grid.table_ref and "text lines" in grid.table_ref:
            grid_method = "pdf_text_line"
        extract_grid(grid, grid_method, default_statement, fye, result)
    result.metadata.update({
        "grids_scanned": len(grids),
        "line_items_extracted": len(result.items),
        "periods": sorted({i.period.label for i in result.items}),
        "detected_currencies": sorted({i.detected_currency for i in result.items if i.detected_currency}),
        "detected_units": sorted({i.detected_unit for i in result.items if i.detected_unit}),
        "warnings": result.warnings,
    })
    return result
