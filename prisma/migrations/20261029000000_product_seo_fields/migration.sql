-- Optional SEO overrides on products (editor-chosen page title and meta description).
-- Additive and nullable: existing rows and older clients are unaffected; null means "generate automatically".
ALTER TABLE "products" ADD COLUMN "seoTitle" TEXT, ADD COLUMN "seoDescription" TEXT;

ALTER TABLE "products"
  ADD CONSTRAINT "products_seo_title_len" CHECK ("seoTitle" IS NULL OR char_length("seoTitle") <= 70),
  ADD CONSTRAINT "products_seo_description_len" CHECK ("seoDescription" IS NULL OR char_length("seoDescription") <= 160);
