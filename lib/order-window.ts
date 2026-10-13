import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { acceptsOrders } from "@/lib/order-rules";
export async function getCurrentOrderWindow(tx:Prisma.TransactionClient=prisma){
 const now=new Date();const windows=await tx.orderWindow.findMany({where:{manualClosed:false},orderBy:{opensAt:'asc'},include:{orders:{where:{status:{not:'CANCELLED'}},select:{id:true}}}});
 return {openWindow:windows.find(w=>acceptsOrders(w,w.orders.length,now)),nextWindow:windows.find(w=>w.opensAt>now)};
}
export async function isOrderingOpen(){return Boolean((await getCurrentOrderWindow()).openWindow);}
