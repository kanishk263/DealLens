# Troubleshooting

| Problem | Cause and fix |
|---|---|
| `npm install` warns `EBADENGINE` / build fails on old Node | Use Node ≥ 20.9 (repo pins 22 in `.nvmrc`). |
| "Invalid Supabase configuration" on any page | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing in `.env.local`; run `npm run db:status` for local values. |
| Google sign-in errors | See [authentication.md → Troubleshooting](authentication.md#troubleshooting). |
| Submission stays in *Uploaded* | The worker is not running: `npm run worker`. Check Admin → Processing jobs. |
| Job retried then failed with `STORAGE_*` | Worker cannot reach Storage: check `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in `processing/.env`. |
| Document *Unsupported* with `SCANNED_PDF_UNSUPPORTED` | Image-only PDF; upload the source spreadsheet or a text-based PDF. |
| `MACRO_WORKBOOK_UNSUPPORTED` | Save the workbook as `.xlsx` without macros. |
| `FILE_SIGNATURE_MISMATCH` | File renamed to the wrong extension; re-export in the correct format. |
| Many values "invalid" with formulas | Workbook saved without calculated values; open in Excel, recalculate, save, re-upload. |
| Few line items extracted | Periods must be column headers (e.g. `FY2023`, `2023`, `Dec-23`) and labels in a column to their left. Check the document's extraction warnings. |
| Metrics show "n/a" | Required inputs are unmapped or invalid; open the value to see the reason, map items in Financial data, then *Recalculate*. |
| Cannot submit report for review | PDF not generated yet, a regeneration is running, or clarifications are open. |
| Publish button missing after approval | The final approved PDF is rendering; ensure the worker is running. |
| Integration tests refuse to run | They only run against a local Supabase URL by design. |
| `supabase start` fails | Docker Desktop must be running; free ports 54321–54324. `npx supabase stop --no-backup` then start again. |
| Page shows "Unable to load this information" | Check server logs for an error digest; errors are logged with codes only. |
