"use client";
import * as React from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowUpDown, Columns3 } from "lucide-react";
import { Input } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";

/**
 * Client-side table with global search, sorting, pagination and column visibility, for bounded
 * datasets already filtered and authorised on the server (e.g. a submission's line items).
 */
export function DataTable<T>({ columns, data, searchPlaceholder = "Search…", pageSize = 25, initialHidden, emptyMessage = "No rows" }: {
  columns: ColumnDef<T, unknown>[]; data: T[]; searchPlaceholder?: string; pageSize?: number;
  initialHidden?: string[]; emptyMessage?: string;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [visibility, setVisibility] = React.useState<VisibilityState>(
    Object.fromEntries((initialHidden ?? []).map((k) => [k, false])),
  );
  const [showCols, setShowCols] = React.useState(false);
  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter, columnVisibility: visibility },
    onSortingChange: setSorting, onGlobalFilterChange: setGlobalFilter, onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder} className="max-w-xs" aria-label="Search table" />
        <div className="relative">
          <Button variant="secondary" size="sm" onClick={() => setShowCols((s) => !s)} aria-expanded={showCols}><Columns3 className="h-4 w-4" />Columns</Button>
          {showCols ? (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-surface p-2 shadow-lg">
              {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                  {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-subtle text-left text-xs font-medium uppercase tracking-wide text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button className="inline-flex items-center gap-1 uppercase" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}<ArrowUpDown className="h-3 w-3" aria-hidden />
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {table.getRowModel().rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted">{emptyMessage}</td></tr>
            ) : table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="hover:bg-subtle/60">
                {r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-2.5 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
        <span>{table.getFilteredRowModel().rows.length} rows · page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
          <Button variant="secondary" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
        </div>
      </div>
    </div>
  );
}
