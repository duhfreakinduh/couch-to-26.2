"use strict";

/* Stride FW AI Coach
   Uses local activity history + Hugging Face semantic intent matching.
   It does not diagnose injuries or replace the existing training-plan safety rules.
*/

(() => {
  const HF_IMPORT = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  const MODEL_CANDIDATES = ['Xenova/bge-small-en-v1.5', 'Xenova/all-MiniLM-L6-v2'];
  const INTENTS = [
    { id:'recovery', title:'Recovery / very easy day', text:'recovery tired sore hard workout yesterday rest easy walk low intensity exhausted fatigue' },
    { id:'easy', title:'Easy aerobic session', text:'easy run comfortable aerobic base conversational pace simple workout today' },
    { id:'long', title:'Long endurance session', text:'long run long walk endurance distance marathon build weekly long day stamina' },
    { id:'runwalk', title:'Run / walk progression', text:'beginner run walk couch to running intervals build slowly start running' },
    { id:'speed', title:'Faster controlled intervals', text:'speed faster pace intervals tempo improve pace quick workout race speed' },
    { id:'strength', title:'Bodyweight strength', text:'strength bodyweight squats pushups core legs cross training workout no run' },
    { id:'walk', title:'Walking day', text:'walk walking low impact steps family walk active recovery easy' },
    { id:'consistency', title:'Consistency / restart', text:'missed workouts restart fell off plan consistency motivation get back on track busy' }
  ];

  let embedder = null;
  let intentVectors = null;
  let loading = null;
  let activeModel = null;

  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function installUI() {
    if (document.querySelector('#strideAiCoach')) return;
    const screen = document.querySelector('#screen-plans');
    const anchor = screen?.querySelector('.planSafety');
    if (!screen || !anchor) return;
    const panel = document.createElement('div');
    panel.id = 'strideAiCoach';
    panel.className = 'panel strideAiCoach';
    panel.innerHTML = `
      <div class="strideAiHead"><div><span>HUGGING FACE • LOCAL HISTORY</span><h3>Ask Stride AI Coach</h3></div><b id="strideAiHistory">0 activities</b></div>
      <p class="hint">Ask what kind of training makes sense today. The coach reads only the activity history stored in this browser and uses the existing safety-first plans.</p>
      <div class="strideAiInput"><textarea id="strideAiQuestion" rows="3" maxlength="320" placeholder="Examples: What should I do today? • I ran yesterday and feel tired • Help me build my long run without jumping too fast"></textarea><button id="strideAiAsk" class="btn primary" type="button">✨ Coach me</button></div>
      <div id="strideAiStatus" class="hint">AI loads only when you ask.</div>
      <div id="strideAiAnswer" class="strideAiAnswer hidden"></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    document.querySelector('#strideAiAsk')?.addEventListener('click', runCoach);
    refreshCount();
  }

  function activityHistory() {
    const rows = (typeof activities !== 'undefined' && Array.isArray(activities)) ? activities : [];
    return [...rows].filter(a => a && a.date).sort((a,b) => new Date(b.date) - new Date(a.date));
  }

  function refreshCount() {
    const el = document.querySelector('#strideAiHistory');
    if (el) el.textContent = `${activityHistory().length} activit${activityHistory().length === 1 ? 'y' : 'ies'}`;
  }

  function daysAgo(date) { return (Date.now() - new Date(date).getTime()) / 86400000; }
  function milesOf(rows) { return rows.reduce((sum,a) => sum + (Number(a.distanceMiles) || 0), 0); }
  function fmtMiles(n) { return `${Math.max(0,n).toFixed(n < 10 ? 1 : 0)} mi`; }
  function fmtPace(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2,'0')}/mi`;
  }

  function snapshot() {
    const history = activityHistory();
    const recent7 = history.filter(a => daysAgo(a.date) <= 7);
    const prior7 = history.filter(a => daysAgo(a.date) > 7 && daysAgo(a.date) <= 14);
    const runs7 = recent7.filter(a => a.type === 'Run');
    const runHistory = history.filter(a => a.type === 'Run');
    const last = history[0] || null;
    const lastRun = runHistory[0] || null;
    const longestRecent = Math.max(0, ...history.filter(a => daysAgo(a.date) <= 42).map(a => Number(a.distanceMiles)||0));
    const recentPaces = runs7.map(a => Number(a.paceSecondsPerMile)).filter(Number.isFinite);
    const avgPace = recentPaces.length ? recentPaces.reduce((a,b)=>a+b,0)/recentPaces.length : null;
    return {
      history, recent7, prior7, runs7, last, lastRun,
      miles7:milesOf(recent7), milesPrior:milesOf(prior7),
      longestRecent, avgPace,
      hoursSinceLast:last ? Math.max(0,(Date.now()-new Date(last.date).getTime())/3600000) : Infinity
    };
  }

  async function ensureEmbedder(status) {
    if (embedder && intentVectors) return embedder;
    if (loading) return loading;
    loading = (async()=>{
      status.textContent='Loading lightweight Hugging Face coach…';
      const { pipeline, env } = await import(HF_IMPORT);
      if (env) {
        env.allowLocalModels=false; env.useBrowserCache=true;
        if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads=1;
      }
      let lastError=null;
      for (const model of MODEL_CANDIDATES) {
        try {
          const pipe=await pipeline('feature-extraction',model,{dtype:'q8'});
          const out=await pipe(INTENTS.map(i=>`${i.title}. ${i.text}`),{pooling:'mean',normalize:true});
          embedder=pipe; intentVectors=out.tolist(); activeModel=model; return pipe;
        } catch(error) { lastError=error; embedder=null; intentVectors=null; }
      }
      throw lastError || new Error('Coach model unavailable');
    })().finally(()=>{loading=null;});
    return loading;
  }

  function dot(a,b){let s=0;for(let i=0;i<Math.min(a.length,b.length);i++)s+=a[i]*b[i];return s;}

  async function semanticIntent(query,status){
    const pipe=await ensureEmbedder(status);
    const q=await pipe(query,{pooling:'mean',normalize:true});
    const v=q.tolist()[0];
    return INTENTS.map((intent,i)=>({intent,score:dot(v,intentVectors[i])})).sort((a,b)=>b.score-a.score)[0];
  }

  function lexicalIntent(query){
    const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
    return INTENTS.map(intent=>{const hay=`${intent.title} ${intent.text}`.toLowerCase();return{intent,score:terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0)/Math.max(1,terms.length)}}).sort((a,b)=>b.score-a.score)[0];
  }

  function chooseRecommendation(intent, s) {
    // History safeguards override a fuzzy AI intent when the local data clearly says “easy”.
    const sharpJump = s.milesPrior > 0 && s.miles7 > s.milesPrior * 1.35;
    if (s.last && s.hoursSinceLast < 18 && Number(s.last.distanceMiles || 0) >= 3) intent = INTENTS.find(i=>i.id==='recovery');
    if (sharpJump && ['long','speed'].includes(intent.id)) intent = INTENTS.find(i=>i.id==='easy');

    const baseLong = s.longestRecent > 0 ? Math.max(1.5, s.longestRecent) : 2;
    const longTarget = Math.min(baseLong + 0.5, baseLong * 1.10 + 0.15);
    const plans = {
      recovery:{title:'Keep today deliberately easy',session:'20–40 minutes of easy walking, plus optional light mobility. No pace target.',why:'Recovery protects consistency after recent work and gives the next quality session a better chance.',filter:'walk'},
      easy:{title:'Build the aerobic base',session:`25–40 minutes easy. Keep it conversational; recent run pace is ${fmtPace(s.avgPace)}, but today does not need to match it.`,why:'Easy volume is useful without turning every day into a test.',filter:'run'},
      long:{title:'Long-session progression',session:`If you feel normal and your schedule supports it, keep the next long session around ${fmtMiles(longTarget)} rather than making a huge jump. Use run/walk as needed.`,why:`Your longest saved activity in the last 6 weeks is ${fmtMiles(s.longestRecent)}. The suggestion intentionally caps the jump.`,filter:'run'},
      runwalk:{title:'Use run/walk on purpose',session:'25–35 minutes alternating comfortable running and walking. Finish feeling like you could do a little more.',why:'Run/walk builds time on feet while keeping the session controllable.',filter:'run'},
      speed:{title:'Controlled faster work, not an all-out test',session:'Warm up easy, then 4–6 short controlled faster efforts with easy recovery between them; cool down easy.',why:'A small dose of quality is enough. Skip it when recovery or recent volume says otherwise.',filter:'run'},
      strength:{title:'Use a bodyweight support day',session:'Choose one of the built-in bodyweight sessions and keep every rep clean and controlled.',why:'Strength supports the running plan without needing another hard mileage day.',filter:'workout'},
      walk:{title:'Make walking count',session:'30–45 minutes at a purposeful but comfortable pace. Use hills only if they feel routine.',why:'Walking adds aerobic work with less impact and is a solid consistency tool.',filter:'walk'},
      consistency:{title:'Restart smaller than your motivation wants',session:'Pick the easiest built-in session you can complete cleanly today, then schedule the next one before you finish.',why:'The goal is to rebuild the streak, not repay missed workouts in one day.',filter:'all'}
    };
    return { intent, ...(plans[intent.id] || plans.easy), sharpJump };
  }

  function renderAnswer(question, match, s, mode) {
    const rec=chooseRecommendation(match.intent,s);
    const lastText=s.last ? `${s.last.type} ${fmtMiles(Number(s.last.distanceMiles)||0)} • ${Math.round(s.hoursSinceLast)}h ago` : 'No saved activity yet';
    const volumeChange=s.milesPrior>0 ? `${Math.round((s.miles7/s.milesPrior-1)*100)}% vs prior 7 days` : 'not enough prior-week data';
    return `<div class="strideAiRec"><div class="strideAiRecTop"><span>${esc(rec.intent.title)}</span><b>${esc(mode)}</b></div><h3>${esc(rec.title)}</h3><p><strong>Session:</strong> ${esc(rec.session)}</p><p><strong>Why:</strong> ${esc(rec.why)}</p><div class="strideAiFacts"><span>Last: ${esc(lastText)}</span><span>7-day volume: ${esc(fmtMiles(s.miles7))}</span><span>Trend: ${esc(volumeChange)}</span><span>Runs this week: ${s.runs7.length}</span></div>${rec.sharpJump?'<div class="strideAiCaution">Your saved 7-day volume is more than 35% above the previous 7 days, so the coach automatically backed away from a hard/long recommendation.</div>':''}<button class="btn secondary" id="strideAiShowPlan" type="button">Show matching built-in plans</button><small>General training guidance only. Stop or modify exercise for pain, dizziness, chest pain, or unusual shortness of breath.</small></div>`;
  }

  async function runCoach(){
    const question=String(document.querySelector('#strideAiQuestion')?.value||'').trim();
    const status=document.querySelector('#strideAiStatus');
    const answer=document.querySelector('#strideAiAnswer');
    const button=document.querySelector('#strideAiAsk');
    if(question.length<3){status.textContent='Ask what you want to do today or what you are trying to improve.';return;}
    const s=snapshot(); button.disabled=true; answer.classList.add('hidden');
    let match,mode='AI semantic intent';
    try { match=await semanticIntent(question,status); status.textContent=`AI ready • ${activeModel} • grounded in ${s.history.length} saved activities`; }
    catch(error){console.warn('Stride AI fallback',error);match=lexicalIntent(question);mode='Offline smart fallback';status.textContent='Hugging Face AI could not load, so Stride used the same history-aware rules with keyword matching.';}
    finally{button.disabled=false;}
    answer.innerHTML=renderAnswer(question,match,s,mode); answer.classList.remove('hidden'); refreshCount();
    document.querySelector('#strideAiShowPlan')?.addEventListener('click',()=>{
      const rec=chooseRecommendation(match.intent,s);
      const target=[...document.querySelectorAll('.planFilter')].find(btn=>btn.dataset.filter===rec.filter) || document.querySelector('.planFilter[data-filter="all"]');
      target?.click(); document.querySelector('#trainingList')?.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUI,{once:true});else installUI();
})();
