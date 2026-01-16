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

async function loadExams() {
  const papers = await Storage.getPapersForUser(user.id);
  const container = document.getElementById('exam-list');

  if (papers.length === 0) {
    container.innerHTML = '<div class="empty-state"><h3>暂无考试</h3><p>目前没有分配给您的考试</p></div>';
    return;
  }

  container.innerHTML = papers.map(paper => {
    return `
      <div class="exam-item">
        <div class="exam-info">
          <h3>${escapeHtml(paper.name)}</h3>
          <div class="exam-meta">
            <span>推送日期: ${paper.publishDate || '-'}</span>
            <span>截止日期: ${paper.deadline || '-'}</span>
          </div>
        </div>
        <button class="btn btn-primary" onclick="startExam('${paper.id}')">开始答题</button>
      </div>`;
  }).join('');
}

function startExam(paperId) {
  sessionStorage.setItem('current_paper_id', paperId);
  window.location.href = 'exam.html';
}

async function loadPaperOptions() {
  const papers = await Storage.getPapers();
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
  const formatTime = (s) => `${Math.floor(s / 60)}分${s % 60}秒`;

  let html = myRecord ? `
    <div class="my-score mb-6">
      <div class="score-item"><span class="score-label">答题用户：</span><span class="score-value">${user.username}</span></div>
      <div class="score-item"><span class="score-label">得分：</span><span class="score-value">${myRecord.score}</span></div>
      <div class="score-item"><span class="score-label">排名：</span><span class="score-value">${myRecord.rank}/${totalAssigned}</span></div>
      <div class="score-item"><span class="score-label">答题用时：</span><span class="score-value">${formatTime(myRecord.totalTime)}</span></div>
    </div>` : '';

  html += `<div class="table-container"><table class="data-table">
    <thead><tr><th>排名</th><th>答题用户</th><th>得分</th><th>用时</th></tr></thead>
    <tbody>${ranking.map(r => `
      <tr ${r.userId === user.id ? 'style="background:var(--primary-light);"' : ''}>
        <td>${r.rank <= 3 ? `<span class="rank-badge rank-${r.rank}">${r.rank}</span>` : `${r.rank}/${totalAssigned}`}</td>
        <td>${escapeHtml(r.username)}${r.userId === user.id ? ' (我)' : ''}</td>
        <td><strong>${r.score}</strong></td>
        <td>${formatTime(r.totalTime)}</td>
      </tr>`).join('')}</tbody></table></div>`;

  container.innerHTML = html;
}
