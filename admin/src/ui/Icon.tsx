const PATHS: Record<string, string> = {
  products: "M4 7l8-4 8 4v10l-8 4-8-4V7zm8 4v10M4 7l8 4 8-4",
  shipping: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 100-.01M17 19a2 2 0 100-.01",
  data: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3",
  orders: "M7 4h10l1 3H6l1-3zM6 7h12v13H6zM9 11h6M9 15h4",
  categories: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z",
  account: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  plus: "M12 5v14M5 12h14",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z",
  gallery: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5a1 1 0 100-.01",
  up: "M12 19V5m-6 6l6-6 6 6",
  down: "M12 5v14m-6-6l6 6 6-6",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
};

/** Decorative icon (aria-hidden); the surrounding control always carries a text label. */
export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
