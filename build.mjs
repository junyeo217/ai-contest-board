import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const ROOT = new URL('./', import.meta.url);
const config = JSON.parse(await readFile(new URL('template.json', ROOT), 'utf8'));

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const safeUrl = value => /^https?:\/\/\S+$/i.test(String(value || '').trim()) ? escapeHtml(String(value).trim()) : '';
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const dateOnly = value => String(value || '').slice(0, 10);
const dateValue = value => validDate(value) ? Date.parse(`${value}T00:00:00Z`) : Number.POSITIVE_INFINITY;

function fnv1a(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(36);
}
function stableId(item) {
  return `contest-${fnv1a(`${item.title || ''}|${item.submission_end || ''}`)}`;
}
function normalizeItem(item) {
  const normalized = { ...item, _id: stableId(item) };
  if (config.musicVideoWhitelist.includes(item.title) && !String(item.category || '').includes('음악')) {
    normalized.category = String(item.category || '').includes('영상') ? `${item.category}·음악` : 'AI 영상·음악';
  }
  return normalized;
}
function normalizeData(data) {
  const sections = {};
  for (const [name, items] of Object.entries(data.sections || {})) sections[name] = items.map(normalizeItem);
  return { ...data, sections };
}
function allRecords(data) {
  const seen = new Set();
  return ['starting_today', 'ongoing', 'awaiting_results']
    .flatMap(name => data.sections?.[name] || [])
    .filter(item => {
      const key = `${item.title || ''}|${item.submission_end || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function bucket(item, today) {
  if (item.results_confirmed === true && validDate(item.results_published_at)) {
    const age = Math.floor((dateValue(today) - dateValue(item.results_published_at)) / 86400000);
    if (age >= 7) return 'archived';
    if (age >= 0) return 'published';
  }
  if (validDate(item.submission_start) && item.submission_start > today) return 'future';
  if (validDate(item.submission_end) && item.submission_end < today) return 'closed';
  return 'open';
}
function recordsByBucket(data, today) {
  const grouped = { open: [], closed: [], published: [] };
  for (const item of allRecords(data)) {
    const name = bucket(item, today);
    if (grouped[name]) grouped[name].push(item);
  }
  for (const items of Object.values(grouped)) items.sort((a, b) => dateValue(a.submission_end) - dateValue(b.submission_end));
  return grouped;
}
function isOfficial(item) {
  const source = String(item.source_type || '').toLowerCase();
  return source === 'official' || source.startsWith('official_');
}
function linkMarkup(item) {
  const url = safeUrl(item.url);
  if (!url) return '<span class="source missing">원문 미확인</span>';
  return `<a class="source" href="${url}" target="_blank" rel="noopener noreferrer">${isOfficial(item) ? '공식 원문' : '참고 원문'} ↗</a>`;
}
function guidelineMarkup(item) {
  const guide = config.guidelines[item.title];
  if (!guide) return `<details class="guide-detail"><summary>공모요강 보기 <span class="guide-label">확인 전</span></summary><div class="guide-unknown"><strong>상세 공모요강은 아직 구조화하지 않았습니다.</strong><p>접수 기간: ${escapeHtml(item.submission_start || '미정')} ~ ${escapeHtml(item.submission_end || '미정')}</p><p>참가 자격, 작품 규격, 시상, 권리 조건은 원문에서 확인하세요.</p>${linkMarkup(item)}</div></details>`;
  const facts = guide.facts.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
  const sections = guide.sections.map(([heading, rows]) => `<section class="guide-section"><h4>${escapeHtml(heading)}</h4><dl>${rows.map(([term, description]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(description)}</dd>`).join('')}</dl></section>`).join('');
  const sources = guide.sources.map(([label, url]) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`).join('');
  const actionUrl = String(guide.action[1] || '');
  const actionAttributes = actionUrl.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<details class="guide-detail"><summary>공모요강 보기 <span class="guide-label">요강 수록</span></summary><div class="guide-content"><div class="guide-header"><h3>공모요강</h3><span>공식 출처 확인 ${escapeHtml(guide.checked)}</span></div>${guide.alert ? `<div class="guide-alert"><b>출품 전 확인</b><br>${escapeHtml(guide.alert)}</div>` : ''}<div class="guide-facts">${facts}</div><div class="guide-grid">${sections}</div><div class="guide-sources"><b>근거 자료</b><br>${sources}<p>공식 자료를 구조화한 요약입니다. 미확인 항목과 출처 간 차이는 본문에 표시했습니다. 출품 직전 변경 여부를 확인하세요.</p></div><div class="guide-actions"><a href="${escapeHtml(actionUrl)}"${actionAttributes}>${escapeHtml(guide.action[0])} ↗</a><button type="button" data-close-guide>요강 접기</button></div></div></details>`;
}
function dday(end, today) {
  if (!validDate(end)) return '마감 확인';
  const days = Math.round((dateValue(end) - dateValue(today)) / 86400000);
  if (days < 0) return '접수 마감';
  if (days === 0) return '오늘 마감';
  return `D-${days}`;
}
function cardMarkup(item, status, today, regionLabel) {
  const tag = status === 'published' ? '발표 완료' : status === 'closed' ? '발표 예정' : dday(item.submission_end, today);
  const date = status === 'published' ? item.results_published_at : item.submission_end;
  const country = regionLabel === '해외' && item.country ? `<span>${escapeHtml(item.country)}</span>` : '';
  return `<article class="entry" id="${escapeHtml(item._id)}" data-category="${escapeHtml(item.category)}"><div class="row"><div><div class="meta"><span class="kind">${escapeHtml(item.category || '분야 미정')}</span>${escapeHtml(item.organizer || '주최 미정')}</div><h3>${escapeHtml(item.title || '제목 미정')}</h3>${item.summary ? `<p class="desc">${escapeHtml(item.summary)}</p>` : ''}</div><div class="deadline"><strong class="${status === 'open' && validDate(date) && (dateValue(date)-dateValue(today))/86400000 <= 3 ? 'urgent' : ''}">${escapeHtml(tag)}</strong><time datetime="${validDate(date) ? escapeHtml(date) : ''}">${escapeHtml(date || '미정')}</time></div></div><div class="bottom">${country}<span>${linkMarkup(item)}</span></div>${guidelineMarkup(item)}</article>`;
}

const styles = `
:root{--bg:#f8faf9;--paper:#fff;--ink:#1b2923;--muted:#58675f;--line:#dce4df;--accent:#216347;--wash:#eaf3ed;--warn:#a6372c;--max:1240px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;font-size:15px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased}button,input,select{font:inherit;color:inherit}button{cursor:pointer;border:0;background:none}a{color:inherit;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}button:hover,a:hover{color:var(--accent)}.skip{position:absolute;left:-9999px;top:8px}.skip:focus{left:8px;z-index:100;background:var(--ink);color:#fff;padding:8px 12px}.wrap{max-width:var(--max);margin:auto;padding-inline:32px}.site-header{border-bottom:1px solid var(--line);background:rgba(248,250,249,.96);position:sticky;top:0;z-index:30}.head{height:80px;display:flex;align-items:center;gap:38px}.brand{font-size:22px;font-weight:760;letter-spacing:-.6px;white-space:nowrap}.regions{height:100%;display:flex;gap:24px;align-items:center}.regions a{height:100%;display:flex;align-items:center;padding:0 2px;color:var(--muted);font-weight:650;position:relative}.regions a[aria-current=page]{color:var(--accent)}.regions a[aria-current=page]:after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:3px;background:var(--accent)}.search{margin-left:auto;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:0 12px;width:300px}.search input{background:none;border:0;outline:0;padding:10px 0;width:100%;font-size:14px}.intro{padding:38px 0 30px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.eyebrow{font-size:11px;color:var(--accent);font-weight:750;letter-spacing:1.5px;margin-bottom:8px}.intro h1{font-size:36px;font-weight:750;letter-spacing:-1.1px;line-height:1.3;margin:0 0 9px}.intro p{margin:0;color:var(--muted)}.edition{max-width:310px;text-align:right;color:var(--muted);font-size:12px;line-height:1.9;padding-left:18px;border-left:2px solid var(--line)}.edition a{text-decoration:underline}.tabs{display:flex;gap:30px;border-bottom:1px solid var(--line)}.tabs button{font-size:16px;padding:15px 2px;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-1px}.tabs button.active{color:var(--accent);border-color:var(--accent);font-weight:750}.tabs span{display:inline-block;min-width:25px;text-align:center;margin-left:8px;font-size:12px;border-radius:5px;background:#edf0ee;padding:1px 6px}.tabs button.active span{background:var(--accent);color:#fff}.status-explanation{font-size:13px;color:var(--muted);margin:13px 0 16px}.fetch-warning{margin:16px 0 0;padding:11px 14px;border-left:3px solid var(--warn);background:#fff0eb;color:#75332c;font-size:13px}.layout{display:grid;grid-template-columns:178px minmax(0,1fr);gap:38px;padding:28px 0 70px}.layout>aside{position:sticky;top:104px;align-self:start;max-height:calc(100vh - 128px);overflow:auto;padding-right:3px}.layout aside h2{font-size:12px;color:var(--muted);font-weight:700;margin:0 0 10px}.filter{display:flex;flex-direction:column;gap:5px;margin-bottom:27px}.filter button{display:flex;justify-content:space-between;align-items:center;text-align:left;padding:9px 12px;min-height:41px;border-radius:6px;font-size:14px}.filter button.active{background:var(--wash);color:var(--accent);box-shadow:inset 3px 0 var(--accent);font-weight:750}.filter button:hover{background:var(--wash)}.filter small{font-size:12px;font-weight:550}.reset{font-size:13px;text-decoration:underline;color:var(--muted);min-height:36px}.note{border-top:1px solid var(--line);margin-top:30px;padding-top:18px;color:var(--muted);font-size:12px;line-height:1.85}.note strong{color:var(--ink)}.mobile-filter-toggle{display:none}.toolbar{display:flex;justify-content:space-between;align-items:center;padding-bottom:15px;border-bottom:2px solid #344f41}.toolbar h2{font-size:18px;font-weight:750;margin:0}.toolbar h2 span{font-size:14px;color:var(--accent);font-weight:650;margin-left:8px}.toolbar select{font-size:13px;background:#fff;border:1px solid var(--line);border-radius:6px;padding:7px 10px}.list{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}.entry{border-bottom:1px solid var(--line);padding:24px 22px 19px;scroll-margin-top:100px}.entry:last-child{border-bottom:0}.entry:hover{background:#f9fcfa}.row{display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:22px}.meta{color:var(--muted);font-size:12px;line-height:1.8;margin-bottom:9px}.meta .kind{display:inline-block;background:var(--wash);color:var(--accent);border-radius:4px;padding:1px 7px;font-size:11px;font-weight:650;margin-right:8px}.entry h3{font-size:19px;font-weight:700;letter-spacing:-.45px;line-height:1.5;margin:0 0 8px;color:#172b20}.desc{font-size:14px;color:var(--muted);line-height:1.75;margin:0;max-width:760px}.deadline{text-align:right;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}.deadline strong{display:inline-block;font-size:14px;font-weight:750;padding:3px 10px;border-radius:5px;background:#eef3ef;color:var(--accent);margin-bottom:7px}.deadline time{display:block;color:var(--muted)}.bottom{display:flex;align-items:center;justify-content:space-between;margin-top:16px;color:var(--muted);font-size:12px}.source{font-size:13px;color:var(--accent);font-weight:600}.source.missing{color:var(--muted)}.guide-detail{margin-top:4px;color:var(--muted)}.guide-detail>summary{cursor:pointer;list-style:none;width:fit-content;font-size:13px;font-weight:600;color:var(--accent);min-height:40px;padding:9px 0}.guide-detail>summary:after{content:' +';margin-left:4px}.guide-detail[open]>summary:after{content:' −'}.guide-label{font-size:11px;margin-left:8px;padding:2px 6px;border:1px solid var(--line);border-radius:4px}.guide-content{margin-top:8px;padding:24px;background:#f5f8f5;border-top:2px solid var(--accent);border-radius:0 0 7px 7px}.guide-header{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:16px}.guide-header h3{font-size:20px;margin:0}.guide-header span{font-size:12px}.guide-alert{padding:13px 15px;border-left:3px solid #ad6a35;background:#fff4e6;color:#754323;font-size:14px;line-height:1.8;margin-bottom:20px}.guide-facts{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #d5dbd2;margin-bottom:23px;padding-bottom:18px;gap:16px}.guide-facts small{display:block;font-size:12px;color:var(--muted)}.guide-facts strong{display:block;font-size:14px;margin-top:4px;color:var(--ink)}.guide-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px 30px}.guide-section h4{font-size:16px;margin:0 0 11px;color:var(--ink);border-bottom:1px solid var(--line);padding-bottom:8px}.guide-section dl{margin:0}.guide-section dt{font-size:13px;color:var(--ink);margin:11px 0 3px;font-weight:700}.guide-section dd{margin:0;font-size:14px;line-height:1.85;color:#44564b}.guide-sources{margin-top:24px;border-top:1px solid #d5dbd2;padding-top:17px;font-size:13px;line-height:1.9}.guide-sources a{text-decoration:underline;margin-right:16px;display:inline-block}.guide-sources p{font-size:12px}.guide-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px}.guide-actions>a{background:var(--accent);color:#fff;padding:10px 15px;font-size:14px;font-weight:650;border-radius:6px}.guide-actions button{font-size:13px;text-decoration:underline;color:var(--muted);min-height:44px}.guide-unknown{padding:16px 18px;background:var(--wash);font-size:14px;line-height:1.9;border-radius:6px}.guide-unknown p{margin:4px 0}.empty{padding:60px 20px;text-align:center;color:var(--muted)}.end{font-size:12px;color:var(--muted);text-align:center;padding:30px 0}.editorial{padding:20px 0 70px;display:grid;grid-template-columns:1fr 1fr;gap:20px}.info-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:24px}.info-card h2{font-size:20px;margin:0 0 12px}.info-card h3{font-size:15px;margin:20px 0 5px}.info-card p,.info-card li{font-size:13px;color:var(--muted)}.info-card ul{padding-left:20px}.faq{grid-column:1/-1}.faq details{border-top:1px solid var(--line);padding:13px 0}.faq summary{cursor:pointer;font-weight:700}.faq p{margin:8px 0}.footer{border-top:1px solid var(--line);padding:23px 0 82px;font-size:12px;color:var(--muted)}.footer .wrap{display:flex;justify-content:space-between;gap:20px}.footer b{color:var(--ink)}#back-to-top{position:fixed;right:max(22px,env(safe-area-inset-right));bottom:calc(22px + env(safe-area-inset-bottom));width:46px;height:46px;display:flex;align-items:center;justify-content:center;border:1px solid #bdd0c2;border-radius:50%;background:#fff;color:var(--accent);z-index:50;opacity:0;visibility:hidden;pointer-events:none}#back-to-top.visible{opacity:1;visibility:visible;pointer-events:auto}#back-to-top svg{width:19px;height:19px}@media(max-width:1023px){.wrap{padding-inline:24px}.head{gap:24px}.search{width:auto;flex:1}.layout{display:block;padding-top:20px}.layout>aside{position:static;max-height:none;padding:0 0 20px}.layout aside h2,.layout aside .note{display:none}#categories{display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;margin:0 0 12px}.filter button{padding:8px 16px;border:1px solid var(--line);background:#fff}.filter button.active{box-shadow:inset 0 -2px var(--accent)}.filter-extra{display:flex;align-items:center;gap:16px}#days{display:flex;flex-direction:row;gap:6px;margin:0}.reset{margin-left:auto}.guide-grid{grid-template-columns:1fr}.guide-facts{grid-template-columns:1fr}.guide-facts>div{display:flex;gap:14px;align-items:baseline}.guide-facts small{min-width:42px}.guide-facts strong{margin:0}}@media(max-width:639px){.wrap{padding-inline:16px}.site-header{position:static}.head{height:auto;flex-wrap:wrap;gap:8px 16px;padding-block:14px}.brand{font-size:19px}.regions{margin-left:auto;height:40px;gap:16px}.regions a{height:40px}.search{order:3;flex-basis:100%;width:100%}.search input{font-size:16px}.intro{display:block;padding:25px 0 22px}.intro h1{font-size:28px}.intro p{font-size:13px}.edition{text-align:left;font-size:11px;max-width:none;margin-top:13px;padding-left:10px}.tabs{gap:0;justify-content:space-between}.tabs button{flex:1;font-size:14px;padding:12px 0}.tabs span{font-size:11px;margin-left:5px;padding:1px 4px}.layout{padding-top:16px}#categories{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}#categories button{padding:8px 10px;font-size:13px;flex:1 0 auto}#categories small{display:none}.mobile-filter-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:40px;border:1px solid var(--line);border-radius:6px;padding:8px 12px;background:#fff;font-size:13px;color:var(--muted)}.mobile-filter-toggle:after{content:'+'}.mobile-filter-toggle[aria-expanded=true]:after{content:'−'}.filter-extra{display:none;padding-top:10px}.filter-extra.is-open{display:flex;flex-wrap:wrap;gap:8px}#days{gap:3px}.reset{min-height:40px}.toolbar{padding:14px 0}.toolbar h2{font-size:17px}.toolbar select{font-size:12px;max-width:130px}.status-explanation{font-size:12px}.entry{padding:19px 15px 14px}.row{display:flex;flex-direction:column;gap:12px}.entry h3{font-size:18px}.desc{font-size:14px}.deadline{display:flex;align-items:center;text-align:left;gap:10px}.deadline strong{font-size:12px;margin:0}.deadline time{font-size:12px}.guide-content{padding:18px 13px}.guide-header{flex-direction:column;align-items:flex-start}.guide-actions{flex-wrap:wrap}.editorial{grid-template-columns:1fr;padding-bottom:50px}.faq{grid-column:auto}.footer .wrap{display:block}.footer p{margin:4px 0}#back-to-top{right:14px;bottom:calc(14px + env(safe-area-inset-bottom));width:44px;height:44px}}.deadline strong.urgent{color:var(--warn);background:#fff0eb;border:1px solid #f3cfc5}@media(min-width:1440px){:root{--max:1360px}.wrap{padding-inline:40px}.layout{grid-template-columns:196px minmax(0,1fr);gap:44px}.head{gap:42px}.search{width:320px}.entry{padding:26px}.intro h1{font-size:38px}}@media(min-width:1920px){:root{--max:1520px}.wrap{padding-inline:48px}.layout{grid-template-columns:220px minmax(0,1fr);gap:56px}.row{grid-template-columns:minmax(0,1fr) 136px}.entry{padding:28px 30px}.guide-grid{column-gap:40px}}@media(max-width:359px){.wrap{padding-inline:12px}.brand{font-size:17px}.regions{gap:10px}.tabs button{font-size:13px}.tabs span{margin-left:3px}.intro h1{font-size:26px}#categories button{padding-inline:9px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

function clientApp(options) {
  const initialNode = document.getElementById('initial-data');
  const initialData = JSON.parse(initialNode.textContent);
  const GUIDES = options.guidelines;
  const whitelist = new Set(options.musicVideoWhitelist);
  const state = { data: initialData, status: 'open', cat: 'all', days: 0, query: '', sort: 'deadline' };
  const $ = id => document.getElementById(id);
  const nodes = { query: $('query'), list: $('list'), count: $('count'), explanation: $('status-explanation'), warning: $('fetch-warning'), sort: $('sort'), toggle: $('mobile-filter-toggle'), extra: $('filter-extra') };
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const dateValue = value => validDate(value) ? Date.parse(`${value}T00:00:00Z`) : Number.POSITIVE_INFINITY;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safe = value => /^https?:\/\/\S+$/i.test(String(value || '').trim()) ? esc(String(value).trim()) : '';
  function fnv1a(value) { let hash = 2166136261; for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0; return hash.toString(36); }
  function stableId(item) { return `contest-${fnv1a(`${item.title || ''}|${item.submission_end || ''}`)}`; }
  function normalizeItem(item) { const copy = { ...item, _id: stableId(item) }; if (whitelist.has(item.title) && !String(item.category || '').includes('음악')) copy.category = String(item.category || '').includes('영상') ? `${item.category}·음악` : 'AI 영상·음악'; return copy; }
  function normalizeData(data) { const sections = {}; for (const [name, items] of Object.entries(data.sections || {})) sections[name] = items.map(normalizeItem); return { ...data, sections }; }
  function bucket(item, reference) { if (item.results_confirmed === true && validDate(item.results_published_at)) { const age = Math.floor((dateValue(reference) - dateValue(item.results_published_at)) / 86400000); if (age >= 7) return 'archived'; if (age >= 0) return 'published'; } if (validDate(item.submission_start) && item.submission_start > reference) return 'future'; if (validDate(item.submission_end) && item.submission_end < reference) return 'closed'; return 'open'; }
  function records() { const seen = new Set(); return ['starting_today', 'ongoing', 'awaiting_results'].flatMap(name => state.data.sections?.[name] || []).filter(item => { const key = `${item.title || ''}|${item.submission_end || ''}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(normalizeItem).map(item => ({ ...item, bucket: bucket(item, today()) })).filter(item => !['archived', 'future'].includes(item.bucket)); }
  function isOfficial(item) { const source = String(item.source_type || '').toLowerCase(); return source === 'official' || source.startsWith('official_'); }
  function link(item) { const url = safe(item.url); return url ? `<a class="source" href="${url}" target="_blank" rel="noopener noreferrer">${isOfficial(item) ? '공식 원문' : '참고 원문'} ↗</a>` : '<span class="source missing">원문 미확인</span>'; }
  function guide(item) { const g = GUIDES[item.title]; if (!g) return `<details class="guide-detail"><summary>공모요강 보기 <span class="guide-label">확인 전</span></summary><div class="guide-unknown"><strong>상세 공모요강은 아직 구조화하지 않았습니다.</strong><p>접수 기간: ${esc(item.submission_start || '미정')} ~ ${esc(item.submission_end || '미정')}</p><p>참가 자격, 작품 규격, 시상, 권리 조건은 원문에서 확인하세요.</p>${link(item)}</div></details>`; const facts = g.facts.map(([a, b]) => `<div><small>${esc(a)}</small><strong>${esc(b)}</strong></div>`).join(''); const sections = g.sections.map(([heading, rows]) => `<section class="guide-section"><h4>${esc(heading)}</h4><dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl></section>`).join(''); const sources = g.sources.map(([a, b]) => `<a href="${safe(b)}" target="_blank" rel="noopener noreferrer">${esc(a)} ↗</a>`).join(''); const action = String(g.action[1] || ''); return `<details class="guide-detail"><summary>공모요강 보기 <span class="guide-label">요강 수록</span></summary><div class="guide-content"><div class="guide-header"><h3>공모요강</h3><span>공식 출처 확인 ${esc(g.checked)}</span></div>${g.alert ? `<div class="guide-alert"><b>출품 전 확인</b><br>${esc(g.alert)}</div>` : ''}<div class="guide-facts">${facts}</div><div class="guide-grid">${sections}</div><div class="guide-sources"><b>근거 자료</b><br>${sources}<p>공식 자료를 구조화한 요약입니다. 출품 직전 변경 여부를 확인하세요.</p></div><div class="guide-actions"><a href="${esc(action)}"${action.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(g.action[0])} ↗</a><button type="button" data-close-guide>요강 접기</button></div></div></details>`; }
  function day(end) { return validDate(end) ? Math.round((dateValue(end) - dateValue(today())) / 86400000) : null; }
  function card(item) { const d = day(item.submission_end); const tag = state.status === 'published' ? '발표 완료' : state.status === 'closed' ? '발표 예정' : d === 0 ? '오늘 마감' : d === null ? '마감 확인' : `D-${d}`; const date = state.status === 'published' ? item.results_published_at : item.submission_end; return `<article class="entry" id="${esc(item._id)}" data-category="${esc(item.category)}"><div class="row"><div><div class="meta"><span class="kind">${esc(item.category || '분야 미정')}</span>${esc(item.organizer || '주최 미정')}</div><h3>${esc(item.title || '제목 미정')}</h3>${item.summary ? `<p class="desc">${esc(item.summary)}</p>` : ''}</div><div class="deadline"><strong class="${state.status === 'open' && d !== null && d <= 3 ? 'urgent' : ''}">${esc(tag)}</strong><time datetime="${validDate(date) ? esc(date) : ''}">${esc(date || '미정')}</time></div></div><div class="bottom"><span>${options.regionLabel === '해외' ? esc(item.country || '') : ''}</span><span>${link(item)}</span></div>${guide(item)}</article>`; }
  function explanations(status) { return status === 'published' ? '실제 결과 발표가 확인된 공고만 표시합니다. 발표 확인일로부터 7일이 지나면 목록에서 자동 제외됩니다.' : status === 'closed' ? '접수가 끝나고 결과 발표를 기다리는 공고입니다. 예정일이 지나도 실제 발표 확인 전까지 이곳에 남습니다.' : '현재 접수 가능한 공고입니다. 접수 시작 전 공고는 표시하지 않습니다.'; }
  function categoryMatch(item, category) { if (category === 'all') return true; return String(item.category || '').includes(category); }
  function render() { const all = records(); document.querySelectorAll('[data-status]').forEach(button => { const active = button.dataset.status === state.status; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.querySelector('span').textContent = all.filter(item => item.bucket === button.dataset.status).length; }); document.querySelectorAll('[data-cat]').forEach(button => { const active = button.dataset.cat === state.cat; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.querySelector('small').textContent = all.filter(item => item.bucket === state.status && categoryMatch(item, button.dataset.cat)).length; }); document.querySelectorAll('[data-days]').forEach(button => { const active = Number(button.dataset.days) === state.days; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); button.disabled = state.status !== 'open'; }); let items = all.filter(item => item.bucket === state.status && categoryMatch(item, state.cat) && (!state.days || state.status !== 'open' || (day(item.submission_end) !== null && day(item.submission_end) >= 0 && day(item.submission_end) <= state.days)) && `${item.title || ''} ${item.organizer || ''} ${item.summary || ''}`.toLowerCase().includes(state.query.toLowerCase())); items.sort((a, b) => state.sort === 'name' ? String(a.title).localeCompare(String(b.title), 'ko') : state.sort === 'latest' ? String(b.submission_start || '').localeCompare(String(a.submission_start || '')) : dateValue(a.submission_end) - dateValue(b.submission_end)); const labels = { open: '접수중', closed: '발표예정', published: '발표완료' }; nodes.count.innerHTML = `${labels[state.status]} <span>${items.length}건</span>`; nodes.explanation.textContent = explanations(state.status); nodes.list.innerHTML = items.length ? items.map(card).join('') : `<div class="empty"><strong>조건에 맞는 공고가 없습니다.</strong><br>${state.status === 'published' ? '최근 7일 안에 발표가 확인된 공고만 표시됩니다.' : '검색어나 필터를 바꿔 보세요.'}</div>`; $('end').textContent = items.length ? `총 ${items.length}건을 모두 확인했습니다.` : ''; nodes.toggle.textContent = state.status !== 'open' ? '마감 필터 · 접수중에서 사용' : state.days ? `마감 필터 · ${state.days}일 이내` : '마감 필터 · 전체'; }
  function hydrateQuery() { const params = new URLSearchParams(location.search); const status = params.get('status'); const category = params.get('category'); const days = Number(params.get('days')); const sort = params.get('sort'); if (['open', 'closed', 'published'].includes(status)) state.status = status; if (['all', '이미지', '영상', '디자인', '음악'].includes(category)) state.cat = category; if ([0, 7, 30].includes(days)) state.days = days; if (['deadline', 'latest', 'name'].includes(sort)) state.sort = sort; state.query = params.get('q') || ''; nodes.query.value = state.query; nodes.sort.value = state.sort; }
  document.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { state.status = button.dataset.status; state.days = 0; render(); })); document.querySelectorAll('[data-cat]').forEach(button => button.addEventListener('click', () => { state.cat = button.dataset.cat; render(); })); document.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => { state.days = Number(button.dataset.days); render(); })); nodes.query.addEventListener('input', event => { state.query = event.target.value; render(); }); nodes.sort.addEventListener('change', event => { state.sort = event.target.value; render(); }); $('reset').addEventListener('click', () => { Object.assign(state, { cat: 'all', days: 0, query: '', sort: 'deadline' }); nodes.query.value = ''; nodes.sort.value = 'deadline'; render(); }); nodes.toggle.addEventListener('click', () => { const open = nodes.toggle.getAttribute('aria-expanded') !== 'true'; nodes.toggle.setAttribute('aria-expanded', String(open)); nodes.extra.classList.toggle('is-open', open); }); nodes.list.addEventListener('click', event => { const button = event.target.closest('[data-close-guide]'); if (!button) return; const details = button.closest('details'); details.open = false; details.querySelector('summary').focus(); }); const topButton = $('back-to-top'); const syncTop = () => { const visible = scrollY > 280; topButton.classList.toggle('visible', visible); topButton.tabIndex = visible ? 0 : -1; topButton.setAttribute('aria-hidden', String(!visible)); }; addEventListener('scroll', syncTop, { passive: true }); topButton.addEventListener('click', () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); syncTop();
  hydrateQuery(); if (location.search) render();
  fetch(options.fetchPath, { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => { state.data = normalizeData(data); nodes.warning.hidden = true; render(); }).catch(() => { nodes.warning.hidden = false; nodes.warning.textContent = '최신 JSON 데이터를 불러오지 못했습니다. 빌드 시 포함된 목록을 그대로 표시합니다.'; });
}

function jsonLd(page, items, generatedAt) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${config.site.baseUrl}#website`, url: config.site.baseUrl, name: config.site.name, inLanguage: 'ko-KR', author: { '@id': `${config.site.baseUrl}#author` } },
      { '@type': 'CollectionPage', '@id': `${page.canonical}#webpage`, url: page.canonical, name: page.title, description: page.description, inLanguage: 'ko-KR', dateModified: generatedAt, isPartOf: { '@id': `${config.site.baseUrl}#website` }, mainEntity: { '@id': `${page.canonical}#itemlist` } },
      { '@type': 'ItemList', '@id': `${page.canonical}#itemlist`, name: `${page.regionLabel} 접수중 AI 공모전`, numberOfItems: items.length, itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, url: `${page.canonical}#${item._id}`, name: item.title })) },
      { '@type': 'Person', '@id': `${config.site.baseUrl}#author`, name: config.site.author.name, alternateName: config.site.author.alternateName, email: `mailto:${config.site.author.email}` }
    ]
  };
}

function pageHtml(page, data) {
  const sourceDate = dateOnly(data.generated_at);
  if (!validDate(sourceDate)) throw new Error(`${page.dataPath}: generated_at must begin with YYYY-MM-DD`);
  const renderDate = process.env.BOARD_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!validDate(renderDate)) throw new Error('Invalid BOARD_DATE');
  const grouped = recordsByBucket(data, renderDate);
  const open = grouped.open;
  const list = open.map(item => cardMarkup(item, 'open', renderDate, page.regionLabel)).join('');
  const counts = { open: grouped.open.length, closed: grouped.closed.length, published: grouped.published.length };
  const categoryCounts = Object.fromEntries(['이미지', '영상', '디자인', '음악'].map(category => [category, open.filter(item => String(item.category || '').includes(category)).length]));
  const alternate = page.regionLabel === '국내' ? config.pages.overseas : config.pages.domestic;
  const initialJson = JSON.stringify(data).replace(/</g, '\\u003c');
  const appOptions = JSON.stringify({ fetchPath: page.fetchPath, regionLabel: page.regionLabel, musicVideoWhitelist: config.musicVideoWhitelist, guidelines: config.guidelines }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${page.canonical}">
<link rel="alternate" hreflang="ko" href="${page.canonical}">
<link rel="alternate" hreflang="x-default" href="${config.site.baseUrl}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ko_KR">
<meta property="og:site_name" content="${escapeHtml(config.site.name)}">
<meta property="og:title" content="${escapeHtml(page.title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:url" content="${page.canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(page.title)}">
<meta name="twitter:description" content="${escapeHtml(page.description)}">
<meta name="author" content="${escapeHtml(config.site.author.name)} (${escapeHtml(config.site.author.alternateName)})">
<meta name="theme-color" content="#216347">
<script type="application/ld+json">${JSON.stringify(jsonLd(page, open, data.generated_at)).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="sitemap" type="application/xml" href="${config.site.baseUrl}sitemap.xml">
<style>${styles}</style>
</head>
<body>
<a class="skip" href="#contest-list">공모전 목록으로 건너뛰기</a>
<header class="site-header"><div class="wrap head"><a class="brand" href="${config.site.baseUrl}">AI 공모전 보드</a><nav class="regions" aria-label="지역별 공모전"><a href="${config.pages.domestic.canonical}"${page.regionLabel === '국내' ? ' aria-current="page"' : ''}>국내</a><a href="${config.pages.overseas.canonical}"${page.regionLabel === '해외' ? ' aria-current="page"' : ''}>해외</a></nav><label class="search"><span aria-hidden="true">⌕</span><input id="query" type="search" placeholder="공모전, 주최기관 검색" aria-label="공모전 검색"></label></div></header>
<main class="wrap"><section class="intro"><div><div class="eyebrow">OPEN CALLS / ${page.scope}</div><h1>${page.regionLabel} 공모전</h1><p>만들고 싶은 작품에 맞는 AI 공모를 찾아보세요.</p></div><div class="edition">작성자 · ${escapeHtml(config.site.author.name)} (${escapeHtml(config.site.author.alternateName)})<br><a href="mailto:${escapeHtml(config.site.author.email)}">${escapeHtml(config.site.author.email)}</a><br>데이터 갱신 <time datetime="${escapeHtml(data.generated_at)}">${escapeHtml(data.generated_at.replace('T', ' ').slice(0, 16))}</time></div></section>
<nav class="tabs" aria-label="접수 상태"><button type="button" data-status="open" class="active" aria-pressed="true">접수중 <span>${counts.open}</span></button><button type="button" data-status="closed" aria-pressed="false">발표예정 <span>${counts.closed}</span></button><button type="button" data-status="published" aria-pressed="false">발표완료 <span>${counts.published}</span></button></nav>
<p id="status-explanation" class="status-explanation">현재 접수 가능한 공고입니다. 접수 시작 전 공고는 표시하지 않습니다.</p><p id="fetch-warning" class="fetch-warning" role="status" hidden></p><noscript><p class="fetch-warning">JavaScript 없이도 빌드 시점의 접수중 목록과 원문 링크를 확인할 수 있습니다.</p></noscript>
<div class="layout"><aside aria-label="공고 필터"><h2>분야</h2><div id="categories" class="filter"><button type="button" data-cat="all" class="active" aria-pressed="true">전체 <small>${counts.open}</small></button><button type="button" data-cat="이미지" aria-pressed="false">이미지 <small>${categoryCounts['이미지']}</small></button><button type="button" data-cat="영상" aria-pressed="false">영상 <small>${categoryCounts['영상']}</small></button><button type="button" data-cat="디자인" aria-pressed="false">디자인 <small>${categoryCounts['디자인']}</small></button><button type="button" data-cat="음악" aria-pressed="false">음악 <small>${categoryCounts['음악']}</small></button></div><button type="button" id="mobile-filter-toggle" class="mobile-filter-toggle" aria-expanded="false" aria-controls="filter-extra">마감 필터 · 전체</button><div id="filter-extra" class="filter-extra"><h2>마감까지</h2><div id="days" class="filter"><button type="button" data-days="0" class="active" aria-pressed="true">전체</button><button type="button" data-days="7" aria-pressed="false">7일 이내</button><button type="button" data-days="30" aria-pressed="false">30일 이내</button></div><button type="button" class="reset" id="reset">필터 초기화</button></div><div class="note"><strong>이미지부터 뮤직비디오까지.</strong><br>이미지, 영상, 디자인, 음악을 같은 분야 필터에서 찾을 수 있습니다. 확인된 뮤직비디오는 음악과 영상 양쪽에 표시하지만 전체 목록에서는 한 번만 셉니다.<br><br>참가 조건과 마감 시각은 반드시 원문에서 확인하세요.</div></aside>
<section id="contest-list" aria-label="${page.regionLabel} 공모전 목록"><div class="toolbar"><h2 id="count" aria-live="polite">접수중 <span>${counts.open}건</span></h2><select id="sort" aria-label="공고 정렬"><option value="deadline">마감임박순</option><option value="latest">최신순</option><option value="name">이름순</option></select></div><div id="list" class="list">${list || '<div class="empty"><strong>접수중인 공고가 없습니다.</strong></div>'}</div><div class="end" id="end">${open.length ? `총 ${open.length}건을 모두 확인했습니다.` : ''}</div></section></div>
<section class="editorial" aria-label="이용 안내"><article class="info-card"><h2>${page.regionLabel} AI 공모전 찾는 법</h2><p>분야와 마감일을 먼저 좁힌 뒤, 관심 있는 공고의 원문에서 참가 자격, 파일 규격, AI 사용 조건, 권리 조항을 확인하세요. 이 보드는 탐색을 돕는 요약이며 주최기관의 공고를 대신하지 않습니다.</p><ul><li>접수중은 빌드 또는 열람 기준일에 접수 기간 안에 있는 공고입니다.</li><li>발표예정은 접수가 끝났지만 실제 결과 발표가 확인되지 않은 공고입니다.</li><li>발표완료는 결과 확인일이 기록된 경우에만 7일 동안 표시됩니다.</li></ul></article><article class="info-card" id="source-policy"><h2>출처와 편집 원칙</h2><p>공고별 URL과 출처 유형은 JSON 데이터에 기록된 값을 사용합니다. 공식 공고, 공식 홈페이지, 공식 접수 페이지, 공식 소셜 채널을 우선하며, 공식 출처가 아닌 링크는 ‘참고 원문’으로 구분합니다.</p><p>날짜나 조건을 임의로 보완하지 않습니다. 일부 공고는 변경될 수 있으므로 출품 직전에 원문을 다시 확인하세요. 정정 제안은 <a href="mailto:${escapeHtml(config.site.author.email)}">${escapeHtml(config.site.author.email)}</a>로 보낼 수 있습니다.</p></article><article class="info-card faq" id="faq"><h2>자주 묻는 질문</h2><details><summary>이 목록의 공모전은 모두 접수 가능한가요?</summary><p>기본 화면은 접수 시작일과 마감일을 기준으로 현재 접수 가능한 항목을 보여줍니다. 시간대와 조기 마감 여부는 원문에서 확인해야 합니다.</p></details><details><summary>발표완료는 어떻게 판단하나요?</summary><p>예정일만으로 발표완료로 바꾸지 않습니다. 실제 결과 발표가 확인되고 확인일이 데이터에 기록된 공고만 표시하며, 7일 뒤 목록에서 제외합니다.</p></details><details><summary>뮤직비디오는 영상인가요, 음악인가요?</summary><p>뮤직비디오로 확인된 공고는 영상과 음악 두 필터에 모두 나타납니다. 같은 공고를 중복 집계하지는 않습니다.</p></details><details><summary>요약만 보고 출품해도 되나요?</summary><p>아니요. 이 보드는 탐색용입니다. 참가비, 자격, 규격, 제출 시각, 저작권과 AI 사용 조건은 반드시 주최기관 원문에서 최종 확인하세요.</p></details></article></section>
</main>
<footer class="footer"><div class="wrap"><p><b>AI 공모전 보드</b> · 공개 공고를 읽기 쉽게 정리합니다.</p><p><a href="${alternate.canonical}">${alternate.regionLabel} 공모전 보기</a> · <a href="mailto:${escapeHtml(config.site.author.email)}">${escapeHtml(config.site.author.email)}</a></p></div></footer>
<button id="back-to-top" type="button" aria-label="맨 위로 이동" aria-hidden="true" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
<script type="application/json" id="initial-data">${initialJson}</script>
<script>(${clientApp.toString()})(${appOptions});</script>
</body>
</html>\n`;
}

const generated = [];
for (const page of Object.values(config.pages)) {
  const raw = JSON.parse(await readFile(new URL(page.dataPath, ROOT), 'utf8'));
  const data = normalizeData(raw);
  const output = new URL(page.path, ROOT);
  await mkdir(dirname(output.pathname), { recursive: true });
  const html = pageHtml(page, data);
  await writeFile(output, html);
  generated.push({ path: page.path, bytes: Buffer.byteLength(html), generatedAt: data.generated_at });
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${Object.values(config.pages).map(page => {
  const item = generated.find(entry => entry.path === page.path);
  return `  <url><loc>${page.canonical}</loc><lastmod>${dateOnly(item.generatedAt)}</lastmod></url>`;
}).join('\n')}\n</urlset>\n`;
await writeFile(new URL('sitemap.xml', ROOT), sitemap);
const llms = `# AI 공모전 보드\n\n> 국내외 AI 이미지, 영상, 디자인, 음악 공모전을 공개 출처 기반으로 정리한 탐색용 정적 사이트입니다.\n\nCanonical pages:\n- ${config.pages.domestic.canonical} : 국내 공모전\n- ${config.pages.overseas.canonical} : 해외 공모전\n\nPrimary data:\n- /ai-contest-board/data/contests.json\n- /ai-contest-board/data/overseas-contests.json\n\nThe JSON files are the source of truth. Page summaries are advisory and do not replace organizer rules. Official or organizer-controlled sources are labeled separately from reference links. Dates, eligibility, fees, rights, and submission requirements must be verified at the linked source before entry.\n\nllms.txt is a nonstandard advisory file. It does not grant permissions, change copyright, or override robots directives.\n`;
await writeFile(new URL('llms.txt', ROOT), llms);
console.log(JSON.stringify({ generated, extra: ['sitemap.xml', 'llms.txt'] }, null, 2));
