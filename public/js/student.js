// 考生界面逻辑 - 异步API版本
let user = null;

document.addEventListener('DOMContentLoaded', async function () {
  user = Auth.checkStudent();
  if (user) {
    Auth.updateUserInfo();
    await loadExams();
    initNavigation();
  }
});

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', async function () {
      const page = this.dataset.page;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      this.classList.add('active');
      document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
      document.getElementById(`page-${page}`).classList.remove('hidden');
      if (page === 'exam') await loadExams();
      else if (page === 'ranking') await loadPaperOptions();
    });
  });

  document.getElementById('ranking-paper-select').addEventListener('change', async function () {
    if (this.value) await loadRanking(this.value);
  });
}

let countdownIntervals = [];

async function loadExams() {
  const papers = await Storage.getPapersForUser(user.id);
  const container = document.getElementById('exam-list');

  // 清除旧的定时器
  countdownIntervals.forEach(clearInterval);
  countdownIntervals = [];

  if (papers.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>暂无考试</h3><p>目前没有分配给您的考试</p></div>';
    return;
  }

  container.innerHTML = papers.map(paper => {
    const now = new Date();
    const startTime = paper.startTime ? new Date(paper.startTime.replace(' ', 'T')) : null;
    const deadline = paper.deadline ? new Date(paper.deadline.replace(' ', 'T')) : null;

    let status = 'running';
    if (startTime && now < startTime) {
      status = 'not_started';
    } else if (deadline && now > deadline) {
      status = 'ended';
    }

    const isOngoing = paper.isOngoing && status === 'running';

    let btnText;
    if (status === 'not_started') {
      btnText = '考试未开始';
    } else if (status === 'ended') {
      btnText = '考试已结束';
    } else {
      btnText = isOngoing ? '继续考试' : '开始答题';
    }

    const btnDisabledAttr = status === 'running' ? '' : 'disabled';
    const examTimeStart = paper.startTime ? formatFullDateTime(paper.startTime) : (paper.publishDate ? formatFullDateTime(paper.publishDate) : '-');
    const examTimeEnd = paper.deadline ? formatFullDateTime(paper.deadline) : '-';
    const examTimeText = (examTimeStart === '-' && examTimeEnd === '-') ? '-' : `${examTimeStart} ~ ${examTimeEnd}`;
    const pusherName = paper.pusherName || '未知用户';

    return `
      <div class="exam-item ${paper.isOngoing ? 'is-ongoing' : ''}">
        <div class="exam-main-info">
          <div class="exam-title-group">
            <div class="exam-title-main">
              <div class="exam-title-left">
                <div class="exam-title-row exam-title-row-main">
                  <span class="exam-title-label">试卷名称：</span>
                  <span class="exam-title-name">${escapeHtml(paper.name)}</span>
                </div>
                <div class="exam-title-row">
                  <span class="exam-title-label">推送人：</span>
                  <span class="exam-pusher-inline">${escapeHtml(pusherName)}</span>
                </div>
              </div>
              <span class="exam-meta-separator">|</span>
              <div class="exam-examtime-block">
                <div class="exam-examtime-label">考试时间</div>
                <div class="exam-examtime-inline">${examTimeText}</div>
              </div>
            </div>
            <button class="btn ${paper.isOngoing ? 'btn-warning' : 'btn-primary'} btn-start-exam mobile-only-btn" data-id="${paper.id}" onclick="safeOnclick(this, 'startExam', ['id'])" ${btnDisabledAttr}>
              ${btnText}
            </button>
          </div>
        </div>
        <div class="exam-actions">
          <div class="countdown-timer ${
            (status === 'running' && paper.deadline) || (status === 'not_started' && paper.startTime) ? '' : 'hidden'
          }" id="countdown-${paper.id}" data-start="${paper.startTime || ''}" data-deadline="${paper.deadline || ''}" data-is-ongoing="${paper.isOngoing ? '1' : '0'}" data-status="${status}">
            <span class="timer-label">${status === 'not_started' ? '距离开始：' : '距离截止：'}</span>
            <span class="timer-value">--:--:--</span>
          </div>
          <button class="btn ${paper.isOngoing ? 'btn-warning' : 'btn-primary'} btn-start-exam desktop-only-btn" data-id="${paper.id}" onclick="safeOnclick(this, 'startExam', ['id'])" ${btnDisabledAttr}>
            ${btnText}
          </button>
        </div>
      </div>`;
  }).join('');

  papers.forEach(paper => {
    const timer = document.getElementById(`countdown-${paper.id}`);
    if (!timer) return;
    if (!paper.startTime && !paper.deadline) return;
    startCountdown(paper.id);
  });
}

function startCountdown(paperId) {
  const timerContainer = document.getElementById(`countdown-${paperId}`);
  if (!timerContainer) return;
  const timerValue = timerContainer.querySelector('.timer-value');
  const timerLabel = timerContainer.querySelector('.timer-label');
  const examItem = timerContainer.closest('.exam-item');
  const startBtns = examItem ? examItem.querySelectorAll('.btn-start-exam') : [];
  const startStr = timerContainer.dataset.start || '';
  const deadlineStr = timerContainer.dataset.deadline || '';
  const isOngoing = timerContainer.dataset.isOngoing === '1';
  const hasStart = !!startStr;
  const hasDeadline = !!deadlineStr;
  const startDate = hasStart ? new Date(startStr.replace(' ', 'T') + ':00') : null;
  const deadline = hasDeadline ? new Date(deadlineStr.replace(' ', 'T') + ':00') : null;
  let mode = hasStart ? 'start' : 'deadline';

  function update() {
    const now = new Date();
    const target = mode === 'start' ? startDate : deadline;
    if (!target) return false;
    const diff = target.getTime() - now.getTime();

    if (diff <= 0) {
      if (mode === 'start') {
        startBtns.forEach(btn => {
          btn.disabled = false;
          btn.textContent = isOngoing ? '继续考试' : '开始答题';
        });
        if (hasDeadline) {
          mode = 'deadline';
          if (timerLabel) timerLabel.textContent = '距离截止：';
          return true;
        }
        if (timerLabel) timerLabel.textContent = '';
        timerValue.textContent = '进行中';
        timerContainer.classList.remove('hidden');
        return false;
      } else {
        timerValue.textContent = '已截止';
        timerContainer.classList.remove('hidden');
        startBtns.forEach(btn => {
          btn.disabled = true;
          btn.textContent = '考试已结束';
        });
        return false;
      }
    }

    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    timerValue.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    timerContainer.classList.remove('hidden');
    return true;
  }

  if (update()) {
    const interval = setInterval(() => {
      if (!update()) {
        clearInterval(interval);
      }
    }, 1000);
    countdownIntervals.push(interval);
  }
}

function startExam(paperId) {
  sessionStorage.setItem('current_paper_id', paperId);
  window.location.href = 'exam.html';
}

async function loadPaperOptions() {
  const papers = await Storage.getRankingPapers();
  const select = document.getElementById('ranking-paper-select');
  select.innerHTML = '<option value="">请选择试卷</option>' +
    papers.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

async function loadRanking(paperId) {
  const data = await Storage.getRanking(paperId);
  const container = document.getElementById('ranking-content');

  // 后端现在返回的是 { totalAssigned, ranking }
  const ranking = data.ranking || [];
  const passScore = data.passScore != null ? Number(data.passScore) : 0;
  const totalAssigned = data.totalAssigned || ranking.length || 0;

  if (ranking.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>暂无考试记录</h3></div>';
    return;
  }

  const myRecord = ranking.find(r => r.userId === user.id);

  let html = myRecord ? (() => {
    const passed = passScore > 0 ? myRecord.score >= passScore : true;
    const label = passed ? '及格' : '不及格';
    const cls = passed ? 'text-success' : 'text-danger';
    return `
    <div class="my-score mb-6">
      <div class="score-item"><span class="score-label">考生：</span><span class="score-value">${escapeHtml(user.username)}</span></div>
      <div class="score-item"><span class="score-label">得分：</span><span class="score-value">${myRecord.score}</span></div>
      <div class="score-item"><span class="score-label">成绩：</span><span class="score-value ${cls}">${label}</span></div>
      <div class="score-item"><span class="score-label">排名：</span><span class="score-value">${myRecord.rank}/${totalAssigned}</span></div>
      <div class="score-item"><span class="score-label">答题用时：</span><span class="score-value">${formatDuration(myRecord.totalTime, true)}</span></div>
      <div class="score-item"><span class="score-label">交卷时间：</span><span class="score-value">${formatFullDateTime(myRecord.submitDate)}</span></div>
    </div>`;
  })() : '';

  html += `<div class="table-container"><table class="data-table">
    <thead><tr><th>排名</th><th>考生</th><th>得分</th><th>成绩</th><th>用时</th><th style="width:180px;">交卷时间</th></tr></thead>
    <tbody>${ranking.map(r => {
      const passed = passScore > 0 ? r.score >= passScore : true;
      const label = passed ? '及格' : '不及格';
      const cls = passed ? 'text-success' : 'text-danger';
      return `
      <tr ${r.userId === user.id ? 'style="background:var(--primary-light);"' : ''}>
        <td>${r.rank <= 3 ? `<span class="rank-badge rank-${r.rank}">${r.rank}</span>` : `${r.rank}/${totalAssigned}`}</td>
        <td>${escapeHtml(r.username)}${r.userId === user.id ? ' (我)' : ''}</td>
        <td><strong>${r.score}</strong></td>
        <td><span class="${cls}">${label}</span></td>
        <td>${formatDuration(r.totalTime, true)}</td>
        <td style="white-space:nowrap;">${formatFullDateTime(r.submitDate)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;

  container.innerHTML = html;
}
