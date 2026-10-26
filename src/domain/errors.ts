import type { ValidationIssue } from "./product/schema";

export type ConflictCode = "version_conflict" | "slug_taken" | "sku_taken" | "category_slug_taken";

export class ConflictError extends Error {
  constructor(public code: ConflictCode) {
    super(code);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("not_found");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super("validation_failed");
    this.name = "ValidationError";
  }
}
