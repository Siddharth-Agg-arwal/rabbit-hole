import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const BATCH_SIZE = 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrichment_runs(
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL,
      model TEXT,
      total INT NOT NULL DEFAULT 0,
      processed INT NOT NULL DEFAULT 0,
      accepted INT NOT NULL DEFAULT 0,
      filtered INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      last_error TEXT
    );
    ALTER TABLE learning_items ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
  `);
}

async function writeStatus(extra={}){
  const latest=(await pool.query(`SELECT * FROM enrichment_runs ORDER BY id DESC LIMIT 1`)).rows[0] || null;
  const counts=(await pool.query(`
    SELECT
      COUNT(*) FILTER(WHERE source='youtube_feed')::int AS feed,
      COUNT(*) FILTER(WHERE source='youtube_feed' AND enriched_at IS NOT NULL)::int AS enriched,
      COUNT(*) FILTER(WHERE source='youtube_feed' AND enriched_at IS NULL)::int AS pending,
      COUNT(*) FILTER(WHERE source='youtube_feed' AND recommendable=TRUE)::int AS recommendable,
      COUNT(*) FILTER(WHERE source='youtube_feed' AND recommendable=FALSE)::int AS filtered
    FROM learning_items
  `)).rows[0];
  const payload={ok:true,aiConfigured:Boolean(process.env.DEEPSEEK_API_KEY),model:process.env.DEEPSEEK_API_KEY?MODEL:null,run:latest,catalog:counts,...extra};
  const dir=path.join(__dirname,'public');
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'enrichment-status.json'),JSON.stringify(payload,null,2));
  return payload;
}

function normalize(x){
  const score=Math.max(0,Math.min(100,Number(x?.score)||0));
  const difficulty=Math.max(1,Math.min(5,Number(x?.difficulty)||2));
  const tags=Array.isArray(x?.tags)?x.tags.filter(t=>typeof t==='string').slice(0,8):[];
  return {
    score,
    difficulty,
    tags,
    recommendable:Boolean(x?.recommendable)&&score>=55,
    type:String(x?.contentType||'other').slice(0,40),
    summary:String(x?.summary||'').replace(/\s+/g,' ').trim().slice(0,320),
    reason:String(x?.reason||'').replace(/\s+/g,' ').trim().slice(0,240)
  };
}

async function callDeepSeek(videos, attempt=1){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch('https://api.deepseek.com/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`},
      body:JSON.stringify({
        model:MODEL,
        temperature:0.1,
        max_tokens:2200,
        response_format:{type:'json_object'},
        messages:[
          {role:'system',content:'You curate a high-quality nightly learning library. Judge each supplied YouTube video for curious adult learning. Penalize Shorts, promos, trailers, routine announcements, shallow clickbait, repetitive updates and low-substance uploads. Informative current-tech/news can score highly. Prefer explainers, documentaries, engineering breakdowns, scientific reasoning, economics, systems thinking, history and substantial interviews. Return JSON exactly as {"videos":[{"id":"youtube id","score":0,"recommendable":true,"contentType":"explainer|documentary|news|interview|short|promo|livestream|other","difficulty":1,"summary":"one useful sentence","reason":"brief curator reason","tags":["tag"]}]}. score 0-100; recommendable normally requires score >=55; difficulty 1-5. Return every supplied id exactly once and never invent ids.'},
          {role:'user',content:JSON.stringify(videos)}
        ]
      }),
      signal:controller.signal
    });
    if(!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const data=await response.json();
    const raw=data?.choices?.[0]?.message?.content;
    if(!raw) throw new Error('DeepSeek returned no content');
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed?.videos)) throw new Error('DeepSeek JSON missing videos array');
    return parsed.videos;
  }catch(e){
    if(attempt<3){
      console.warn(`[enrich] batch attempt ${attempt} failed: ${e.message}; retrying`);
      await sleep(600*attempt);
      return callDeepSeek(videos,attempt+1);
    }
    throw e;
  }finally{clearTimeout(timer);}
}

async function run(){
  await ensureSchema();
  if(!process.env.DEEPSEEK_API_KEY){
    console.warn('[enrich] DeepSeek key missing; backfill not started');
    await writeStatus({message:'DeepSeek key missing'});
    return;
  }

  const pending=(await pool.query(`
    SELECT i.id,i.youtube_video_id,i.title,i.description,i.topic,c.name AS channel
    FROM learning_items i
    JOIN channels c ON c.id=i.channel_id
    WHERE i.source='youtube_feed' AND i.youtube_video_id IS NOT NULL AND i.enriched_at IS NULL
    ORDER BY i.published_at DESC NULLS LAST,i.id DESC
  `)).rows;

  const inserted=(await pool.query(`INSERT INTO enrichment_runs(status,model,total) VALUES('running',$1,$2) RETURNING id`,[MODEL,pending.length])).rows[0];
  const runId=inserted.id;
  console.log(`[enrich] run ${runId} started; ${pending.length} pending videos`);
  await writeStatus();

  let processed=0,accepted=0,filtered=0,failed=0,lastError=null;
  for(let offset=0;offset<pending.length;offset+=BATCH_SIZE){
    const batch=pending.slice(offset,offset+BATCH_SIZE);
    try{
      const result=await callDeepSeek(batch.map(v=>({id:v.youtube_video_id,title:v.title,description:v.description,channel:v.channel,topic:v.topic})));
      const mapped=new Map(result.map(v=>[String(v.id),v]));
      for(const video of batch){
        const raw=mapped.get(String(video.youtube_video_id));
        if(!raw){
          failed++;
          await pool.query(`UPDATE learning_items SET enrichment_error=$2 WHERE id=$1`,[video.id,'AI response omitted this video']);
          continue;
        }
        const e=normalize(raw);
        await pool.query(`
          UPDATE learning_items SET
            quality_score=$2,recommendable=$3,content_type=$4,difficulty=$5,
            ai_summary=$6,ai_reason=$7,tags=$8::jsonb,enriched_at=NOW(),enrichment_error=NULL,
            description=CASE WHEN $6<>'' THEN $6 ELSE description END
          WHERE id=$1
        `,[video.id,e.score,e.recommendable,e.type,e.difficulty,e.summary,e.reason,JSON.stringify(e.tags)]);
        processed++;
        if(e.recommendable) accepted++; else filtered++;
      }
    }catch(e){
      failed+=batch.length;
      lastError=e.message;
      console.warn(`[enrich] batch ${Math.floor(offset/BATCH_SIZE)+1} failed after retries: ${e.message}`);
      const ids=batch.map(x=>x.id);
      await pool.query(`UPDATE learning_items SET enrichment_error=$2 WHERE id=ANY($1::int[])`,[ids,String(e.message).slice(0,250)]).catch(()=>{});
    }

    await pool.query(`UPDATE enrichment_runs SET processed=$2,accepted=$3,filtered=$4,failed=$5,last_error=$6,updated_at=NOW() WHERE id=$1`,[runId,processed,accepted,filtered,failed,lastError]);
    console.log(`[enrich] run ${runId}: ${Math.min(offset+BATCH_SIZE,pending.length)}/${pending.length} attempted; ${processed} processed; ${accepted} accepted; ${filtered} filtered; ${failed} failed`);
    await writeStatus();
    if(offset+BATCH_SIZE<pending.length) await sleep(150);
  }

  const status=failed>0&&processed===0?'failed':'completed';
  await pool.query(`UPDATE enrichment_runs SET status=$2,processed=$3,accepted=$4,filtered=$5,failed=$6,last_error=$7,updated_at=NOW(),finished_at=NOW() WHERE id=$1`,[runId,status,processed,accepted,filtered,failed,lastError]);
  console.log(`[enrich] run ${runId} ${status}: ${processed}/${pending.length} processed; ${accepted} accepted; ${filtered} filtered; ${failed} failed`);
  await writeStatus();
}

run().catch(async e=>{
  console.error(`[enrich] fatal: ${e.stack||e.message}`);
  try{await writeStatus({fatal:e.message});}catch{}
}).finally(async()=>{await pool.end().catch(()=>{});});
