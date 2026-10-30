import assert from 'node:assert/strict';
import test from 'node:test';
import { destinationFingerprint,paymentReadiness,validVenmoDestination,withEmailStatus } from '../lib/manual-payment-config';
const values={VENMO_CHECKOUT_ENABLED:'true',VENMO_HANDLE:'@kneadedloaves',VENMO_DESTINATION:'https://www.venmo.com/u/kneadedloaves',VENMO_DESTINATION_VERIFIED:'true',VENMO_VERIFIED_FINGERPRINT:'',PAYMENT_HOLD_MINUTES:'30',PAYMENT_WORKERS_READY:'true',CHECKOUT_SMOKE_TESTED:'true',RESEND_CONFIGURED:'true',JWT_SECRET:'test-only-long-random-fixture-secret-2026',APP_URL:'https://shop.example.test'};values.VENMO_VERIFIED_FINGERPRINT=destinationFingerprint(values.VENMO_HANDLE,values.VENMO_DESTINATION);
test('manual checkout is default off and requires every operational gate',()=>{assert.equal(paymentReadiness({}).ready,false);assert.equal(paymentReadiness(values).ready,true);for(const key of Object.keys(values))assert.equal(paymentReadiness({...values,[key]:''}).ready,false,key);});
test('copied official www Venmo destination accepted without fabrication',()=>{assert.equal(validVenmoDestination(values.VENMO_DESTINATION),true);for(const url of ['https://venmo.com.evil.test/u/a','https://evil.test/venmo.com','http://venmo.com/u/a','https://user@venmo.com/u/a','https://venmo.com:444/u/a','https://venmo.com/'])assert.equal(validVenmoDestination(url),false,url);});
test('changed receiving destination invalidates old attestation',()=>assert.equal(paymentReadiness({...values,VENMO_DESTINATION:'https://venmo.com/u/another'}).ready,false));
test('no invented or invalid hold deadline',()=>{for(const value of ['0','-1','1.5','Infinity','10081'])assert.equal(paymentReadiness({...values,PAYMENT_HOLD_MINUTES:value}).ready,false);});

test('launch release removed the production hard-stop; operational gates still apply',()=>{const env=process.env as Record<string,string|undefined>;const previous=env.NODE_ENV;try{env.NODE_ENV='production';const ready=paymentReadiness(values);assert.equal(ready.ready,true);assert.ok(!ready.reasons.some(reason=>reason.includes('paused for this release')));assert.equal(paymentReadiness({...values,PAYMENT_WORKERS_READY:''}).ready,false);}finally{if(previous===undefined)delete env.NODE_ENV;else env.NODE_ENV=previous;}});

test('checkout email readiness is RESEND_API_KEY only; old Gmail SMTP values do not count',()=>{
  const noEmail={...values,RESEND_CONFIGURED:''};
  const blocked=paymentReadiness({...noEmail,SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'465',SMTP_USER:'kneadedloaves@gmail.com',SMTP_PASSWORD:'old',EMAIL_FROM:'kneadedloaves@gmail.com'} as typeof values);
  assert.equal(blocked.ready,false);
  assert.ok(blocked.reasons.some(reason=>/Resend/.test(reason)&&/RESEND_API_KEY/.test(reason)));
  assert.ok(!blocked.reasons.some(reason=>/SMTP|Gmail/.test(reason)));
  assert.equal(withEmailStatus({},{RESEND_API_KEY:'re_x'}).RESEND_CONFIGURED,'true');
  assert.equal(withEmailStatus({},{SMTP_PASSWORD:'old'}).RESEND_CONFIGURED,'');
});
