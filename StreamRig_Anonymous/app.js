'use strict';
// StreamRig academic page. All point geometry and camera poses are archived measurements.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
// 结果表：数字全部来自 assets/tables.js（由 tools/export_tables.py 从论文 tex 生成），此处只负责排版
const tableData=window.STREAMRIG_TABLES;
function cell(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el}
function renderMainTable(){const body=$('#results-body');body.replaceChildren();for(const group of tableData.main){if(group.label!=='Ours'){const tr=document.createElement('tr');tr.className='group-row';const td=cell('td',group.label);td.colSpan=14;tr.append(td);body.append(tr)}
  for(const row of group.rows){const tr=document.createElement('tr');if(row.ours)tr.className='highlight';if(row.oracle)tr.className='oracle';tr.append(cell('td',row.name.replace(/[†‡§]/g,'')),cell('td',row.input==='full'?'Rig':'Mono','meta'));
   row.cells.forEach((c,i)=>{tr.append(cell('td',c.text,[c.rank===1?'best':c.rank===2?'second':'',i%3===0?'group-start':''].join(' ').trim()))});body.append(tr)}}}
function renderSimple(selector,rows,labelCols){const body=$(selector+' tbody');body.replaceChildren();let previous='';for(const row of rows){const tr=document.createElement('tr');if(/Ours|MapAnything|2 side/.test(row.labels.join(' ')))tr.className='ours-row';
  if(labelCols===2){tr.append(cell('td',row.group!==previous?row.group:'','meta'),cell('td',row.labels[1].replace(/[†‡§]/g,'')));previous=row.group}else row.labels.forEach(l=>tr.append(cell('td',l,tr.children.length?'meta':'')));
  for(const c of row.cells)tr.append(cell('td',c.v,c.bold?'bold':''));body.append(tr)}}
function renderEfficiency(){const body=$('#efficiency-table tbody');body.replaceChildren();let group='';for(const row of tableData.efficiency){if(row.group!==group){group=row.group;const tr=document.createElement('tr');tr.className='group-row';const td=cell('td',group);td.colSpan=5;tr.append(td);body.append(tr)}
  const tr=document.createElement('tr');if(row.bold)tr.className='highlight';tr.append(cell('td',row.labels[0]),cell('td',row.labels[1],'meta'));for(const c of row.cells)tr.append(cell('td',c.v,c.bold?'bold':''));body.append(tr)}}
if(tableData){renderMainTable();renderSimple('#ablation-table',tableData.ablation,2);renderSimple('#rig-table',tableData.rig,1);renderSimple('#scaling-table',tableData.scaling,1);renderEfficiency()}
// The first chapter selection waits until the browser has a seekable media range.
const film=$('#film-video');let pendingChapter=null;
function seekChapter(){if(pendingChapter===null||film.readyState<2)return;for(let i=0;i<film.seekable.length;i++){if(film.seekable.start(i)<=pendingChapter&&film.seekable.end(i)>=pendingChapter){film.currentTime=pendingChapter;pendingChapter=null;film.play().catch(()=>{});break}}}
['loadeddata','canplay','progress','canplaythrough'].forEach(event=>film.addEventListener(event,seekChapter));
$$('[data-time]').forEach(b=>b.addEventListener('click',()=>{pendingChapter=+b.dataset.time;if(film.readyState===0){film.preload='auto';film.load()}else seekChapter();film.scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'center'})}));
$('#copy-citation').addEventListener('click',async()=>{const text=$('#bibtex').textContent;try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);else{const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();if(!document.execCommand('copy'))throw Error('clipboard');t.remove()}$('#copy-citation').textContent='Copied';setTimeout(()=>$('#copy-citation').textContent='Copy',2000)}catch{const range=document.createRange();range.selectNodeContents($('#bibtex'));window.getSelection().removeAllRanges();window.getSelection().addRange(range);$('#copy-citation').textContent='Select & copy'}});
