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
    return `
      <div class="exam-item ${paper.isOngoing ? 'is-ongoing' : ''}">
        <div class="exam-main-info">
          <div class="exam-title-group">
            <h3>${escapeHtml(paper.name)}</h3>
            <button class="btn ${paper.isOngoing ? 'btn-warning' : 'btn-primary'} btn-start-exam mobile-only-btn" data-paper-id="${paper.id}" onclick="startExam('${paper.id}')">
              ${paper.isOngoing ? '继续考试' : '开始答题'}
            </button>
          </div>
          <div class="exam-meta">
            <span class="meta-push">推送日期: ${formatFullDateTime(paper.publishDate)}</span>
            <span class="meta-deadline">截止日期: ${formatFullDateTime(paper.deadline)}</span>
          </div>
        </div>
        <div class="exam-actions">
          <div class="countdown-timer hidden" id="countdown-${paper.id}" data-deadline="${paper.deadline}">
            距离截止：<span class="timer-value">--:--:--</span>
          </div>
          <button class="btn ${paper.isOngoing ? 'btn-warning' : 'btn-primary'} btn-start-exam desktop-only-btn" data-paper-id="${paper.id}" onclick="startExam('${paper.id}')">
            ${paper.isOngoing ? '继续考试' : '开始答题'}
          </button>
        </div>
      </div>`;
  }).join('');

  // 启动倒计时
  papers.forEach(paper => {
    if (paper.deadline) {
      startCountdown(paper.id, paper.deadline);
    }
  });
}

function startCountdown(paperId, deadlineStr) {
  const timerContainer = document.getElementById(`countdown-${paperId}`);
  const timerValue = timerContainer.querySelector('.timer-value');
  const startBtn = document.getElementById(`btn-start-${paperId}`);
  
  // 处理日期格式，将 "YYYY-MM-DD HH:mm" 转换为 "YYYY-MM-DDTHH:mm:00"
  const deadline = new Date(deadlineStr.replace(' ', 'T') + ':00');

  function update() {
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();

    if (diff <= 0) {
      timerValue.textContent = '已截止';
      timerContainer.classList.remove('hidden');
      startBtn.disabled = true;
      startBtn.textContent = '考试已截止';
      return false;
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
  const totalAssigned = data.totalAssigned || ranking.length || 0;

  if (ranking.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>暂无考试记录</h3></div>';
    return;
  }

  const myRecord = ranking.find(r => r.userId === user.id);

  let html = myRecord ? `
    <div class="my-score mb-6">
      <div class="score-item"><span class="score-label">答题用户：</span><span class="score-value">${user.username}</span></div>
      <div class="score-item"><span class="score-label">得分：</span><span class="score-value">${myRecord.score}</span></div>
      <div class="score-item"><span class="score-label">排名：</span><span class="score-value">${myRecord.rank}/${totalAssigned}</span></div>
      <div class="score-item"><span class="score-label">答题用时：</span><span class="score-value">${formatDuration(myRecord.totalTime, true)}</span></div>
      <div class="score-item"><span class="score-label">交卷时间：</span><span class="score-value">${formatFullDateTime(myRecord.submitDate)}</span></div>
    </div>` : '';

  html += `<div class="table-container"><table class="data-table">
    <thead><tr><th>排名</th><th>答题用户</th><th>得分</th><th>用时</th><th style="width:180px;">交卷时间</th></tr></thead>
    <tbody>${ranking.map(r => `
      <tr ${r.userId === user.id ? 'style="background:var(--primary-light);"' : ''}>
        <td>${r.rank <= 3 ? `<span class="rank-badge rank-${r.rank}">${r.rank}</span>` : `${r.rank}/${totalAssigned}`}</td>
        <td>${escapeHtml(r.username)}${r.userId === user.id ? ' (我)' : ''}</td>
        <td><strong>${r.score}</strong></td>
        <td>${formatDuration(r.totalTime, true)}</td>
        <td style="white-space:nowrap;">${formatFullDateTime(r.submitDate)}</td>
      </tr>`).join('')}</tbody></table></div>`;

  container.innerHTML = html;
}
