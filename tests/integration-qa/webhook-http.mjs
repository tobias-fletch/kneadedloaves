import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertIntegrationDatabase } from './guard.mjs';
assertIntegrationDatabase();
const base=process.env.TEST_APP_URL || process.env.APP_URL || 'http://127.0.0.1:3001';
const secret=process.env.STRIPE_WEBHOOK_SECRET;
if (secret !== 'whsec_synthetic_bakery_qa_only') throw Error('Use the documented synthetic webhook fixture.');
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw Error('HTTP QA requires a loopback test app.');
async function req(body,signature,path='/api/payments/stripe/webhook'){return fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(signature?{'stripe-signature':signature}:{})},body});}
function sign(body,t=Math.floor(Date.now()/1000)){return `t=${t},v1=${crypto.createHmac('sha256',secret).update(`${t}.${body}`).digest('hex')}`;}
(async()=>{
 const body=JSON.stringify({id:'evtSyntheticIgnored',object:'event',type:'qa.unsupported',livemode:false,data:{object:{id:'qa'}}});
 assert.equal((await req(body)).status,400);
 assert.equal((await req(body,sign(body)+'bad')).status,400);
 assert.equal((await req(body+' ',sign(body))).status,400);
 assert.equal((await req(body,sign(body,1))).status,400);
 const live=JSON.stringify({id:'evtSyntheticMode',object:'event',type:'qa.unsupported',livemode:true,data:{object:{id:'qa'}}});assert.equal((await req(live,sign(live))).status,400);
 assert.equal((await req(body,sign(body))).status,200);
 assert.equal((await req(JSON.stringify({id:'evtSyntheticPP',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'Synthetic'}}),null,'/api/payments/paypal/webhook')).status,400);
 console.log('PASS: Stripe HTTP webhook rejects missing/tampered/stale/mode-mismatched signatures and accepts valid synthetic HMAC; PayPal unsigned webhook rejected. No provider network calls.');
})().catch(e=>{console.error(e);process.exitCode=1});
