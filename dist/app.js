import { TimerEngine } from './timer.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const KEY = 'moru-focus-v1';
const modeNames = { focus: '집중', short: '짧은 휴식', long: '긴 휴식' };
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dayKey = (timestamp) => { const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let stored;
try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { stored = null; }
const data = {
  settings: { goal:4, sound:true, autoBreak:false, theme:'light', ...stored?.settings },
  tasks: Array.isArray(stored?.tasks) ? stored.tasks.filter(t => typeof t.id === 'string' && typeof t.text === 'string') : [],
  records: Array.isArray(stored?.records) ? stored.records.filter(r => r.id && Number.isFinite(r.completedAt) && Number.isFinite(r.durationMs)) : [],
  activeTask: stored?.activeTask || null,
  sessionTask: stored?.sessionTask || null,
};
const completions = [];
let engine = new TimerEngine({state:stored?.timer,onComplete:event => completions.push(event)});
let currentView = 'timer';
let toastTimeout;
let audioContext;
let lastSavedAt = 0;
let storageWarning = false;
let lastStatsDate = '';
let lastRenderSignature = '';

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({...data,timer:engine.getState()}));
    lastSavedAt = Date.now();
  } catch {
    if (!storageWarning) toast('브라우저 저장 공간을 사용할 수 없어 이번 기록은 저장되지 않아요.');
    storageWarning = true;
  }
}
function unlockAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch { /* Timer works even when audio is unavailable. */ }
}
function chime() {
  if (!data.settings.sound || !audioContext || audioContext.state !== 'running') return;
  [659.25, 783.99, 987.77].forEach((frequency,i) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + i * .22;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime(.12,start+.025); gain.gain.exponentialRampToValueAtTime(.001,start+1.2);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(start); oscillator.stop(start+1.3);
  });
}
function activeTask() { return data.tasks.find(t => t.id === data.activeTask && !t.done); }
function hasProgress() { return ['running','paused'].includes(engine.status) && engine.sessionElapsedMs > 0; }
function askToChange(description, action) {
  settle();
  if (!hasProgress()) { action(); return; }
  const dialog = $('#confirm-dialog');
  $('#confirm-description').textContent = description + ' 진행 중인 세션은 초기화되며 완료 기록에는 포함되지 않아요.';
  $('#confirm-ok').onclick = () => { dialog.close(); action(); };
  $('#confirm-cancel').onclick = () => { dialog.close(); renderDuration(); };
  dialog.showModal();
}
$('#confirm-dialog').addEventListener('cancel', () => renderDuration());

function settle() {
  engine.tick();
  while (completions.length) {
    const event = completions.shift();
    if (event.mode === 'focus' && !data.records.some(r => r.id === event.id)) {
      data.records.push({...event, task: data.sessionTask || '나의 집중 시간'});
      toast(`잘했어요! ${Math.round(event.durationMs/60000)}분의 집중을 완료했어요. 잠시 쉬어 가세요.`);
    } else if (event.mode !== 'focus') toast('충분히 쉬셨나요? 다음 집중을 시작할 준비가 됐어요.');
    chime();
    if (event.mode === 'focus' && data.settings.autoBreak) {
      engine.switchMode(event.nextMode).start();
    }
    renderStats(); renderDuration(); persist();
  }
  renderTimer();
  if (lastStatsDate !== dayKey(Date.now())) renderStats();
}

function renderTimer() {
  const remaining = engine.remainingMs;
  const seconds = Math.ceil(remaining / 1000);
  const signature = `${engine.mode}|${engine.status}|${seconds}|${engine.completedFocusSessions}|${engine.totalMs}`;
  if (signature === lastRenderSignature) return;
  lastRenderSignature = signature;
  const minutesText = String(Math.floor(seconds/60)).padStart(2,'0');
  const secondsText = String(seconds % 60).padStart(2,'0');
  const time = $('#time-display');
  const markup = `${minutesText}<span>:</span>${secondsText}`;
  if (time.innerHTML !== markup) time.innerHTML = markup;
  time.setAttribute('aria-label', `${Math.floor(seconds/60)}분 ${seconds%60}초`);
  $('#dial-progress').style.transform = `scaleX(${Math.max(0, Math.min(1, remaining / engine.totalMs))})`;
  document.body.classList.toggle('break-mode', engine.mode !== 'focus');
  $('#dial-label').textContent = engine.mode === 'focus' ? '집중 시간' : '휴식 시간';
  $('#duration-summary').textContent = `${engine.durations[engine.mode]}분 · 시간 변경`;
  const status = engine.status;
  const finalLabel = status === 'running' ? '일시정지' : status === 'paused' ? '계속' : status === 'completed' ? `${engine.nextMode === 'focus' ? '집중' : '휴식'} 시작` : '시작';
  const buttonHTML = icon(status === 'running' ? 'pause' : 'play') + `<span>${finalLabel}</span>`;
  if ($('#start-pause').dataset.label !== finalLabel) {
    $('#start-pause').innerHTML = buttonHTML;
    $('#start-pause').dataset.label = finalLabel;
  }
  $('#ready-label').textContent = status === 'running' ? (engine.mode === 'focus' ? '집중 중' : '휴식 중') : status === 'paused' ? '일시정지' : status === 'completed' ? '완료' : '준비됨';
  $$('[data-mode]').forEach(button => { const selected = button.dataset.mode === engine.mode; button.classList.toggle('selected',selected); button.setAttribute('aria-selected',selected); button.tabIndex = selected ? 0 : -1; });
  const completed = engine.completedFocusSessions;
  const inCycle = completed > 0 && completed % 4 === 0 && (engine.mode !== 'focus' || status === 'completed') ? 4 : completed % 4;
  $$('#session-dots i').forEach((dot,i) => { dot.classList.toggle('done',i<inCycle); dot.classList.toggle('current', i===inCycle && engine.mode==='focus'); });
  $('#session-counter').textContent = `${inCycle} / 4`;
  $('#session-caption').textContent = inCycle === 4 ? '긴 휴식 시간' : `긴 휴식까지 ${4-inCycle}회`;
  document.title = status === 'running' || status === 'paused' ? `${minutesText}:${secondsText} · Pomodoro` : 'Pomodoro';
}
function renderDuration() {
  const minutes = engine.durations.focus;
  $('#duration-input').value = minutes; $('#duration-range').value = minutes;
  $('#duration-range').style.background = `linear-gradient(to right,var(--accent) ${((minutes-1)/179)*100}%,var(--line) ${((minutes-1)/179)*100}%)`;
  $$('[data-minutes]').forEach(b => b.classList.toggle('selected',Number(b.dataset.minutes) === minutes));
  $('#duration-note').textContent = `${minutes}분 집중 · ${engine.durations.short}분 휴식`;
}
function changeDuration(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes<1 || minutes>180) { toast('집중 시간은 1~180 사이의 정수로 입력해 주세요.'); renderDuration(); return; }
  if (minutes === engine.durations.focus) { renderDuration(); return; }
  const apply = () => { engine.setDuration('focus',minutes); renderDuration(); settle(); persist(); };
  if (engine.mode === 'focus') askToChange(`공부 시간을 ${minutes}분으로 변경할까요?`,apply);
  else apply();
}
function renderStats() {
  const today = dayKey(Date.now()); lastStatsDate = today;
  const todays = data.records.filter(r => dayKey(r.completedAt) === today);
  const minutes = Math.floor(todays.reduce((total,r) => total+r.durationMs,0)/60000);
  const sessions = todays.length;
  $('#today-time').innerHTML = `${minutes}<small>분</small>`;
  $('#today-sessions').innerHTML = `${sessions}<small>회</small>`;
  $('#goal-caption').textContent = `${sessions} / ${data.settings.goal} 세션`;
  $('#goal-progress').style.width = `${Math.min(100,sessions/data.settings.goal*100)}%`;
  $('#goal-message').textContent = sessions>=data.settings.goal ? '오늘의 목표를 달성했어요. 수고했어요!' : sessions ? '차곡차곡, 좋은 습관이 쌓이고 있어요.' : '한 번의 집중부터 차근차근.';
  $('#record-time').textContent = `${minutes}분`; $('#record-sessions').textContent = `${sessions}회`; $('#record-total').textContent = `${data.records.length}회`;
  const days = Array.from({length:7},(_,i) => { const date = new Date(); date.setHours(12,0,0,0); date.setDate(date.getDate()-6+i); const key=dayKey(date); return {date,key,minutes:Math.round(data.records.filter(r=>dayKey(r.completedAt)===key).reduce((n,r)=>n+r.durationMs,0)/60000)}; });
  const max = Math.max(25,...days.map(d => d.minutes));
  $('#week-chart').innerHTML = days.map(d => `<div class="chart-column ${d.key===today?'today':''}"><span class="chart-value">${d.minutes}</span><div class="chart-bar" style="height:${Math.max(2,d.minutes/max*160)}px" role="img" aria-label="${d.date.getMonth()+1}월 ${d.date.getDate()}일 ${d.minutes}분"></div><span>${d.date.toLocaleDateString('ko-KR',{weekday:'short'})}</span><span>${d.date.getMonth()+1}.${d.date.getDate()}</span></div>`).join('');
  $('#history-list').innerHTML = data.records.length ? [...data.records].sort((a,b)=>b.completedAt-a.completedAt).slice(0,100).map(r => `<div class="history-row"><span class="history-icon">${icon('check')}</span><div class="history-detail"><strong>${escapeHTML(r.task||'나의 집중 시간')}</strong><small>${new Date(r.completedAt).toLocaleString('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></div><span class="history-duration">${Math.round(r.durationMs/60000)}분</span></div>`).join('') : `<div class="empty-state">${icon('leaf')}아직 완료한 집중이 없어요.<br>첫 번째 집중을 마치면 이곳에 기록돼요.</div>`;
}
function renderTasks() {
  const remaining = data.tasks.filter(t => !t.done).length;
  $('#task-count').textContent = remaining;
  $('#task-progress').textContent = `${data.tasks.length-remaining} / ${data.tasks.length}개 완료`;
  const task = activeTask();
  $('#active-task-row').hidden = !task;
  if (task) $('#active-task-row').innerHTML = `<button class="icon-button" data-complete="${escapeHTML(task.id)}" aria-label="집중할 일 완료">${icon('check')}</button><span>${escapeHTML(task.text)}</span><span style="margin-left:auto;flex-shrink:0">집중할 일</span>`;
  $('#task-list').innerHTML = data.tasks.length ? [...data.tasks].sort((a,b)=>Number(a.done)-Number(b.done)).map(t => `<div class="task-row ${t.done?'done':''}"><button class="task-check" data-complete="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.text)} ${t.done?'완료 취소':'완료'}" aria-pressed="${Boolean(t.done)}">${t.done?icon('check'):''}</button><span class="task-text">${escapeHTML(t.text)}</span>${!t.done?`<button class="task-focus" data-focus-task="${escapeHTML(t.id)}">${t.id===data.activeTask?'선택됨':'집중하기'}</button>`:''}<button class="icon-button delete-task" data-delete-task="${escapeHTML(t.id)}" aria-label="${escapeHTML(t.text)} 삭제">${icon('close')}</button></div>`).join('') : `<div class="empty-state">${icon('list')}오늘 해내고 싶은 일 하나를 적어 보세요.<br>작은 시작이면 충분해요.</div>`;
}
function addTask(input) {
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  const task = {id:crypto.randomUUID(),text:text.slice(0,160),done:false,createdAt:Date.now()};
  data.tasks.push(task); data.activeTask=task.id; input.value=''; renderTasks(); persist(); toast('집중할 일을 추가했어요.');
}
function showView(view) {
  currentView = ['records', 'tasks'].includes(view) ? view : 'timer';
  $('#view-timer').hidden = false;
  $('#view-records').hidden = currentView !== 'records';
  $('#view-tasks').hidden = currentView !== 'tasks';
  $$('[data-view]').forEach(b => b.classList.toggle('active',b.dataset.view===view));
  const dialog = $('#library-dialog');
  if (currentView === 'timer') {
    if (dialog.open) dialog.close();
    return;
  }
  $('#breadcrumb-current').textContent = currentView === 'records' ? '기록' : '할 일';
  if (currentView === 'records') renderStats();
  else renderTasks();
  if (!dialog.open) dialog.showModal();
}
function toggleTimer() {
  unlockAudio(); settle();
  if (engine.status === 'running') engine.pause();
  else {
    if (engine.status === 'completed') engine.switchMode(engine.nextMode);
    if (engine.status === 'idle' && engine.mode === 'focus') data.sessionTask=activeTask()?.text || null;
    engine.start();
  }
  settle(); persist();
}
$('#start-pause').addEventListener('click',toggleTimer);
$('#reset-timer').addEventListener('click',() => askToChange('타이머를 처음부터 시작할까요?',()=>{engine.reset();settle();persist();toast('타이머를 초기화했어요.');}));
$$('[data-mode]').forEach(button => button.addEventListener('click',() => {
  if (button.dataset.mode === engine.mode) return;
  askToChange(`${modeNames[button.dataset.mode]} 모드로 전환할까요?`,()=>{engine.switchMode(button.dataset.mode);settle();persist();});
}));
$('.mode-tabs').addEventListener('keydown',event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault(); const buttons=$$('[data-mode]'); const index=buttons.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;
  buttons[next].focus(); buttons[next].click();
});
$('#duration-input').addEventListener('change',event=>changeDuration(event.target.value));
$('#duration-input').addEventListener('blur',event=>{if(Number(event.target.value)!==engine.durations.focus&&!$('#confirm-dialog').open)changeDuration(event.target.value);});
$('#duration-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.target.blur();}});
$('#duration-range').addEventListener('input',event=>{const value=Number(event.target.value);$('#duration-input').value=value;event.target.style.background=`linear-gradient(to right,var(--accent) ${((value-1)/179)*100}%,var(--line) ${((value-1)/179)*100}%)`;});
$('#duration-range').addEventListener('change',event=>changeDuration(event.target.value));
$('#duration-minus').addEventListener('click',()=>changeDuration(Math.max(1,engine.durations.focus-5)));
$('#duration-plus').addEventListener('click',()=>changeDuration(Math.min(180,engine.durations.focus+5)));
$$('[data-minutes]').forEach(button=>button.addEventListener('click',()=>changeDuration(button.dataset.minutes)));
$('#duration-edit').addEventListener('click',()=>{
  if(engine.mode!=='focus'){openSettings();return;}
  renderDuration();
  $('#duration-dialog').showModal();
  $('#duration-input').focus();
  $('#duration-input').select();
});
$('#library-dialog').addEventListener('close',()=>{
  currentView = 'timer';
  $$('[data-view]').forEach(button => button.classList.remove('active'));
});
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
$('.brand').addEventListener('click',event=>{event.preventDefault();showView('timer');});
$('#quick-task-form').addEventListener('submit',event=>{event.preventDefault();addTask($('#quick-task-input'));});
$('#task-form').addEventListener('submit',event=>{event.preventDefault();addTask($('#task-input'));});
document.addEventListener('click',event=>{
  const complete=event.target.closest('[data-complete]'); const remove=event.target.closest('[data-delete-task]'); const focus=event.target.closest('[data-focus-task]');
  if(complete){const task=data.tasks.find(t=>t.id===complete.dataset.complete);if(task){task.done=!task.done;renderTasks();persist();}}
  if(remove){data.tasks=data.tasks.filter(t=>t.id!==remove.dataset.deleteTask);renderTasks();persist();}
  if(focus){data.activeTask=focus.dataset.focusTask;renderTasks();persist();showView('timer');toast('집중할 일을 선택했어요. 준비되면 시작해 주세요.');}
});

function applyTheme() {
  const colors = { light:'#a3a6a8', mint:'#d9eae8', dark:'#272b31' };
  if (!Object.hasOwn(colors, data.settings.theme)) data.settings.theme = 'light';
  document.body.dataset.theme=data.settings.theme;
  $('#theme-select').value=data.settings.theme;
  $('meta[name="theme-color"]').content=colors[data.settings.theme];
}
$('#theme-select').addEventListener('change',event=>{data.settings.theme=event.target.value;applyTheme();persist();});
$('#fullscreen-toggle').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('이 브라우저에서는 전체 화면을 사용할 수 없어요. F11 키를 사용해 보세요.');}
});
document.addEventListener('fullscreenchange',()=>$('#fullscreen-toggle').setAttribute('aria-label',document.fullscreenElement?'전체 화면 종료':'전체 화면'));
function openSettings() {
  $('#short-duration').value=engine.durations.short; $('#long-duration').value=engine.durations.long;
  $('#daily-goal').value=data.settings.goal; $('#sound-enabled').checked=data.settings.sound; $('#auto-break').checked=data.settings.autoBreak;
  $('#settings-dialog').showModal();
}
$('#settings-open').addEventListener('click',openSettings);
$$('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('#settings-form').addEventListener('submit',event=>{
  event.preventDefault();
  const short=Number($('#short-duration').value),long=Number($('#long-duration').value),goal=Number($('#daily-goal').value);
  if(!Number.isInteger(short)||short<1||short>60||!Number.isInteger(long)||long<1||long>60||!Number.isInteger(goal)||goal<1||goal>24){toast('휴식은 1~60분, 목표는 1~24회로 입력해 주세요.');return;}
  const sound=$('#sound-enabled').checked, autoBreak=$('#auto-break').checked;
  const apply=()=>{engine.setDuration('short',short).setDuration('long',long);Object.assign(data.settings,{goal,sound,autoBreak});renderDuration();renderStats();settle();persist();toast('나에게 맞는 설정을 저장했어요.');};
  $('#settings-dialog').close();
  if((engine.mode==='short'&&short!==engine.durations.short)||(engine.mode==='long'&&long!==engine.durations.long))askToChange('현재 휴식 시간을 변경할까요?',apply);else apply();
});
$('#export-records').addEventListener('click',()=>{
  if(!data.records.length){toast('집중 세션을 완료하면 기록을 내보낼 수 있어요.');return;}
  const cell=value=>`"${String(value).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')}"`;
  const rows=[['완료 시각','집중한 일','집중 시간(분)'],...data.records.map(r=>[new Date(r.completedAt).toLocaleString('ko-KR'),r.task||'나의 집중 시간',Math.round(r.durationMs/60000)])];
  const blob=new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`Pomodoro-${dayKey(Date.now())}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.addEventListener('keydown',event=>{
  if(event.key===','&&(event.ctrlKey||event.metaKey)){event.preventDefault();if(!$('dialog[open]'))openSettings();return;}
  if(event.code!=='Space'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||$('dialog[open]')||currentView!=='timer')return;
  if(event.target.closest('input,textarea,button,a,select,[contenteditable="true"]'))return;
  event.preventDefault();toggleTimer();
});
document.addEventListener('visibilitychange',()=>{settle();persist();});
window.addEventListener('pagehide',persist);
window.addEventListener('storage',event=>{
  if(event.key!==KEY||!event.newValue)return;
  try{const value=JSON.parse(event.newValue);if(!value.timer)return;engine=new TimerEngine({state:value.timer,onComplete:e=>completions.push(e)});Object.assign(data,{settings:value.settings,tasks:value.tasks,records:value.records,activeTask:value.activeTask,sessionTask:value.sessionTask});lastRenderSignature='';applyTheme();renderDuration();renderStats();renderTasks();renderTimer();}catch{/* Keep the current valid state. */}
});
applyTheme();renderDuration();renderStats();renderTasks();settle();persist();
setInterval(()=>{settle();if(engine.status==='running'&&Date.now()-lastSavedAt>5000)persist();},250);
