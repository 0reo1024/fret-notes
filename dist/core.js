(function(root){
 'use strict';
 const opens=[4,11,7,2,9,4],sharp=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'],flat=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
 const key=p=>`${p.string}:${p.fret}`;
 const pitch=p=>(opens[p.string-1]+p.fret)%12;
 function name(p,notation='both'){const n=pitch(p);return notation==='flat'?flat[n]:notation==='sharp'?sharp[n]:sharp[n]===flat[n]?sharp[n]:`${sharp[n]} / ${flat[n]}`;}
 const isNatural=p=>[0,2,4,5,7,9,11].includes(pitch(p));
 function allowed(p,settings){return settings.strings.includes(p.string)&&settings.frets.includes(p.fret)&&(!settings.naturalOnly||isNatural(p));}
 function candidates(settings){return settings.strings.flatMap(string=>settings.frets.map(fret=>({string,fret}))).filter(p=>allowed(p,settings));}
 function movePosition(settings,p,direction){const all=candidates(settings);if(!all.length)return null;if(!p||!allowed(p,settings))return all[0];const horizontal=direction==='ArrowLeft'||direction==='ArrowRight',step=direction==='ArrowLeft'||direction==='ArrowUp'?-1:1;const options=all.filter(q=>horizontal?q.string===p.string&&(q.fret-p.fret)*step>0:(q.string-p.string)*step>0);options.sort((a,b)=>horizontal?Math.abs(a.fret-p.fret)-Math.abs(b.fret-p.fret):Math.abs(a.string-p.string)-Math.abs(b.string-p.string)||Math.abs(a.fret-p.fret)-Math.abs(b.fret-p.fret)||a.fret-b.fret);return options[0]||p;}
 function shuffled(positions,last=null,random=Math.random){const a=positions.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}if(a.length>1&&last&&key(a[0])===key(last)){const j=1+Math.floor(random()*(a.length-1));[a[0],a[j]]=[a[j],a[0]];}return a;}
 function isCorrect(target,selected,settings){return !!target&&allowed(selected,settings)&&target.string===selected.string&&pitch(target)===pitch(selected);}
 function normalize(data){const values=(v,max,min,def)=>Array.isArray(v)?[...new Set(v.filter(n=>Number.isInteger(n)&&n>=min&&n<=max))].sort((a,b)=>a-b):def;return {highlightRange:data?.highlightRange!==false,showTuning:data?.showTuning!==false,naturalOnly:data?.naturalOnly===true,strings:values(data?.strings,6,1,[1,2,3,4,5,6]),frets:values(data?.frets,12,0,Array.from({length:13},(_,i)=>i)),notation:['both','sharp','flat'].includes(data?.notation)?data.notation:'both',mode:['forward','reverse','study'].includes(data?.mode)?data.mode:'forward'};}
 const api={key,pitch,name,isNatural,allowed,candidates,movePosition,shuffled,isCorrect,normalize};root.FretCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
