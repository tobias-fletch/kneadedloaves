import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readJson,rateLimit } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { validCheckoutKey,checkoutRequestHash,checkoutOwners,receiptForOwnedAttempt,lockCheckoutRequest } from "@/lib/checkout-recovery";
import { getAppConfigValues } from "@/lib/app-config";
export async function POST(request:Request){
 if(!await rateLimit(request,'checkout-recovery',30))return NextResponse.json({error:'Please wait before trying again.'},{status:429});
 const body=await readJson(request);const key=typeof body?.idempotencyKey==='string'?body.idempotencyKey:'';if(!validCheckoutKey(key))return NextResponse.json({error:'No saved order found.'},{status:404});
 try{const session=await getSession(true),guest=(await cookies()).get('bakery_cart')?.value,owners=checkoutOwners(session?.sub,guest);if(!owners.length)return NextResponse.json({error:'No saved order found.'},{status:404});
 const hash=checkoutRequestHash(key),result=await prisma.$transaction(async tx=>{await lockCheckoutRequest(tx,key);await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${'manual-payment-config'}))`;const o=await tx.order.findUnique({where:{checkoutRequestHash:hash}});if(!o)return null;const config=await getAppConfigValues(["JWT_SECRET"],tx);return receiptForOwnedAttempt(tx,o,key,owners,config.JWT_SECRET);});
 return NextResponse.json(result||{error:'No saved order found.'},{status:result?200:404,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Recovery is temporarily unavailable. Retry before creating another order.'},{status:503});}
}
