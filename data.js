/*
 * data.js
 * -------
 * Hard-coded product catalog for the Barcode Auto-Biller.
 *
 * This file is loaded BEFORE app.js in index.html.
 * Because we use plain <script> tags (no modules), the two constants below
 * are available to app.js as globals.
 *
 * Barcode rules:
 * - We use EAN-13: exactly 13 digits stored as a STRING (never a number).
 *   Storing as a string keeps leading zeros and avoids number precision issues.
 * - The 13th digit is a check digit. Every barcode below was generated with
 *   a valid check digit so a real barcode scanner can read it.
 * - The "890" prefix is the GS1 country code for India.
 */

// Step 1: The raw catalog. `quantity` means "units currently in stock".
const products = [
  { barcode: "8901000000015", name: "Classic Cola 500ml",          brand: "Beverages Co",  price: 40.00,  quantity: 120 },
  { barcode: "8901000000024", name: "Basmati Rice 1kg",            brand: "Golden Fields", price: 185.50, quantity: 60 },
  { barcode: "8901000000033", name: "Whole Wheat Bread",           brand: "Fresh Bake",    price: 55.00,  quantity: 40 },
  { barcode: "8901000000042", name: "Farm Fresh Milk 1L",          brand: "Dairy Daily",   price: 68.00,  quantity: 80 },
  { barcode: "8901000000051", name: "Detergent Powder 1kg",        brand: "CleanMax",      price: 210.00, quantity: 35 },
  { barcode: "8901000000060", name: "Sunflower Oil 1L",            brand: "GoldDrop",      price: 145.00, quantity: 50 },
  { barcode: "8901000000079", name: "Refined Sugar 1kg",           brand: "SweetHome",     price: 46.00,  quantity: 100 },
  { barcode: "8901000000088", name: "Tea Bags (25 pcs)",           brand: "Morning Blend", price: 120.00, quantity: 70 },
  { barcode: "8901000000097", name: "Coffee Powder 100g",          brand: "BrewBest",      price: 175.00, quantity: 45 },
  { barcode: "8901000000103", name: "Iodised Salt 1kg",            brand: "Crystal Salt",  price: 25.00,  quantity: 150 },
  { barcode: "8901000000112", name: "Whole Wheat Atta 5kg",        brand: "Golden Fields", price: 240.00, quantity: 30 },
  { barcode: "8901000000121", name: "Toilet Paper Roll (4 pcs)",   brand: "SoftTouch",     price: 160.00, quantity: 55 },
  { barcode: "8901000000130", name: "Dishwash Gel 500ml",          brand: "ShinePro",      price: 95.00,  quantity: 65 },
  { barcode: "8901000000149", name: "Shampoo 200ml",               brand: "HairCare",      price: 180.00, quantity: 40 },
  { barcode: "8901000000158", name: "Toothpaste 100g",             brand: "BrightSmile",   price: 85.00,  quantity: 90 },
  { barcode: "8901000000167", name: "Notebook A4 (100 pages)",     brand: "PaperWorks",    price: 60.00,  quantity: 75 },
  { barcode: "8901000000176", name: "Ball Pen Pack (10 pcs)",      brand: "WriteWell",     price: 50.00,  quantity: 110 },
  { barcode: "8901000000185", name: "Packaged Water 1L",           brand: "AquaPure",      price: 20.00,  quantity: 200 },
  { barcode: "8901000000194", name: "Potato Chips 100g",           brand: "Crunchy",       price: 35.00,  quantity: 130 },
  { barcode: "8901000000200", name: "Cream Biscuits 200g",         brand: "Crunchy",       price: 45.00,  quantity: 125 },
  { barcode: "8901000000219", name: "Farm Eggs (6 pcs)",           brand: "Farm Fresh",    price: 60.00,  quantity: 50 },
  { barcode: "8901000000228", name: "Onions 1kg",                  brand: "Fresh Mart",    price: 40.00,  quantity: 80 },
  { barcode: "8901000000237", name: "Tomatoes 1kg",                brand: "Fresh Mart",    price: 35.00,  quantity: 80 },
  { barcode: "8901000000246", name: "Laundry Bar 200g",            brand: "CleanMax",      price: 30.00,  quantity: 95 },
  { barcode: "8901000000255", name: "Hand Wash 250ml",             brand: "SoftTouch",     price: 110.00, quantity: 60 }
];

/*
 * Step 2: Build a lookup Map for instant access.
 *
 * A Map is like an object, but its keys can be any value and lookups are fast.
 * Here the key is the barcode string and the value is the whole product object.
 * Later iterations will use `productMap.get(barcode)` instead of searching
 * through the array with a loop.
 */
const productMap = new Map();

products.forEach(function (product) {
  productMap.set(product.barcode, product);
});
