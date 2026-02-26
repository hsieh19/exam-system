'use strict';

const LETTER_CHARS = 'ABCDEFGH';

/**
 * 简单字符串哈希（用于选项打乱的确定性排序）
 */
function hashString(str) {
    let hash = 0;
    if (!str) return hash;
    for (let i = 0; i < str.length; i++) {
        const chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash;
}

/**
 * 将试卷规则数组转换为 { type: { score, partialScore, timeLimit } } 映射
 */
function buildRulesMap(rules) {
    if (Array.isArray(rules) && rules.length > 0) {
        const map = {};
        rules.forEach(rule => {
            if (!rule || !rule.type) return;
            map[rule.type] = {
                score: rule.score == null ? 0 : Number(rule.score),
                partialScore: rule.partialScore == null ? 0 : Number(rule.partialScore),
                timeLimit: rule.timeLimit == null ? null : Number(rule.timeLimit)
            };
        });
        return map;
    }
    return {
        single: { score: 2, partialScore: 0, timeLimit: 15 },
        multiple: { score: 4, partialScore: 2, timeLimit: 30 },
        judge: { score: 2, partialScore: 0, timeLimit: 20 }
    };
}

/**
 * 标准化答案值：字符串逗号分隔 → 数组，其余原样返回
 */
function normalizeAnswerValue(answer) {
    if (!answer) return answer;
    if (Array.isArray(answer)) return answer.slice();
    if (typeof answer === 'string') {
        const parts = answer.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 1) return parts;
        return answer;
    }
    return answer;
}

/**
 * 根据选项映射表（letterMap）转换答案字母
 * @param {*} answer - 原始答案
 * @param {Object} letterMap - { 'A': 'C', 'B': 'A', ... } 映射
 */
function mapAnswerWithLetterMap(answer, letterMap) {
    if (!answer || !letterMap) return answer;
    if (Array.isArray(answer)) {
        return answer.map(value => letterMap[value] || value);
    }
    if (typeof answer === 'string') {
        const parts = answer.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 1) {
            return parts.map(value => letterMap[value] || value);
        }
        return letterMap[answer] || answer;
    }
    return answer;
}

/**
 * 格式化答案用于显示（空答案 → '未作答'）
 */
function formatAnswerKey(answer) {
    if (answer == null) return '未作答';
    if (Array.isArray(answer)) {
        if (answer.length === 0) return '未作答';
        return answer.slice().sort().join(',');
    }
    if (typeof answer === 'string') {
        const trimmed = answer.trim();
        return trimmed || '未作答';
    }
    return String(answer);
}

/**
 * 获取题目的基础选项列表
 */
function getBaseOptions(q) {
    if (q.type === 'judge') return ['正确', '错误'];
    return Array.isArray(q.options) ? q.options : [];
}

/**
 * 根据用户 ID 和题目 ID 计算选项打乱后的映射表
 * @returns {{ optionItems: Array, letterMap: Object }}
 */
function buildShuffledOptions(q, userId, baseOptions) {
    const optionItems = [];
    const letterMap = {};

    const indices = baseOptions.map((_, index) => index);
    indices.sort((a, b) => {
        const ha = hashString(String(userId) + q.id + String(a));
        const hb = hashString(String(userId) + q.id + String(b));
        return ha === hb ? a - b : ha - hb;
    });

    indices.forEach((origIndex, position) => {
        const label = LETTER_CHARS[position] || '';
        const text = baseOptions[origIndex];
        optionItems.push({ label, text });
        const originalLabel = LETTER_CHARS[origIndex] || '';
        if (originalLabel) {
            letterMap[originalLabel] = label;
        }
    });

    return { optionItems, letterMap };
}

/**
 * 构建题目的选项列表（支持打乱和非打乱模式）
 * @returns {{ optionItems: Array, letterMap: Object }}
 */
function buildQuestionOptions(q, userId, shuffleOptions) {
    const baseOptions = getBaseOptions(q);

    if (shuffleOptions && q.type !== 'judge' && baseOptions.length > 0) {
        return buildShuffledOptions(q, userId, baseOptions);
    }

    // 不打乱
    const optionItems = [];
    if (q.type === 'judge') {
        optionItems.push({ label: 'A', text: '正确' }, { label: 'B', text: '错误' });
    } else {
        baseOptions.forEach((text, index) => {
            optionItems.push({ label: LETTER_CHARS[index] || '', text });
        });
    }
    return { optionItems, letterMap: {} };
}

module.exports = {
    LETTER_CHARS,
    hashString,
    buildRulesMap,
    normalizeAnswerValue,
    mapAnswerWithLetterMap,
    formatAnswerKey,
    getBaseOptions,
    buildShuffledOptions,
    buildQuestionOptions
};
