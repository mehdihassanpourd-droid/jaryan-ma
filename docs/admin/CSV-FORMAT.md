# Product CSV format

UTF-8 text (a BOM is written on export so Excel and Google Sheets open Persian correctly). Comma separated, quotes as in RFC 4180 (`"` doubled inside quotes; newlines allowed inside quotes). Max 2,000,000 characters and 20,000 rows per file. **Row numbers in error messages count records; the header is row 1.**

One product = one or more rows. Rows with the same `slug` are one product: the **first** row carries the product fields; every row that has a `variant_sku` adds one variant. Later rows may leave product fields empty (if filled they must equal the first row, otherwise `conflicting_product_fields`).

| Column | Required | Meaning |
|---|---|---|
| `slug` | yes | Identifier used to create/update (letters incl. Persian, digits, `-`). Existing slug = update, new slug = create. |
| `name` | yes | 2–120 characters. |
| `description` | no | up to 5,000 characters. |
| `category_slug` | no (yes to publish) | Must exist, otherwise `unknown_category`. |
| `status` | no | `draft` (default), `published`, `archived`. |
| `fulfillment` | yes | `unique`, `stocked`, `made_to_order`. |
| `price_toman` | no (yes to publish) | Whole Toman. Persian digits and separators are fine (`۱٬۲۰۰٬۰۰۰`); decimals/negatives are rejected. |
| `inventory` | by type | `unique`: 0 or 1 (default 1). `stocked` without variants: required. Empty for made-to-order or when variants carry stock. |
| `lead_time_days` | made-to-order | 1–365; empty otherwise. |
| `image_keys` | no | Keys of images **already uploaded** (`images/<productId>/<id>.webp`), separated by `\|`. CSV does not upload files. |
| `image_alts` | no | Alt texts aligned with `image_keys`, separated by `\|`. |
| `variant_sku` | for variants | Unique across the catalogue (letters, digits, `.`, `_`, `-`). |
| `variant_options` | with a SKU | `name=value` pairs separated by `\|`, e.g. `size=۱۰۰×۱۵۰\|color=سبز`. 1–3 pairs; every variant of a product uses the same names. |
| `variant_price_toman` | no | Overrides the product price. |
| `variant_inventory` | by type | Required for stocked variants; empty for made-to-order. |

`|` and (in option names) `=` are not allowed inside values. Unknown or duplicate columns are errors, so typos are caught.

## Example

```csv
slug,name,description,category_slug,status,fulfillment,price_toman,inventory,lead_time_days,image_keys,image_alts,variant_sku,variant_options,variant_price_toman,variant_inventory
demo-hanging,دیوارکوب نمونه,توضیح نمونه,wall-hangings,draft,unique,,1,,,,,,,
demo-cushion,کوسن نمونه,,home-decor,draft,stocked,500,,,,,K-S,size=S|color=سبز,,4
demo-cushion,,,,,,,,,,,K-L,size=L|color=سبز,600,0
demo-runner,رانر نمونه,,home-decor,draft,made_to_order,,,14,,,,,,
```

## How import works

1. The admin app parses and validates the whole file **in the browser** (same code as the server) and shows every problem with its row number and a Persian message.
2. Valid products are sent in chunks (default 10 per request; the server enforces `IMPORT_CHUNK_MAX`). Each chunk is **all-or-nothing** in one database transaction and creates or updates by `slug`.
3. Chunks are sent with `?defer=1`, and one final `POST /api/v1/catalog/resync` rebuilds the public category files and manifest once.
4. Importing as `published` requires the publish right and the usual publish rules.

Export reads the product list page by page (100 per request) and writes the same format; spreadsheet formulas in text cells are neutralised with a leading `'`, which import removes.

## Issue codes

`csv_too_large`, `csv_too_many_rows`, `csv_empty`, `csv_unterminated_quote`, `missing_column`, `unknown_column`, `duplicate_column`, `too_many_cells`, `slug_required`, `invalid_number`, `unknown_category`, `invalid_variant_options`, `conflicting_product_fields`, plus every product validation code (see `src/domain/product/messages.fa.ts` for the Persian text).
