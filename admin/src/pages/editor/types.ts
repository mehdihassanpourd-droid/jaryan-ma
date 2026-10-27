import type { Dispatch, SetStateAction } from "react";
import type { CategoryRecord } from "@/domain/product/ports";
import type { FieldErrors, ProductForm } from "../../lib/product-form";

export interface TabProps {
  form: ProductForm;
  setForm: Dispatch<SetStateAction<ProductForm>>;
  errors: FieldErrors;
  categories: CategoryRecord[];
  readOnly: boolean;
}
