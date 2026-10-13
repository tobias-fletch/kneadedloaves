import "dotenv/config";
import { expireUnpaidOrders } from "../lib/manual-payments";
import { prisma } from "../lib/prisma";
async function main(){while(await expireUnpaidOrders()===100){} }
main().catch(()=>{console.error('Payment expiry failed.');process.exitCode=1;}).finally(()=>prisma.$disconnect());
