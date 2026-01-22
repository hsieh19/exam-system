// 答题逻辑 - 异步API版本
let user, paper, allQuestions = [], currentIndex = 0, userAnswers = {};
let questionTimer, totalSeconds = 0, totalTimerInterval;
let paperRulesMap = {};
let lastQuestionStartTime = null;

const TYPE_NAMES = { single: '单选题', multiple: '多选题', judge: '判断题' };

document.addEventListener('DOMContentLoaded', async function () {
    user = Auth.checkStudent();
    if (!user) return;

    const paperId = sessionStorage.getItem('current_paper_id');
    if (!paperId) { showAlert('未选择试卷', () => window.location.href = 'student.html'); return; }

    try {
        const examData = await Storage.getExamPaper(paperId);
        if (!examData || examData.error) {
            const msg = examData && examData.error ? examData.error : '无法加载试卷';
            showAlert(msg, () => window.location.href = 'student.html');
            return;
        }

        paper = examData.paper;
        allQuestions = examData.questions || [];
        const session = examData.session;

        if (!paper || !allQuestions.length) {
            showAlert('试卷数据不完整或题目为空', () => window.location.href = 'student.html');
            return;
        }

        // 同步历史答案和进度
        if (session) {
            userAnswers = session.answers || {};
            lastQuestionStartTime = session.lastQuestionStartTime;
            
            // 计算总考试时间（从首次进入开始计算）
            const start = new Date(session.startTime);
            const now = new Date();
            totalSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);
            
            // 根据已答题目数量确定当前索引
            currentIndex = Object.keys(userAnswers).length;
        }

        await initExam();
    } catch (e) {
        showAlert('加载试卷失败: ' + e.message, () => window.location.href = 'student.html');
    }
});

async function initExam() {
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

    document.getElementById('total-num').textContent = allQuestions.length;

    // 开始总计时
    totalTimerInterval = setInterval(() => {
        totalSeconds++;
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('total-timer').textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    }, 1000);

    // 自动追赶计时逻辑
    if (lastQuestionStartTime) {
        await catchUpQuestions();
    } else {
        lastQuestionStartTime = new Date().toISOString();
        showQuestion();
    }
}

async function catchUpQuestions() {
    let now = new Date();
    let startTime = new Date(lastQuestionStartTime);
    let skipped = 0;
    
    while (currentIndex < allQuestions.length) {
        const q = allQuestions[currentIndex];
        const config = getQuestionConfig(q);
        const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
        
        if (elapsed >= config.time) {
            // 这题已经超时了
            userAnswers[q.id] = null;
            currentIndex++;
            skipped++;
            // 更新 startTime 为上一题本该结束的时间，继续检查下一题
            startTime = new Date(startTime.getTime() + config.time * 1000);
        } else {
            // 找到了还没超时的题目
            lastQuestionStartTime = startTime.toISOString();
            
            // 如果有跳过的题目，同步到后端
            if (skipped > 0) {
                Storage.updateExamSession(paper.id, userAnswers, lastQuestionStartTime).catch(console.error);
                showAlert(`检测到离开期间有 ${skipped} 道题目超时，已自动跳过`);
            }
            
            showQuestion(config.time - elapsed);
            return;
        }
    }
    
    // 如果所有题都追赶完了
    if (currentIndex >= allQuestions.length) {
        if (skipped > 0) {
            await Storage.updateExamSession(paper.id, userAnswers, startTime.toISOString()).catch(console.error);
        }
        submitExam();
    }
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

function showQuestion(customTime = null) {
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

    startQuestionTimer(customTime !== null ? customTime : config.time);
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

    // 切换到下一题，记录下一题的开始时间为当前时间
    lastQuestionStartTime = new Date().toISOString();
    
    // 自动保存进度到后端，包括下一题的开始时间
    Storage.updateExamSession(paper.id, userAnswers, lastQuestionStartTime).catch(err => {
        console.error('Failed to auto-save session:', err);
    });

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

    showAlert(`考试完成！\n得分：${score} 分\n用时：${formatDuration(totalSeconds, true)}`, () => {
        sessionStorage.removeItem('current_paper_id');
        window.location.href = 'student.html';
    });
}

window.addEventListener('beforeunload', function (e) {
    if (currentIndex < allQuestions.length) {
        e.preventDefault();
        e.returnValue = '考试尚未完成，确定离开吗？';
    }
});
