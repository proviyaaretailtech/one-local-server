# OneCity UI audit — machine summary

Generated 2026-09-23T21:42:05.782Z from e2e/results. Screens swept: 60.

## Hard errors per screen

| screen | route → landed | blank | stuck loading | back missing | page errors | console errors | non-2xx /api | blocked (config) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| about | /about → /about |  |  |  |  |  |  |  |
| account | /account → /account |  |  |  |  |  |  |  |
| address-form-manual | /address-form?manual=1 → /address-form?manual=1 |  |  |  |  |  |  |  |
| address-map | /address-map → /address-map |  |  |  |  |  |  |  |
| addresses-empty | /addresses → /addresses |  |  |  |  |  |  |  |
| addresses-saved | /addresses → /addresses |  |  |  |  |  |  |  |
| assistant | /assistant → /assistant |  |  |  |  |  |  |  |
| beauty | /beauty → /beauty |  |  |  |  |  |  |  |
| book-it | /book-it → /book-it |  |  |  |  |  |  |  |
| booking-e1 | /booking/e1 → /booking/e1 |  |  |  |  |  |  |  |
| brand-boat | /brand/boat → /brand/boat |  |  |  |  |  |  |  |
| brand-himalaya | /brand/himalaya → /brand/himalaya |  |  |  |  |  |  |  |
| care | /care → /care |  |  |  |  |  |  |  |
| cart-empty | /cart → /cart |  |  |  |  |  |  |  |
| cart-filled | /cart → /cart |  |  |  |  |  |  |  |
| categories | /categories → /categories |  |  |  |  |  |  |  |
| category-c1 | /category/c1 → /category/c1 |  |  |  |  |  |  |  |
| category-c15 | /category/c15 → /category/c15 |  |  |  |  |  |  |  |
| category-c9 | /category/c9 → /category/c9 |  |  |  |  |  |  |  |
| collection-festive | /collection/festive → /collection/festive |  |  |  |  |  |  |  |
| collection-fitness | /collection/fitness → /collection/fitness |  |  |  |  |  |  |  |
| discover | /discover → /discover |  |  |  |  |  |  |  |
| enquiries | /enquiries → /enquiries |  |  |  |  |  |  |  |
| food | /food → /food |  |  |  |  |  |  |  |
| grocery | /grocery → /grocery |  |  |  |  |  |  |  |
| help | /help → /help |  |  |  |  |  |  |  |
| home | / → / |  |  |  |  |  |  |  |
| location | /location → /location |  |  |  |  |  |  |  |
| missing-booking | /booking/does-not-exist → /booking/does-not-exist |  |  | YES |  |  |  |  |
| missing-brand | /brand/does-not-exist → /brand/does-not-exist |  |  | YES |  |  |  |  |
| missing-category | /category/does-not-exist → /category/does-not-exist |  |  |  |  |  |  |  |
| missing-collection | /collection/does-not-exist → /collection/does-not-exist |  |  | YES |  |  |  |  |
| missing-order | /order/does-not-exist → /order/does-not-exist |  |  | YES |  | Failed to load resource: the server responded with a status of 500 (Internal Server Error) | GET /api/orders/does-not-exist 500 |  |
| missing-product | /product/does-not-exist → /product/does-not-exist | YES |  | YES |  | Failed to load resource: the server responded with a status of 404 (Not Found) | GET /api/products/does-not-exist/story 404 |  |
| missing-store | /store/does-not-exist → /store/does-not-exist |  | YES | YES |  | Failed to load resource: the server responded with a status of 404 (Not Found) | GET /api/stores/does-not-exist 404 |  |
| order-tracking | /order/627c042d-d74b-49fb-ad85-1ac67c6faa81 → /order/627c042d-d74b-49fb-ad85-1ac67c6faa81 |  |  |  |  |  |  |  |
| orders-empty | /orders → /orders |  |  |  |  |  |  |  |
| orders-with-order | /orders → /orders |  |  |  |  |  |  |  |
| payments | /payments → /payments |  |  |  |  |  |  |  |
| pharmacy | /pharmacy → /pharmacy |  |  |  |  |  |  |  |
| product-f1 | /product/f1 → /product/f1 |  |  |  |  |  |  |  |
| product-p1 | /product/p1 → /product/p1 |  |  |  |  |  |  |  |
| product-sneak1 | /product/sneak1 → /product/sneak1 |  |  |  |  |  |  |  |
| profile-edit | /profile-edit → /profile-edit |  |  |  |  |  |  |  |
| reels | /reels → /reels |  |  |  |  |  |  |  |
| refer | /refer → /refer |  |  |  |  |  |  |  |
| search-q-milk | /search?q=milk → /search?q=milk |  |  |  |  |  |  |  |
| search-trending | /search?collection=trending → /search?collection=trending |  |  |  |  |  |  |  |
| search | /search → /search |  |  |  |  |  |  |  |
| shops | /shops → /shops |  |  |  |  |  |  |  |
| sign-in-welcome-deep-link-store | /sign-in?welcome=1 → /sign-in?welcome=1 |  |  |  |  |  |  |  |
| sign-in-welcome-home | /sign-in?welcome=1 → /sign-in?welcome=1 |  |  |  |  |  |  |  |
| smart-search-image | /smart-search?mode=image → /smart-search?mode=image |  |  |  |  |  |  |  |
| smart-search-voice | /smart-search?mode=voice → /smart-search?mode=voice |  |  |  |  |  |  |  |
| store-boat | /store/boat → /store/boat |  |  |  |  |  |  |  |
| store-himalaya | /store/himalaya → /store/himalaya |  |  |  |  |  |  |  |
| store-s1 | /store/s1 → /store/s1 |  |  |  |  |  |  |  |
| wallet | /wallet → /wallet |  |  |  |  |  |  |  |
| wishlist-empty | /wishlist → /wishlist |  |  |  |  |  |  |  |
| wishlist-filled | /wishlist → /wishlist |  |  |  |  |  |  |  |

## Tap targets smaller than 44×44 (grouped by testID pattern)

| testID pattern | screens | count | example size | example label |
| --- | --- | --- | --- | --- |
| location-button | 9: beauty, book-it, care, categories, food, grocery | 9 | 124×28 | Change location |
| category-type-filter | 4: category-c1, category-c15, category-c9, missing-category | 4 | 41.5×44 | Choose type |
| store-chip-* | 3: store-boat, store-himalaya, store-s1 | 7 | 97.6×36 | Electronics |
| back-btn | 3: store-boat, store-himalaya, store-s1 | 3 | 40×40 |  |
| follow-btn | 3: store-boat, store-himalaya, store-s1 | 3 | 140.6×40 |  Follow store |
| store-chip-all | 3: store-boat, store-himalaya, store-s1 | 3 | 104.1×36 | 🛒 All Items |
| orders-back-btn | 2: orders-empty, orders-with-order | 2 | 40×40 |  |
| pref-diet-any | 1: account | 1 | 86.9×40 | Anything |
| pref-diet-veg | 1: account | 1 | 72.1×40 | Veg |
| pref-diet-egg | 1: account | 1 | 72.2×40 | Egg |
| pref-diet-nonveg | 1: account | 1 | 102.3×40 | Non-veg |
| pref-lang-en | 1: account | 1 | 76.1×40 | English |
| pref-notify-orders (child) | 1: account | 1 | 40×20 |  |
| pref-notify-offers (child) | 1: account | 1 | 40×20 |  |
| pref-notify-bookings (child) | 1: account | 1 | 40×20 |  |
| address-kind-home | 1: address-form-manual | 1 | 101.3×40 |  Home |
| address-kind-work | 1: address-form-manual | 1 | 101.3×40 |  Work |
| address-kind-other | 1: address-form-manual | 1 | 101.3×40 |  Other |
| browse-btn | 1: cart-empty | 1 | 156.8×41 | Browse products |
| coupon-suggestion-laturN | 1: cart-filled | 1 | 334×13 | LATUR10 — 10% off above ₹99 |
| coupon-suggestion-freshN | 1: cart-filled | 1 | 334×13 | FRESH50 — ₹50 off above ₹199 |
| bill-gst-toggle | 1: cart-filled | 1 | 334×37 | GST on food (5%) CGST + SGST · tap for breakdown ₹12.90 |
| bill-included-toggle | 1: cart-filled | 1 | 334×13 | Item prices include GST · tap to see how much |
| checkout-btn | 1: cart-filled | 1 | 169×41 | Place sample order  |
| address-menu-address-home | 1: location | 1 | 32×32 | Options for Home |
| address-menu-address-work | 1: location | 1 | 32×32 | Options for Work |
| track-back-btn | 1: order-tracking | 1 | 40×40 |  |
| orders-screen (child) | 1: orders-empty | 1 | 144.8×41 | Start shopping |
| track-#-NdN-Ncc-Ncb-# | 1: orders-with-order | 1 | 78.5×33 |  Track |
| reorder-#-NdN-Ncc-Ncb-# | 1: orders-with-order | 1 | 91.2×33 |  Reorder |
| profile-diet-any | 1: profile-edit | 1 | 86.9×40 | Anything |
| profile-diet-veg | 1: profile-edit | 1 | 54.1×40 | Veg |
| profile-diet-egg | 1: profile-edit | 1 | 54.2×40 | Egg |
| profile-diet-nonveg | 1: profile-edit | 1 | 84.3×40 | Non-veg |

## Words broken across two lines

| testID pattern | screens | count | example |
| --- | --- | --- | --- |

## Truncated text (ellipsis / line clamp)

| testID pattern | screens | count | mid-word | example |
| --- | --- | --- | --- | --- |
| categories-more-brand-name-* | categories | 2 | yes | The Home Edit → The Home E… |
| collection-*-brand-name-* | collection-festive | 2 | yes | Chitale Bandhu → Chitale Ban… |
| home-shops-brand-name-* | home | 2 | yes | Latur Artisans → Latur Artisa… |
| product-weight-shops-home-* | home | 2 | yes | Red · sample size UK 8 → Red · sample size U… |
| home-new-brands-brand-name-* | home | 2 | yes | Latur Artisans → Latur Artisa… |
| shops-page-brand-name-* | shops | 2 | yes | Latur Artisans → Latur Artisa… |
| categories-brands-brand-name-* | categories | 1 | yes | Latur Artisans → Latur Artisa… |
| product-weight-category-* | category-c9 | 1 |  | burger + fries → burger +… |
| grocery-page-brand-name-* | grocery | 1 | yes | Chitale Bandhu → Chitale Ban… |
| product-weight-food-home-* | home | 1 |  | Burger King · burger + fries → Burger King · burger… |
| product-weight-pharmacy-home-* | home | 1 | yes | 60 tablets · sample listing → 60 tablets · sample li… |
| product-name-home-budget-* | home | 1 |  | Aashirvaad Whole Wheat Atta → clamp-2 |

## Text clipped by a container

| testID pattern | screens | count | example |
| --- | --- | --- | --- |
| product-weight-food-home-* | home | 1 | Burger King · burger + fries (axis x, 14px past product-card-food-home-f4) |
| product-weight-shops-home-* | home | 1 | Over-ear · sample model (axis x, 2.3px past product-card-shops-home-audio1) |
| product-weight-pharmacy-home-* | home | 1 | 60 tablets · sample listing (axis x, 7.6px past product-card-pharmacy-home-h1) |

## Text spilling outside its tappable tile

| testID pattern | screens | count | example |
| --- | --- | --- | --- |
| categories-more-brand-name-* | categories | 2 | The Home Edit (5.5px outside categories-more-brand-home-edit) |
| collection-*-brand-name-* | collection-festive | 2 | Chitale Bandhu (8.4px outside collection-festive-brand-chitale) |
| home-shops-brand-name-* | home | 2 | Latur Artisans (3.3px outside home-shops-brand-latur-artisans) |
| home-new-brands-brand-name-* | home | 2 | Latur Artisans (3.3px outside home-new-brands-brand-latur-artisans) |
| shops-page-brand-name-* | shops | 2 | Latur Artisans (3.3px outside shops-page-brand-latur-artisans) |
| categories-brands-brand-name-* | categories | 1 | Latur Artisans (3.3px outside categories-brands-brand-latur-artisans) |
| grocery-page-brand-name-* | grocery | 1 | Chitale Bandhu (8.4px outside grocery-page-brand-chitale) |
| product-weight-food-home-* | home | 1 | Burger King · burger + fries (15px outside product-name-open-food-home-f4) |
| product-weight-shops-home-* | home | 1 | Over-ear · sample model (3.3px outside product-name-open-shops-home-audio1) |
| product-weight-pharmacy-home-* | home | 1 | 60 tablets · sample listing (8.6px outside product-name-open-pharmacy-home-h1) |

## Interactive elements covered by another element

| element → covered by | phase | screens | count | example |
| --- | --- | --- | --- | --- |
| sign-in-skip → sign-in-screen (child) | on arrival | sign-in-welcome-deep-link-store, sign-in-welcome-home | 2 | Skip for now 3/5 points |
| sidebar-* → tab-home | end of scroll | category-c1 | 1 | Indian Sweets 2/2 points |
| reel-mute-photo-* → reel-card-photo-* (child) | end of scroll | reels | 1 | Unmute video 3/5 points |

## Text hidden under a floating bar at the end of scrolling

| text → covered by | screens | count | example |
| --- | --- | --- | --- |
| sidebar-label-* → tab-home (child) | category-c1 | 1 | Home Needs |
| reel-mute-photo-* (child) → reel-card-photo-* (child) | reels | 1 | Sound off |

## Images not filling their frame (object-fit contain)

| testID pattern | screens | count | example |
| --- | --- | --- | --- |
| product-image-care-* | beauty, care, pharmacy | 27 | 45% filled, left/right bars, frame 167x112, image 667x1000 |
| sidebar-image-* | category-c1, category-c15, category-c9 | 14 | 67% filled, top/bottom bars, frame 49x49, image 900x600 |
| product-image-category-* | category-c1, category-c15, category-c9 | 6 | 70% filled, left/right bars, frame 134x134, image 695x1000 |
| product-detail (child) | product-f1, product-p1, product-sneak1 | 3 | 83% filled, top/bottom bars, frame 110x110, image 900x748 |
| collection-floating-product-N | collection-festive, collection-fitness | 3 | 79% filled, top/bottom bars, frame 65.3x65.3, image 283x223 |
| vendor-illustration-veggies | cart-filled, order-tracking | 2 | 90% filled, top/bottom bars, frame 79x88, image 384x384 |
| collection-hero-image-* | collection-festive, collection-fitness | 2 | 78% filled, left/right bars, frame 208.5x209.8, image 490x636 |
| product-image-grocery-* | grocery | 42 | 47% filled, left/right bars, frame 167x112, image 695x1000 |
| product-image-shops-* | shops | 11 | 67% filled, left/right bars, frame 167x112, image 900x900 |
| product-image-*-home-* | home | 4 | 76% filled, top/bottom bars, frame 112x98, image 900x600 |
| product-image-picks-* | home | 3 | 88% filled, left/right bars, frame 112x98, image 900x900 |
| brand-logo-* | brand-boat | 1 | 64% filled, left/right bars, frame 83x53, image 600x600 |
| grid-fresh-category-image-* | categories | 1 | 67% filled, left/right bars, frame 81.5x81.5, image 667x1000 |
| spotlight-image-grocery | grocery | 1 | 70% filled, left/right bars, frame 206.8x205.7, image 549x777 |
| grocery-page-brand-logo-* | grocery | 1 | 40% filled, top/bottom bars, frame 43x43, image 600x237 |
| spotlight-image-home | home | 1 | 70% filled, left/right bars, frame 206.8x205.7, image 549x777 |
| product-image-food-home-* | home | 1 | 76% filled, top/bottom bars, frame 112x98, image 900x600 |
| product-image-pharmacy-home-* | home | 1 | 58% filled, left/right bars, frame 112x98, image 667x1000 |
| product-image-beauty-home-* | home | 1 | 58% filled, left/right bars, frame 112x98, image 667x1000 |
| pd-store-card (child) | product-p1 | 1 | 67% filled, left/right bars, frame 46x46, image 400x600 |
| reel-brand-logo-r-* | reels | 1 | 55% filled, top/bottom bars, frame 35x25, image 600x237 |
| reel-brand-logo-rN | reels | 1 | 71% filled, left/right bars, frame 35x25, image 240x240 |

## Suspicious text on screen (literal \n, undefined, NaN, null …)

| testID | screens | match | text |
| --- | --- | --- | --- |

## Controls cut off by their container

| testID pattern | screens | count | example |
| --- | --- | --- | --- |
| spotlight-brand-care | beauty, care, pharmacy | 3 | Explore The NIVEA edit — 3.5px vertically by spotlight-care > … (136.8x51) |
| spotlight-brand-book-it | book-it | 1 | Explore Latur After Hours — 4.4px vertically by spotlight-book-it > … (171.6x52.8) |
| discover-filter-all | discover | 1 | All — 10.4px vertically by discover-screen > … (49.7x44) |
| discover-filter-reels | discover | 1 | Reels — 10.4px vertically by discover-screen > … (65.1x44) |
| discover-filter-food | discover | 1 | Food — 10.4px vertically by discover-screen > … (62.8x44) |
| discover-filter-fresh | discover | 1 | Fresh — 10.4px vertically by discover-screen > … (65.9x44) |
| discover-filter-care | discover | 1 | Care — 10.4px vertically by discover-screen > … (61.1x44) |
| spotlight-brand-grocery | grocery | 1 | Explore The dairy edit — 4.1px vertically by spotlight-grocery > … (158.9x52.1) |
| spotlight-brand-home | home | 1 | Explore Amul goodness — 4.3px vertically by spotlight-home > … (167.9x52.6) |
| spotlight-brand-shops | shops | 1 | Explore The style edit — 4.1px vertically by spotlight-shops > … (158.5x52.1) |

## Broken images

| testID | screen | src |
| --- | --- | --- |

## Journeys

| journey | result | failed step | error |
| --- | --- | --- | --- |
| addresses | PASS |  |  |
| book-it | PASS |  |  |
| brand | PASS |  |  |
| checkout | PASS |  |  |
| help | PASS |  |  |
| location-new-address | PASS |  |  |
| product-back | PASS |  |  |
| profile-payments | PASS |  |  |
| search | PASS |  |  |
| store | PASS |  |  |
| wishlist | PASS |  |  |

## Cart add feedback

```json
{
 "adds": 9,
 "mascotShowsInFirstVisit": 1,
 "mascotShowsAfterReload": 1,
 "timeline": [
  {
   "action": "ADD p1 on /grocery",
   "cartItems": 1,
   "mascotShowsSoFar": 1,
   "floatingCart": "1 item in your bag"
  },
  {
   "action": "ADD p2 on /grocery",
   "cartItems": 2,
   "mascotShowsSoFar": 1,
   "floatingCart": "2 items in your bag"
  },
  {
   "action": "ADD p3 on /grocery",
   "cartItems": 3,
   "mascotShowsSoFar": 1,
   "floatingCart": "3 items in your bag"
  },
  {
   "action": "ADD p4 on /grocery",
   "cartItems": 4,
   "mascotShowsSoFar": 1,
   "floatingCart": "4 items in your bag"
  },
  {
   "action": "ADD p5 on /grocery",
   "cartItems": 5,
   "mascotShowsSoFar": 1,
   "floatingCart": "5 items in your bag"
  },
  {
   "action": "ADD p6 on /grocery",
   "cartItems": 6,
   "mascotShowsSoFar": 1,
   "floatingCart": "6 items in your bag"
  },
  {
   "action": "+1 on p1 stepper",
   "cartItems": 7,
   "mascotShowsSoFar": 1,
   "floatingCart": "7 items in your bag"
  },
  {
   "action": "Add to Cart on product page p7",
   "cartItems": 8,
   "mascotShowsSoFar": 1,
   "floatingCart": "product page cart bar"
  },
  {
   "action": "ADD p8 after a page reload",
   "cartItems": 9,
   "mascotShowsSoFar": 1,
   "floatingCart": "9 items in your bag"
  }
 ],
 "popups": [
  {
   "at": 1790199592944,
   "text": "Great pick!Coca Cola is in your bag.View bag · 9"
  }
 ],
 "pageErrors": []
}
```

## First launch (/store/s1)

| step | ok | note |
| --- | --- | --- |
| intro splash plays | yes | intro visible for ~2.3 s after first paint |
| sign-in offer appears once | yes |  |
| a finger tap on the centre of “Skip for now” works | yes | BLOCKED at centre; only the top-right corner of the button responds |
| “Skip for now” returns to the requested screen | yes |  |
| the offer does not return on the next load | yes |  |

## First launch (/)

| step | ok | note |
| --- | --- | --- |
| intro splash plays | yes | intro visible for ~2.0 s after first paint |
| sign-in offer appears once | yes |  |
| a finger tap on the centre of “Skip for now” works | yes | BLOCKED at centre; only the top-right corner of the button responds |
| “Skip for now” returns to the requested screen | yes |  |
| the offer does not return on the next load | yes |  |
