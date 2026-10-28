/**
 * Positions on the 12-column "wall" (RTL: columns count from the right). Every third work is large, the next sits further along the
 * wall and the last is indented, so neighbours differ in width and offset and wide screens pair a big work with a smaller one.
 */
export const WALL_SLOTS = [
  "col-span-10 sm:col-span-7",
  "col-span-7 col-start-6 sm:col-span-5 sm:col-start-8",
  "col-span-8 col-start-3 sm:col-span-6 sm:col-start-4",
] as const;
