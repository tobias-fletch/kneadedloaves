import assert from 'node:assert/strict';
import { assertIntegrationDatabase } from './guard.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const qaDir=process.env.QA_DIR || dirname(fileURLToPath(import.meta.url));
assertIntegrationDatabase();
const tables = ['User','CustomerProfile','Product','ProductImage','Cart','CartItem','Order','OrderItem','AppConfig','EmailJob'];
async function main(){
 if(process.argv[2]==='seed'){
  await db.$executeRawUnsafe(`INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ('legacy-user','legacy@example.invalid','Legacy Customer','qa-not-a-real-password',now())`);
  await db.$executeRawUnsafe(`INSERT INTO "CustomerProfile" (id,"userId",phone,notes,"updatedAt") VALUES ('legacy-profile','legacy-user','TEST','Keep this note',now())`);
  await db.$executeRawUnsafe(`INSERT INTO "Product" (id,name,slug,description,"priceCents",allergens,ingredients,"inventoryLimit","updatedAt") VALUES ('legacy-product','Legacy Loaf','legacy-loaf','Keep menu unchanged',1275,ARRAY['wheat'],ARRAY['flour'],17,now())`);
  await db.$executeRawUnsafe(`INSERT INTO "ProductImage" (id,"productId",url,alt) VALUES ('legacy-image','legacy-product','/uploads/legacy.jpg','Keep photo')`);
  await db.$executeRawUnsafe(`INSERT INTO "Cart" (id,"userId","updatedAt") VALUES ('legacy-cart','legacy-user',now())`);
  await db.$executeRawUnsafe(`INSERT INTO "CartItem" (id,"cartId","productId",quantity,"updatedAt") VALUES ('legacy-cart-item','legacy-cart','legacy-product',2,now())`);
  for(const status of ['PENDING','PAID','PREPARING','READY','OUT_FOR_DELIVERY','COMPLETED','CANCELLED']){
   await db.$executeRawUnsafe(`INSERT INTO "Order" (id,"customerEmail","customerName",status,"totalCents","fulfillmentType","userId","stripeCheckoutSessionId","updatedAt") VALUES ('legacy-${status}','legacy@example.invalid','Legacy Customer','${status}',2550,'PICKUP','legacy-user','cs_legacy_${status}',now())`);
   await db.$executeRawUnsafe(`INSERT INTO "OrderItem" (id,"orderId","productId",quantity,"unitPriceCents","productName") VALUES ('legacy-item-${status}','legacy-${status}','legacy-product',2,1275,'Legacy Loaf')`);
  }
  await db.$executeRawUnsafe(`INSERT INTO "AppConfig" (key,value,secret,"updatedAt") VALUES ('TEST_PRESERVE','enc:v1:dummy-fixture-only',true,now())`);
  await db.$executeRawUnsafe(`INSERT INTO "EmailJob" (id,"dedupeKey","to",subject,body) VALUES ('legacy-email','legacy-email','legacy@example.invalid','Legacy subject','Keep body')`);
  const snapshot={}; for(const table of tables) snapshot[table]=await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY 1`);
  fs.writeFileSync(qaDir+'/legacy-snapshot.json',JSON.stringify(snapshot,null,2));
  console.log('PASS: seeded representative legacy users, profile, product/photo, cart, all seven order statuses/items, config, and email queue.');
 }else{
  const snapshot=JSON.parse(fs.readFileSync(qaDir+'/legacy-snapshot.json','utf8'));
  for(const table of tables){
   const after=await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY 1`);
   for(const {row:old} of snapshot[table]){
    const now=after.find(({row})=>row.id===old.id && row.key===old.key)?.row;
    assert.ok(now,`Missing row ${table} ${old.id||old.key}`);
    for(const key of Object.keys(old)) assert.deepEqual(now[key],old[key],`${table} ${old.id||old.key} ${key} changed`);
    if(table==='Order') assert.equal(now.paymentState,['PENDING','CANCELLED'].includes(old.status)?'PENDING':'REVIEW');
   }
  }
  console.log('PASS: migration preserved every legacy column/value across 10 tables, seven order states, all relations/photos/settings; legacy operational orders are REVIEW.');
 }
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
