(function(root){
 'use strict';
 const opens=[4,11,7,2,9,4],sharp=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'],flat=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
 const key=p=>`${p.string}:${p.fret}`;
 const pitch=p=>(opens[p.string-1]+p.fret)%12;
 function name(p,notation='both'){const n=pitch(p);return notation==='flat'?flat[n]:notation==='sharp'?sharp[n]:sharp[n]===flat[n]?sharp[n]:`${sharp[n]} / ${flat[n]}`;}
 function candidates(settings){return settings.strings.flatMap(string=>settings.frets.map(fret=>({string,fret})));}
 function shuffled(positions,last=null,random=Math.random){const a=positions.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}if(a.length>1&&last&&key(a[0])===key(last)){const j=1+Math.floor(random()*(a.length-1));[a[0],a[j]]=[a[j],a[0]];}return a;}
 function isCorrect(target,selected,settings){return !!target&&settings.strings.includes(selected.string)&&settings.frets.includes(selected.fret)&&target.string===selected.string&&pitch(target)===pitch(selected);}
 function normalize(data){const values=(v,max,min,def)=>Array.isArray(v)?[...new Set(v.filter(n=>Number.isInteger(n)&&n>=min&&n<=max))].sort((a,b)=>a-b):def;return {strings:values(data?.strings,6,1,[1,2,3,4,5,6]),frets:values(data?.frets,12,0,Array.from({length:13},(_,i)=>i)),notation:['both','sharp','flat'].includes(data?.notation)?data.notation:'both',mode:['forward','reverse','study'].includes(data?.mode)?data.mode:'forward'};}
 const api={key,pitch,name,candidates,shuffled,isCorrect,normalize};root.FretCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
