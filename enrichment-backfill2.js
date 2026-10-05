import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const ROOT_BATCH = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrichment_runs(
      id BIGSERIAL PRIMARY KEY,status TEXT NOT NULL,model TEXT,total INT NOT NULL DEFAULT 0,
      processed INT NOT NULL DEFAULT 0,accepted INT NOT NULL DEFAULT 0,filtered INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),finished_at TIMESTAMPTZ,last_error TEXT
    );
    ALTER TABLE learning_items ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
  `);
}

async function writeStatus(extra={}){
  const latest=(await pool.query(`SELECT * FROM enrichment_runs ORDER BY id DESC LIMIT 1`)).rows[0]||null;
  const catalog=(await pool.query(`SELECT
    COUNT(*) FILTER(WHERE source='youtube_feed')::int feed,
    COUNT(*) FILTER(WHERE source='youtube_feed' AND enriched_at IS NOT NULL)::int enriched,
    COUNT(*) FILTER(WHERE source='youtube_feed' AND enriched_at IS NULL)::int pending,
    COUNT(*) FILTER(WHERE source='youtube_feed' AND recommendable=TRUE)::int recommendable,
    COUNT(*) FILTER(WHERE source='youtube_feed' AND recommendable=FALSE)::int filtered
    FROM learning_items`)).rows[0];
  const payload={ok:true,aiConfigured:Boolean(process.env.DEEPSEEK_API_KEY),model:process.env.DEEPSEEK_API_KEY?MODEL:null,run:latest,catalog,...extra};
  await fs.writeFile(path.join(__dirname,'public','enrichment-status.json'),JSON.stringify(payload,null,2));
}

function parseModelJSON(raw=''){
  let s=String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const start=s.indexOf('{'),end=s.lastIndexOf('}');
  if(start>=0&&end>start)s=s.slice(start,end+1);
  return JSON.parse(s);
}

function normalize(x){
  const score=Math.max(0,Math.min(100,Number(x?.score)||0));
  return {
    score,
    recommendable:Boolean(x?.recommendable)&&score>=55,
    type:String(x?.contentType||'other').slice(0,40),
    difficulty:Math.max(1,Math.min(5,Number(x?.difficulty)||2)),
    summary:String(x?.summary||'').replace(/\s+/g,' ').trim().slice(0,300),
    reason:String(x?.reason||'').replace(/\s+/g,' ').trim().slice(0,220),
    tags:Array.isArray(x?.tags)?x.tags.filter(t=>typeof t==='string').slice(0,6):[]
  };
}

async function modelCall(videos){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),16000);
  try{
    const r=await fetch('https://api.deepseek.com/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`},
      body:JSON.stringify({
        model:MODEL,temperature:0.1,max_tokens:Math.max(550,videos.length*320),
        messages:[
          {role:'system',content:'Curate YouTube videos for a nightly learning app. Filter Shorts, promos, trailers, routine announcements, shallow clickbait and low-substance uploads. Reward substantial explainers, documentaries, engineering, science, economics, systems, history, current-tech analysis and serious interviews. Return compact valid JSON only: {"videos":[{"id":"same id","score":0,"recommendable":true,"contentType":"explainer|documentary|news|interview|short|promo|livestream|other","difficulty":1,"summary":"short sentence","reason":"short reason","tags":["tag"]}]}. Include each supplied id exactly once. Score 0-100; normally recommendable only if >=55.'},
          {role:'user',content:JSON.stringify(videos)}
        ]
      }),signal:controller.signal
    });
    if(!r.ok)throw new Error(`DeepSeek HTTP ${r.status}`);
    const data=await r.json();
    const content=data?.choices?.[0]?.message?.content;
    if(!content)throw new Error('DeepSeek returned no content');
    const parsed=parseModelJSON(content);
    if(!Array.isArray(parsed?.videos))throw new Error('DeepSeek JSON missing videos');
    return parsed.videos;
  }finally{clearTimeout(timer);}
}

async function scoreBatch(batch,depth=0){
  const input=batch.map(v=>({id:v.youtube_video_id,title:v.title,description:v.description,channel:v.channel,topic:v.topic}));
  try{
    const result=await modelCall(input);
    const map=new Map(result.map(x=>[String(x.id),x]));
    if(batch.some(v=>!map.has(String(v.youtube_video_id))))throw new Error('DeepSeek omitted ids');
    return batch.map(v=>({video:v,raw:map.get(String(v.youtube_video_id)),error:null}));
  }catch(e){
    if(batch.length>1){
      const mid=Math.ceil(batch.length/2);
      console.warn(`[enrich] split depth ${depth}: ${batch.length} videos after ${e.message}`);
      await sleep(250);
      const a=await scoreBatch(batch.slice(0,mid),depth+1);
      const b=await scoreBatch(batch.slice(mid),depth+1);
      return [...a,...b];
    }
    for(let retry=1;retry<=2;retry++){
      try{await sleep(400*retry);const result=await modelCall(input);const found=result.find(x=>String(x.id)===String(batch[0].youtube_video_id));if(found)return[{video:batch[0],raw:found,error:null}];}catch(err){e=err;}
    }
    return[{video:batch[0],raw:null,error:e.message}];
  }
}

async function run(){
  await ensureSchema();
  if(!process.env.DEEPSEEK_API_KEY){console.warn('[enrich] DeepSeek key missing');await writeStatus({message:'DeepSeek key missing'});return;}
  const pending=(await pool.query(`SELECT i.id,i.youtube_video_id,i.title,i.description,i.topic,c.name channel FROM learning_items i JOIN channels c ON c.id=i.channel_id WHERE i.source='youtube_feed' AND i.youtube_video_id IS NOT NULL AND i.enriched_at IS NULL ORDER BY i.published_at DESC NULLS LAST,i.id DESC`)).rows;
  const run=(await pool.query(`INSERT INTO enrichment_runs(status,model,total) VALUES('running',$1,$2) RETURNING id`,[MODEL,pending.length])).rows[0];
  let processed=0,accepted=0,filtered=0,failed=0,lastError=null;
  console.log(`[enrich] run ${run.id} started; ${pending.length} pending videos`);await writeStatus();

  for(let offset=0;offset<pending.length;offset+=ROOT_BATCH){
    const batch=pending.slice(offset,offset+ROOT_BATCH);
    const outcomes=await scoreBatch(batch);
    for(const o of outcomes){
      if(o.error){failed++;lastError=o.error;await pool.query(`UPDATE learning_items SET enrichment_error=$2 WHERE id=$1`,[o.video.id,String(o.error).slice(0,250)]);continue;}
      const e=normalize(o.raw);
      await pool.query(`UPDATE learning_items SET quality_score=$2,recommendable=$3,content_type=$4,difficulty=$5,ai_summary=$6,ai_reason=$7,tags=$8::jsonb,enriched_at=NOW(),enrichment_error=NULL,description=CASE WHEN $6<>'' THEN $6 ELSE description END WHERE id=$1`,[o.video.id,e.score,e.recommendable,e.type,e.difficulty,e.summary,e.reason,JSON.stringify(e.tags)]);
      processed++;if(e.recommendable)accepted++;else filtered++;
    }
    await pool.query(`UPDATE enrichment_runs SET processed=$2,accepted=$3,filtered=$4,failed=$5,last_error=$6,updated_at=NOW() WHERE id=$1`,[run.id,processed,accepted,filtered,failed,lastError]);
    console.log(`[enrich] run ${run.id}: ${Math.min(offset+ROOT_BATCH,pending.length)}/${pending.length} attempted; ${processed} processed; ${accepted} accepted; ${filtered} filtered; ${failed} failed`);
    await writeStatus();await sleep(120);
  }
  const status=failed===pending.length&&pending.length?'failed':'completed';
  await pool.query(`UPDATE enrichment_runs SET status=$2,processed=$3,accepted=$4,filtered=$5,failed=$6,last_error=$7,updated_at=NOW(),finished_at=NOW() WHERE id=$1`,[run.id,status,processed,accepted,filtered,failed,lastError]);
  console.log(`[enrich] run ${run.id} ${status}: ${processed}/${pending.length} processed; ${accepted} accepted; ${filtered} filtered; ${failed} failed`);await writeStatus();
}

run().catch(async e=>{console.error(`[enrich] fatal: ${e.stack||e.message}`);try{await writeStatus({fatal:e.message});}catch{}}).finally(async()=>{await pool.end().catch(()=>{});});
