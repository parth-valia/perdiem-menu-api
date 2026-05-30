/**
 * Seed Square sandbox with real catalog data including images.
 * Run: node seed-sandbox.js
 *
 * What this does (all via Square v2 API):
 *   1. Clears existing catalog  → POST /v2/catalog/batch-delete
 *   2. Uploads images           → POST /v2/catalog/images  (multipart)
 *   3. Creates full catalog     → POST /v2/catalog/batch-upsert
 *
 * Docs:
 *   https://developer.squareup.com/reference/square/catalog-api
 *   https://developer.squareup.com/reference/square/locations-api
 */

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SquareClient, SquareEnvironment } = require('square');
const { randomUUID } = require('crypto');

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: SquareEnvironment.Sandbox,
});

// ─── Free-to-use food photos (Unsplash) ──────────────────────────────────────
// fm=jpg forces JPEG so Square accepts the upload (it rejects WebP/AVIF)
const ITEM_IMAGES = [
  {
    key: 'classic-burger',
    name: 'Classic Burger',
    url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'bbq-burger',
    name: 'BBQ Smokehouse Burger',
    url: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'veggie-burger',
    name: 'Veggie Burger',
    url: 'https://images.unsplash.com/photo-1520072959219-c595dc870360?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'cola',
    name: 'Classic Cola',
    url: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'lemonade',
    name: 'Fresh Lemonade',
    url: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'fries',
    name: 'Crispy Fries',
    url: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'onion-rings',
    name: 'Onion Rings',
    url: 'https://images.unsplash.com/photo-1639024471283-03518883512d?w=800&fm=jpg&fit=crop&q=80',
  },
  {
    key: 'milkshake',
    name: 'Hand-Spun Milkshake',
    url: 'https://images.unsplash.com/photo-1550317138-10000687a72b?w=800&fm=jpg&fit=crop&q=80',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    function get(u, redirects) {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'perdiem-menu-api-seeder/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url, 0);
  });
}

async function uploadImage(key, name, filePath) {
  // Square rejects application/octet-stream — pass a Blob with explicit MIME type
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const resp = await client.catalog.images.create({
    request: {
      idempotencyKey: randomUUID(),
      image: {
        type: 'IMAGE',
        id: `#img-${key}`,
        imageData: { name, caption: name },
      },
    },
    imageFile: blob,
  });

  if (resp.errors?.length) {
    throw new Error(`Image upload failed for ${name}: ${JSON.stringify(resp.errors)}`);
  }
  return resp.image.id;
}

async function clearCatalog() {
  const ids = [];
  let page = await client.catalog.list({});
  while (true) {
    ids.push(...page.data.map((o) => o.id));
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }
  if (!ids.length) return;

  // Square batch-delete limit is 200 per call
  for (let i = 0; i < ids.length; i += 200) {
    await client.catalog.batchDelete({ objectIds: ids.slice(i, i + 200) });
  }
  console.log(`  Deleted ${ids.length} existing objects.`);
}

const tmpId = (name) => `#${name}`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  const tmpDir = os.tmpdir();

  // 1. Clear existing catalog
  console.log('1/3  Clearing existing catalog...');
  await clearCatalog();

  // 2. Download + upload images
  console.log('2/3  Uploading images to Square sandbox...');
  const imageIds = {};

  for (const img of ITEM_IMAGES) {
    const filePath = path.join(tmpDir, `${img.key}.jpg`);
    process.stdout.write(`     ↓ ${img.name} ... `);
    try {
      await download(img.url, filePath);
      imageIds[img.key] = await uploadImage(img.key, img.name, filePath);
      console.log(`✓  (${imageIds[img.key]})`);
    } catch (err) {
      console.log(`✗  skipped (${err.message})`);
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  // 3. Batch-upsert full catalog
  console.log('3/3  Creating catalog objects...');

  const imgIds = (key) => {
    const id = imageIds[key];
    return id ? [id] : [];
  };

  const resp = await client.catalog.batchUpsert({
    idempotencyKey: randomUUID(),
    batches: [
      {
        objects: [
          // ── Categories ────────────────────────────────────────────────────
          {
            type: 'CATEGORY',
            id: tmpId('cat-burgers'),
            categoryData: { name: 'Burgers' },
          },
          {
            type: 'CATEGORY',
            id: tmpId('cat-drinks'),
            categoryData: { name: 'Drinks' },
          },
          {
            type: 'CATEGORY',
            id: tmpId('cat-sides'),
            categoryData: { name: 'Sides' },
          },
          {
            type: 'CATEGORY',
            id: tmpId('cat-desserts'),
            categoryData: { name: 'Desserts' },
          },

          // ── Modifier lists ────────────────────────────────────────────────
          {
            type: 'MODIFIER_LIST',
            id: tmpId('ml-extras'),
            modifierListData: {
              name: 'Burger Extras',
              selectionType: 'MULTIPLE',
              modifiers: [
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-cheese'),
                  modifierData: {
                    name: 'Add Cheese',
                    priceMoney: { amount: BigInt(100), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-bacon'),
                  modifierData: {
                    name: 'Add Bacon',
                    priceMoney: { amount: BigInt(150), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-avocado'),
                  modifierData: {
                    name: 'Add Avocado',
                    priceMoney: { amount: BigInt(200), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-egg'),
                  modifierData: {
                    name: 'Add Fried Egg',
                    priceMoney: { amount: BigInt(125), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-jalapeño'),
                  modifierData: {
                    name: 'Add Jalapeños',
                    priceMoney: { amount: BigInt(50), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'MODIFIER_LIST',
            id: tmpId('ml-bun'),
            modifierListData: {
              name: 'Bun Type',
              selectionType: 'SINGLE',
              modifiers: [
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-bun-brioche'),
                  modifierData: {
                    name: 'Brioche Bun',
                    priceMoney: { amount: BigInt(0), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-bun-lettuce'),
                  modifierData: {
                    name: 'Lettuce Wrap (GF)',
                    priceMoney: { amount: BigInt(0), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-bun-pretzel'),
                  modifierData: {
                    name: 'Pretzel Bun',
                    priceMoney: { amount: BigInt(75), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'MODIFIER_LIST',
            id: tmpId('ml-drink-size'),
            modifierListData: {
              name: 'Drink Size',
              selectionType: 'SINGLE',
              modifiers: [
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-drink-sm'),
                  modifierData: {
                    name: 'Small (12 oz)',
                    priceMoney: { amount: BigInt(0), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-drink-md'),
                  modifierData: {
                    name: 'Medium (16 oz)',
                    priceMoney: { amount: BigInt(75), currency: 'USD' },
                  },
                },
                {
                  type: 'MODIFIER',
                  id: tmpId('mod-drink-lg'),
                  modifierData: {
                    name: 'Large (22 oz)',
                    priceMoney: { amount: BigInt(125), currency: 'USD' },
                  },
                },
              ],
            },
          },

          // ── Burgers ───────────────────────────────────────────────────────
          {
            type: 'ITEM',
            id: tmpId('item-classic-burger'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Classic Smash Burger',
              description:
                'Two smashed beef patties, American cheese, shredded lettuce, tomato, pickles, and our house "Perdiem" sauce on a toasted brioche bun.',
              categoryId: tmpId('cat-burgers'),
              imageIds: imgIds('classic-burger'),
              modifierListInfo: [
                { modifierListId: tmpId('ml-extras'), enabled: true },
                { modifierListId: tmpId('ml-bun'), enabled: true },
              ],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-classic-single'),
                  itemVariationData: {
                    name: 'Single',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1299), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-classic-double'),
                  itemVariationData: {
                    name: 'Double',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1699), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-classic-triple'),
                  itemVariationData: {
                    name: 'Triple',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1999), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-bbq-burger'),
            presentAtAllLocations: true,
            itemData: {
              name: 'BBQ Smokehouse Burger',
              description:
                'Beef patty topped with pulled pork, smoked cheddar, crispy onion straws, and tangy house-made BBQ sauce.',
              categoryId: tmpId('cat-burgers'),
              imageIds: imgIds('bbq-burger'),
              modifierListInfo: [
                { modifierListId: tmpId('ml-extras'), enabled: true },
                { modifierListId: tmpId('ml-bun'), enabled: true },
              ],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-bbq-single'),
                  itemVariationData: {
                    name: 'Single',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1549), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-bbq-double'),
                  itemVariationData: {
                    name: 'Double',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1949), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-veggie-burger'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Garden Veggie Burger',
              description:
                'House-made black bean and roasted corn patty, pepper jack cheese, roasted red peppers, arugula, and chipotle aioli.',
              categoryId: tmpId('cat-burgers'),
              imageIds: imgIds('veggie-burger'),
              modifierListInfo: [
                { modifierListId: tmpId('ml-extras'), enabled: true },
                { modifierListId: tmpId('ml-bun'), enabled: true },
              ],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-veggie'),
                  itemVariationData: {
                    name: 'Regular',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1249), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-mushroom-burger'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Truffle Mushroom Burger',
              description:
                'Beef patty, sautéed wild mushrooms, Swiss cheese, caramelized onions, and truffle aioli on a pretzel bun.',
              categoryId: tmpId('cat-burgers'),
              imageIds: imgIds('classic-burger'),
              modifierListInfo: [
                { modifierListId: tmpId('ml-extras'), enabled: true },
                { modifierListId: tmpId('ml-bun'), enabled: true },
              ],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-mushroom-single'),
                  itemVariationData: {
                    name: 'Single',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(1699), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-mushroom-double'),
                  itemVariationData: {
                    name: 'Double',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(2099), currency: 'USD' },
                  },
                },
              ],
            },
          },

          // ── Drinks ────────────────────────────────────────────────────────
          {
            type: 'ITEM',
            id: tmpId('item-cola'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Classic Cola',
              description: 'Ice-cold Coca-Cola served fountain style over crushed ice.',
              categoryId: tmpId('cat-drinks'),
              imageIds: imgIds('cola'),
              modifierListInfo: [{ modifierListId: tmpId('ml-drink-size'), enabled: true }],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-cola'),
                  itemVariationData: {
                    name: 'Regular',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(299), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-lemonade'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Fresh-Squeezed Lemonade',
              description:
                'Made daily from real lemons with cane sugar. Ask about our seasonal flavors.',
              categoryId: tmpId('cat-drinks'),
              imageIds: imgIds('lemonade'),
              modifierListInfo: [{ modifierListId: tmpId('ml-drink-size'), enabled: true }],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-lemonade'),
                  itemVariationData: {
                    name: 'Regular',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(349), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-milkshake'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Hand-Spun Milkshake',
              description:
                'Thick, creamy milkshake made with premium ice cream. Vanilla, Chocolate, or Strawberry.',
              categoryId: tmpId('cat-drinks'),
              imageIds: imgIds('milkshake'),
              modifierListInfo: [],
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-shake-vanilla'),
                  itemVariationData: {
                    name: 'Vanilla',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(699), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-shake-chocolate'),
                  itemVariationData: {
                    name: 'Chocolate',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(699), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-shake-strawberry'),
                  itemVariationData: {
                    name: 'Strawberry',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(699), currency: 'USD' },
                  },
                },
              ],
            },
          },

          // ── Sides ─────────────────────────────────────────────────────────
          {
            type: 'ITEM',
            id: tmpId('item-fries'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Crispy Shoestring Fries',
              description:
                'Double-fried shoestring fries seasoned with smoked sea salt and fresh herbs.',
              categoryId: tmpId('cat-sides'),
              imageIds: imgIds('fries'),
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-fries-sm'),
                  itemVariationData: {
                    name: 'Small',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(399), currency: 'USD' },
                  },
                },
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-fries-lg'),
                  itemVariationData: {
                    name: 'Large',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(549), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-onion-rings'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Beer-Battered Onion Rings',
              description:
                'Thick-cut Vidalia onion rings in a light craft beer batter, served with house ranch.',
              categoryId: tmpId('cat-sides'),
              imageIds: imgIds('onion-rings'),
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-rings'),
                  itemVariationData: {
                    name: 'Regular',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(499), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-mac-cheese'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Truffle Mac & Cheese',
              description:
                'Creamy four-cheese sauce, cavatappi pasta, truffle oil, and toasted breadcrumbs.',
              categoryId: tmpId('cat-sides'),
              imageIds: imgIds('fries'),
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-mac'),
                  itemVariationData: {
                    name: 'Regular',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(599), currency: 'USD' },
                  },
                },
              ],
            },
          },

          // ── Desserts ──────────────────────────────────────────────────────
          {
            type: 'ITEM',
            id: tmpId('item-brownie'),
            presentAtAllLocations: true,
            itemData: {
              name: 'Warm Chocolate Brownie',
              description:
                'Fudgy chocolate brownie served warm with a scoop of vanilla ice cream and caramel drizzle.',
              categoryId: tmpId('cat-desserts'),
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-brownie'),
                  itemVariationData: {
                    name: 'Regular',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(749), currency: 'USD' },
                  },
                },
              ],
            },
          },
          {
            type: 'ITEM',
            id: tmpId('item-cheesecake'),
            presentAtAllLocations: true,
            itemData: {
              name: 'New York Cheesecake',
              description:
                'Classic New York-style cheesecake on a graham cracker crust, topped with fresh berry compote.',
              categoryId: tmpId('cat-desserts'),
              variations: [
                {
                  type: 'ITEM_VARIATION',
                  id: tmpId('var-cheesecake'),
                  itemVariationData: {
                    name: 'Slice',
                    pricingType: 'FIXED_PRICING',
                    priceMoney: { amount: BigInt(849), currency: 'USD' },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  if (resp.errors?.length) {
    console.error('Batch upsert errors:', JSON.stringify(resp.errors, null, 2));
    process.exit(1);
  }

  const mappings = resp.idMappings ?? [];
  console.log(`     Created ${mappings.length} catalog objects.`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n── Catalog Summary ──────────────────────────────────────────');
  let page = await client.catalog.list({ types: 'ITEM,CATEGORY,MODIFIER_LIST,IMAGE' });
  const all = [];
  while (true) {
    all.push(...page.data);
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }

  const byType = {};
  for (const o of all) byType[o.type] = (byType[o.type] ?? 0) + 1;
  Object.entries(byType).forEach(([t, n]) => console.log(`  ${t.padEnd(16)} ${n}`));

  const items = all.filter((o) => o.type === 'ITEM');
  console.log('\n── Items ─────────────────────────────────────────────────────');
  for (const item of items) {
    const d = item.itemData;
    const hasImg = d?.imageIds?.length ? '🖼' : '  ';
    const vars = d?.variations?.length ?? 0;
    console.log(`  ${hasImg}  ${d?.name?.padEnd(30)} ${vars} variation(s)`);
  }

  console.log('\n✓  Seed complete. Sandbox is ready.');
}

seed().catch((err) => {
  console.error('\nSeed failed:', err.message ?? err);
  process.exit(1);
});
