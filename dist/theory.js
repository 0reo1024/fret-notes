(function(root){
 'use strict';
 const letters=['C','D','E','F','G','A','B'],naturals=[0,2,4,5,7,9,11];
 const roots=['C','C♯','D♭','D','D♯','E♭','E','F','F♯','G♭','G','G♯','A♭','A','A♯','B♭','B'];
 const mod=n=>(n%12+12)%12;
 function degreeParts(degree){if(degree==='R')return {step:0,alter:0};const match=/^([♭♯]*)(\d+)$/.exec(degree);if(!match)throw new Error('Invalid degree');return {step:(Number(match[2])-1)%7,alter:[...match[1]].reduce((n,a)=>n+(a==='♯'?1:-1),0)};}
 function pitchOf(name){const index=letters.indexOf(name[0]);if(index<0||!/^[A-G][♭♯]*$/.test(name))throw new Error('Invalid note');return mod(naturals[index]+[...name.slice(1)].reduce((n,a)=>n+(a==='♯'?1:-1),0));}
 function interval(degree){const {step,alter}=degreeParts(degree);return mod(naturals[step]+alter);}
 function spell(rootName,degree){const {step}=degreeParts(degree);const letterIndex=(letters.indexOf(rootName[0])+step)%7;const pitch=mod(pitchOf(rootName)+interval(degree));let delta=mod(pitch-naturals[letterIndex]);if(delta>6)delta-=12;return letters[letterIndex]+(delta<0?'♭'.repeat(-delta):'♯'.repeat(delta));}
 const pattern=(id,label,formula,suffix='',group='',description='')=>({id,label,degrees:formula.split(' '),suffix,group,description});
 const chords=[
  pattern('major','メジャー','R 3 5','','三和音'),
  pattern('minor','マイナー','R ♭3 5','m','三和音'),
  pattern('maj7','メジャー7th','R 3 5 7','maj7','7thコード'),
  pattern('min7','マイナー7th','R ♭3 5 ♭7','m7','7thコード'),
  pattern('dom7','7th（ドミナント）','R 3 5 ♭7','7','7thコード'),
  pattern('half-dim','マイナー7th♭5','R ♭3 ♭5 ♭7','m7♭5','7thコード','ハーフディミニッシュ（ø7）。'),
  pattern('dim','ディミニッシュ','R ♭3 ♭5','dim','三和音'),
  pattern('dim7','ディミニッシュ7th','R ♭3 ♭5 ♭♭7','dim7','7thコード','♭♭7は減7度。音高は長6度と同じです。'),
  pattern('aug','オーギュメント','R 3 ♯5','aug','三和音'),
  pattern('sus2','sus2','R 2 5','sus2','sus・6th・add9'),
  pattern('sus4','sus4','R 4 5','sus4','sus・6th・add9'),
  pattern('7sus4','7sus4','R 4 5 ♭7','7sus4','sus・6th・add9'),
  pattern('six','6th','R 3 5 6','6','sus・6th・add9'),
  pattern('min6','マイナー6th','R ♭3 5 6','m6','sus・6th・add9'),
  pattern('minmaj7','マイナーメジャー7th','R ♭3 5 7','m(maj7)','7thコード'),
  pattern('add9','add9','R 3 5 9','add9','sus・6th・add9'),
  pattern('nine','9th（ドミナント）','R 3 5 ♭7 9','9','9thコード'),
  pattern('maj9','メジャー9th','R 3 5 7 9','maj9','9thコード'),
  pattern('min9','マイナー9th','R ♭3 5 ♭7 9','m9','9thコード')
 ];
 const scales=[
  pattern('ionian','アイオニアン（メジャー）','R 2 3 4 5 6 7','','教会旋法'),
  pattern('dorian','ドリアン','R 2 ♭3 4 5 6 ♭7','','教会旋法'),
  pattern('phrygian','フリジアン','R ♭2 ♭3 4 5 ♭6 ♭7','','教会旋法'),
  pattern('lydian','リディアン','R 2 3 ♯4 5 6 7','','教会旋法'),
  pattern('mixolydian','ミクソリディアン','R 2 3 4 5 6 ♭7','','教会旋法'),
  pattern('aeolian','エオリアン（ナチュラルマイナー）','R 2 ♭3 4 5 ♭6 ♭7','','教会旋法'),
  pattern('locrian','ロクリアン','R ♭2 ♭3 4 ♭5 ♭6 ♭7','','教会旋法'),
  pattern('harmonic-minor','ハーモニックマイナー','R 2 ♭3 4 5 ♭6 7','','マイナー系'),
  pattern('melodic-minor','メロディックマイナー（ジャズ）','R 2 ♭3 4 5 6 7','','マイナー系','上行形を上下行共通で使うジャズ・メロディックマイナー。'),
  pattern('major-pentatonic','メジャーペンタトニック','R 2 3 5 6','','ペンタ・ブルース'),
  pattern('minor-pentatonic','マイナーペンタトニック','R ♭3 4 5 ♭7','','ペンタ・ブルース'),
  pattern('minor-blues','マイナーブルース','R ♭3 4 ♭5 5 ♭7','','ペンタ・ブルース'),
  pattern('major-blues','メジャーブルース','R 2 ♭3 3 5 6','','ペンタ・ブルース'),
  pattern('hmp5','HMP5↓（フリジアン・ドミナント）','R ♭2 3 4 5 ♭6 ♭7','','ドミナント・応用','ハーモニックマイナーの第5モード。同じ構成音のハーモニックマイナーは、このルートの完全5度下です。'),
  pattern('altered','オルタード','R ♭9 ♯9 3 ♭5 ♯5 ♭7','','ドミナント・応用','メロディックマイナーの第7モード。ドミナントの度数で表記（♯5は♭13と異名同音）。'),
  pattern('lydian-dominant','リディアン・ドミナント（♭7）','R 2 3 ♯4 5 6 ♭7','','ドミナント・応用'),
  pattern('lydian-augmented','リディアン・オーギュメント','R 2 3 ♯4 ♯5 6 7','','ドミナント・応用'),
  pattern('locrian-natural2','ロクリアン♮2','R 2 ♭3 4 ♭5 ♭6 ♭7','','ドミナント・応用'),
  pattern('whole-tone','ホールトーン','R 2 3 ♯4 ♯5 ♭7','','対称スケール'),
  pattern('diminished-wh','ディミニッシュ（全音→半音）','R 2 ♭3 4 ♭5 ♭6 6 7','','対称スケール'),
  pattern('diminished-hw','コンディミ（半音→全音）','R ♭9 ♯9 3 ♯11 5 13 ♭7','','対称スケール')
 ];
 function normalize(data){return {studyView:['all','chord','scale'].includes(data?.studyView)?data.studyView:'all',studyRoot:roots.includes(data?.studyRoot)?data.studyRoot:'C',studyChord:chords.some(p=>p.id===data?.studyChord)?data.studyChord:'major',studyScale:scales.some(p=>p.id===data?.studyScale)?data.studyScale:'ionian',toneLabels:['both','name','degree'].includes(data?.toneLabels)?data.toneLabels:'both'};}
 function selected(settings){return settings.studyView==='chord'?chords.find(p=>p.id===settings.studyChord):settings.studyView==='scale'?scales.find(p=>p.id===settings.studyScale):null;}
 function tones(settings){const p=selected(settings);return p?p.degrees.map(degree=>({degree,name:spell(settings.studyRoot,degree),pitch:mod(pitchOf(settings.studyRoot)+interval(degree))})):[];}
 const api={roots,chords,scales,normalize,selected,tones,pitchOf,interval,spell};root.FretTheory=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
