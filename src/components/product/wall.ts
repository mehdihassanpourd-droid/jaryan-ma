/**
 * One product grid for every list (home, collections, related). Every card is the same: a 4:5 picture, the category, the name and the price.
 * On a phone two columns, and the first work of every three spans both so the picture is large (a calm editorial rhythm, faster to scan
 * than a single column). From `sm` three columns whose middle column hangs lower, so the wall is asymmetric but balanced.
 */
export const PRODUCT_GRID = "grid grid-cols-2 items-stretch gap-x-3 gap-y-9 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-14 lg:gap-x-10 [&>li:nth-child(3n+1)]:col-span-2 sm:[&>li:nth-child(3n+1)]:col-span-1 sm:[&>li:nth-child(3n+2)]:mt-14 lg:[&>li:nth-child(3n+2)]:mt-24";
