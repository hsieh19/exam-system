// 答题逻辑 - 异步API版本
let user, paper, allQuestions = [], currentIndex = 0, userAnswers = {};
let questionTimer, totalSeconds = 0, totalTimerInterval;
let paperRulesMap = {};

const TYPE_NAMES = { single: '单选题', multiple: '多选题', judge: '判断题' };

document.addEventListener('DOMContentLoaded', async function () {
    user = Auth.checkStudent();
    if (!user) return;

    const paperId = sessionStorage.getItem('current_paper_id');
    if (!paperId) { alert('未选择试卷'); window.location.href = 'student.html'; return; }

    paper = await Storage.getPaperById(paperId);
    if (!paper) { alert('试卷不存在'); window.location.href = 'student.html'; return; }

    await initExam();
});

async function initExam() {
    const questions = await Storage.getQuestions();
    const qMap = {};
    questions.forEach(q => qMap[q.id] = q);

    // 构建规则映射
    if (paper.rules && paper.rules.length) {
        paper.rules.forEach(rule => {
            paperRulesMap[rule.type] = {
                score: rule.score,
                partialScore: rule.partialScore || 0,
                timeLimit: rule.timeLimit
            };
        });
    } else {
        paperRulesMap = {
            single: { score: 2, partialScore: 0, timeLimit: 15 },
            multiple: { score: 4, partialScore: 2, timeLimit: 30 },
            judge: { score: 2, partialScore: 0, timeLimit: 20 }
        };
    }

    // 按顺序排列题目
    allQuestions = [];
    if (paper.questions) {
        const types = ['single', 'multiple', 'judge'];
        types.forEach(type => {
            const ids = paper.questions[type] || [];
            ids.forEach(id => {
                if (qMap[id]) {
                    allQuestions.push(qMap[id]);
                }
            });
        });
    }

    document.getElementById('total-num').textContent = allQuestions.length;

    // 开始总计时
    totalTimerInterval = setInterval(() => {
        totalSeconds++;
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        document.getElementById('total-timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);

    showQuestion();
}

function getQuestionConfig(q) {
    const rule = paperRulesMap[q.type];
    return {
        name: TYPE_NAMES[q.type],
        time: rule ? rule.timeLimit : 15,
        score: rule ? rule.score : 2,
        partialScore: rule ? rule.partialScore : 0
    };
}

function showQuestion() {
    if (currentIndex >= allQuestions.length) {
        submitExam();
        return;
    }

    const q = allQuestions[currentIndex];
    const config = getQuestionConfig(q);

    document.getElementById('current-num').textContent = currentIndex + 1;
    document.getElementById('question-type').textContent = config.name;
    document.getElementById('question-content').textContent = q.content;

    const isMultiple = q.type === 'multiple';
    let optionsHtml = '';

    if (q.type === 'judge') {
        optionsHtml = `
      <div class="option-item" data-value="A" onclick="selectOption(this, ${isMultiple})">
        <span class="option-marker">A</span><span class="option-text">正确</span>
      </div>
      <div class="option-item" data-value="B" onclick="selectOption(this, ${isMultiple})">
        <span class="option-marker">B</span><span class="option-text">错误</span>
      </div>`;
    } else {
        optionsHtml = q.options.map((opt, i) => `
      <div class="option-item" data-value="${'ABCDEFGH'[i]}" onclick="selectOption(this, ${isMultiple})">
        <span class="option-marker">${'ABCDEFGH'[i]}</span><span class="option-text">${escapeHtml(opt)}</span>
      </div>`).join('');
    }
    document.getElementById('options-list').innerHTML = optionsHtml;

    document.getElementById('next-btn').textContent = currentIndex === allQuestions.length - 1 ? '提交试卷' : '下一题';

    startQuestionTimer(config.time);
}

function startQuestionTimer(seconds) {
    clearInterval(questionTimer);
    let remaining = seconds;
    const timerEl = document.getElementById('question-timer');

    timerEl.textContent = remaining;
    timerEl.className = 'timer-value';

    questionTimer = setInterval(() => {
        remaining--;
        timerEl.textContent = remaining;

        if (remaining <= 5) timerEl.className = 'timer-value danger';
        else if (remaining <= 10) timerEl.className = 'timer-value warning';

        if (remaining <= 0) {
            clearInterval(questionTimer);
            nextQuestion(true);
        }
    }, 1000);
}

function selectOption(el, isMultiple) {
    if (isMultiple) {
        el.classList.toggle('selected');
    } else {
        document.querySelectorAll('.option-item').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
    }
}

function nextQuestion(isTimeout = false) {
    clearInterval(questionTimer);

    const q = allQuestions[currentIndex];
    const selected = document.querySelectorAll('.option-item.selected');

    if (selected.length === 0) {
        userAnswers[q.id] = null;
    } else if (q.type === 'multiple') {
        userAnswers[q.id] = Array.from(selected).map(el => el.dataset.value).sort();
    } else {
        userAnswers[q.id] = selected[0].dataset.value;
    }

    currentIndex++;
    showQuestion();
}

async function submitExam() {
    clearInterval(questionTimer);
    clearInterval(totalTimerInterval);

    let score = 0;

    allQuestions.forEach(q => {
        const userAnswer = userAnswers[q.id];
        const correctAnswer = q.answer;
        const config = getQuestionConfig(q);

        if (!userAnswer) return;

        if (q.type === 'multiple') {
            const correct = Array.isArray(correctAnswer) ? correctAnswer.sort() : [correctAnswer];
            const user = Array.isArray(userAnswer) ? userAnswer.sort() : [userAnswer];

            const hasWrong = user.some(a => !correct.includes(a));
            if (hasWrong) {
                // 错选不得分
            } else if (user.length === correct.length && user.every((a, i) => a === correct[i])) {
                score += config.score;
            } else if (user.length < correct.length && user.every(a => correct.includes(a))) {
                score += config.partialScore;
            }
        } else {
            if (userAnswer === correctAnswer) {
                score += config.score;
            }
        }
    });

    await Storage.saveRecord({
        paperId: paper.id,
        userId: user.id,
        score,
        totalTime: totalSeconds,
        answers: userAnswers
    });

    alert(`考试完成！\n得分：${score} 分\n用时：${Math.floor(totalSeconds / 60)}分${totalSeconds % 60}秒`);
    sessionStorage.removeItem('current_paper_id');
    window.location.href = 'student.html';
}

window.addEventListener('beforeunload', function (e) {
    if (currentIndex < allQuestions.length) {
        e.preventDefault();
        e.returnValue = '考试尚未完成，确定离开吗？';
    }
});
