/** Synthetic-only product integration smoke. Uses the local app's explicitly connected funded provider. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
if (!process.argv.includes('--run-funded-provider-tests')) throw new Error('Opt in with --run-funded-provider-tests; this test makes real OpenAI requests.');
const app='http://localhost:3000', project='demo-writeoff-security';
const db=`http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents`;
const resume=process.argv.includes('--resume-handoff');
const evidence=resume?JSON.parse(await fs.readFile('/tmp/writeoff-product-smoke.json','utf8')):{ checkedAt:new Date().toISOString(), project, assertions:[], responses:[] };
delete evidence.error;
function encode(v) { if(v===null)return {nullValue:null}; if(typeof v==='string')return {stringValue:v}; if(typeof v==='boolean')return {booleanValue:v}; if(typeof v==='number')return {doubleValue:v}; if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}; }
function decode(v) { if('nullValue'in v)return null;if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);return v.stringValue??v.booleanValue??v.doubleValue??v.timestampValue??Number(v.integerValue); }
async function write(path,data) {const response=await fetch(`${db}/${path}`,{method:'PATCH',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encode(v)]))})});assert.equal(response.status,200);await response.arrayBuffer();}
async function read(path) {const r=await fetch(`${db}/${path}`,{headers:{authorization:'Bearer owner'}});assert.equal(r.status,200);return decode({mapValue:{fields:(await r.json()).fields}});}
async function signIn(email) { const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'LocalDemo2026!',returnSecureToken:true})});assert.equal(r.status,200,'Demo sign-in');return r.json();}
const auth=await signIn('demo@writeoff.example');
async function api(path,body,method='POST',token=auth.idToken) {const response=await fetch(app+path,{method,headers:{authorization:`Bearer ${token}`,...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),signal:AbortSignal.timeout(110000)});return response;}
try {
 if(!resume) {
 for(const [message,title] of [
  ['Which of my transactions need review?','Your next reviews'],['Which of my purchases have no receipts attached?','Collect supporting records'],
  ['Help me prepare a package for my accountant.','Your accountant handoff'],
 ]) {
  const r=await api('/api/ai/account-assistant',{message,taxYear:2026});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.account?.title,title);
  if(title!=='Your accountant handoff')assert.ok(body.account.items.length>0,'Real owner records must not disappear');
  evidence.responses.push({case:title,success:true,items:body.account.items.length});
 }
 evidence.assertions.push('Real GPT-4o chooses owner-bound review, receipt and preparer actions; saved rows appear');
 const taxResponse=await api('/api/tax/compute-1040?year=2026',undefined,'GET');const tax=await taxResponse.json();
 for(const [message,changed]of [['What is my current estimated federal tax based on my saved records?',false],['How has my estimated tax changed since my last assistant check?',true]]) {
  const r=await api('/api/ai/account-assistant',{message,taxYear:2026});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));
  if(taxResponse.ok){assert.ok(body.account.metrics.some(m=>m.value===new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(tax.form1040.totalTax)));if(changed)assert.match(body.reply,/unchanged|first comparable/);}
  else{assert.equal(body.account.metrics.length,0);assert.ok(body.reply.includes(tax.error));}
  evidence.responses.push({case:changed?'tax changes':'tax position',success:true,calculationStatus:taxResponse.status});
 }
 evidence.assertions.push('Assistant matches the validated federal endpoint and preserves its eligibility gates');
 const legal=await api('/api/ai/account-assistant',{message:'Can I deduct lunch with a business client, and which records should I keep?',taxYear:2026});const guidance=await legal.json();assert.equal(legal.status,200,JSON.stringify(guidance));assert.ok(guidance.assessment.sources.length>0);assert.ok(guidance.assessment.sources.every(s=>/^https:\/\/(www\.irs\.gov|uscode\.house\.gov)\//.test(s.url)));
 evidence.assertions.push('Legal questions retain reviewed conditions and official sources through the new assistant gateway');
 const id=`product-smoke-${Date.now()}`, path=`user_profiles/${auth.localId}/accounts/manual/transactions/${id}`;
 await write(path,{userId:auth.localId,account_id:'manual',trans_id:id,date:'2026-09-23',iso_currency_code:'USD',amount:42.75,pending:false,merchant_name:'Office supply store',category:'OTHER',is_deductible:null,source:'plaid'});
 async function waitFor(check,label){for(let i=0;i<120;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,1000));}throw new Error(`Timed out: ${label}`);}
 const initial=await waitFor(async()=>{const row=await read(path);return row.analysis_status==='completed'&&row.ai_suggestion?row:null;},'automatic bank analysis');
 const save=await api(`/api/transactions/${id}`,{business_purpose:'Printer paper and pens used exclusively for paid client graphic-design work. No personal use or reimbursement.'},'PUT');assert.equal(save.status,200,await save.text());
 const updated=await waitFor(async()=>{const row=await read(path);return row.analysis_status==='completed'&&row.ai_suggestion?.id!==initial.ai_suggestion.id?row:null;},'automatic fact-change review');
 assert.equal(updated.is_deductible,null);assert.ok(updated.ai_suggestion.sources.length);assert.equal(updated.analysisRefreshReason,null);
 evidence.responses.push({case:'automatic transaction refresh',model:updated.ai_suggestion.model,status:updated.ai_suggestion.status,success:true});
 evidence.assertions.push('Posted bank transaction analyzed automatically; saving business purpose triggers a fresh real model response without a manual analysis request; confirmation remains user-controlled');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'synthetic-receipt.png');form.append('transactionId',id);
 const upload=await api('/api/upload-receipt',form);const receipt=await upload.json();assert.equal(upload.status,200,JSON.stringify(receipt));
 const attach=await api(`/api/transactions/${id}`,{receipt_url:receipt.receiptUrl,receipt_filename:'synthetic-receipt.png'},'PUT');assert.equal(attach.status,200);await attach.arrayBuffer();
 }
 const pack=await api('/api/reports/preparer-package',{year:2026});assert.equal(pack.status,200,await (pack.status!==200?pack.text():Promise.resolve('')));const bytes=Buffer.from(await pack.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
 const share=await api('/api/preparer-handoffs',{year:2026,expiresInDays:1,confirmSharing:true});const link=await share.json();assert.equal(share.status,201,JSON.stringify(link));
 const url=new URL(link.path,app);const fragment=new URLSearchParams(url.hash.slice(1)).get('token');const handoffId=url.pathname.split('/').at(-1);
 const download=await fetch(`${app}/api/preparer-handoffs/download`,{method:'POST',headers:{'content-type':'application/json',origin:app},body:JSON.stringify({id:handoffId,token:fragment})});assert.equal(download.status,200,await(download.status!==200?download.text():Promise.resolve('')));await download.arrayBuffer();
 const revoke=await api(`/api/preparer-handoffs/${handoffId}`,undefined,'DELETE');assert.equal(revoke.status,200);await revoke.arrayBuffer();
 const denied=await fetch(`${app}/api/preparer-handoffs/download`,{method:'POST',headers:{'content-type':'application/json',origin:app},body:JSON.stringify({id:handoffId,token:fragment})});assert.equal(denied.status,404);await denied.arrayBuffer();
 const free=await signIn('free@writeoff.example');const freeExport=await api('/api/reports/preparer-package',{year:2026},'POST',free.idToken);assert.equal(freeExport.status,403);await freeExport.arrayBuffer();
 evidence.assertions.push('Private receipt upload, selected-year ZIP, temporary immutable sharing, anonymous download, revocation and Free-plan denial work against emulators');
 evidence.success=true;
} catch(error){evidence.success=false;evidence.error=error instanceof Error?error.message:String(error);throw error;}
finally {await fs.writeFile('/tmp/writeoff-product-smoke.json',JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({success:evidence.success,assertions:evidence.assertions.length,responses:evidence.responses.length,output:'/tmp/writeoff-product-smoke.json'}));}
