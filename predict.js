// ==================== 六合彩预测核心引擎 v3.1 ====================
// 导出函数：
//   - predictTicketsFixed(dataSeries, nTickets)   -> 单式多注
//   - getTopNumbersByScore(dataSeries, count, exclude) -> 复式/胆拖高分号码池

// ----- 内部评分函数（长期40% + 中期30% + 短期30% + 冷热调节）-----
function getCombinedScores(dataSeries, currentIdx) {
    const longFreq = new Array(50).fill(0);
    const midActive = new Array(50).fill(0);
    const shortActive = new Array(50).fill(0);
    const MID_WINDOW = 15;
    const SHORT_WINDOW = 5;

    // 统计各窗口频率
    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of nums) {
            longFreq[n]++;                    // 全部历史
            if (i >= currentIdx - MID_WINDOW) midActive[n]++;
            if (i >= currentIdx - SHORT_WINDOW) shortActive[n]++;
        }
    }

    // 归一化
    const maxLong = Math.max(...longFreq.slice(1));
    const maxMid = Math.max(...midActive.slice(1));
    const maxShort = Math.max(...shortActive.slice(1));
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const longScore = maxLong ? longFreq[i] / maxLong : 0;
        const midScore = maxMid ? midActive[i] / maxMid : 0;
        const shortScore = maxShort ? shortActive[i] / maxShort : 0;
        // 权重：长期0.4，中期0.3，短期0.3
        scores[i] = 0.4 * longScore + 0.3 * midScore + 0.3 * shortScore;
    }

    // 冷热调节：12-25期未出加分12%，25-40期加分5%，40期以上微降2%
    const lastSeen = new Array(50).fill(-1);
    for (let t = currentIdx - 1; t >= 0; t--) {
        const row = dataSeries[t];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of nums) {
            if (lastSeen[n] === -1) lastSeen[n] = t;
        }
    }
    for (let i = 1; i <= 49; i++) {
        const gap = (lastSeen[i] === -1) ? 999 : (currentIdx - lastSeen[i] - 1);
        if (gap > 12 && gap <= 25) scores[i] *= 1.12;
        else if (gap > 25 && gap <= 40) scores[i] *= 1.05;
        else if (gap > 40) scores[i] *= 0.98;
    }
    return scores;
}

// ----- 对外：获取综合评分最高的前 count 个号码（用于复式、胆拖）-----
export function getTopNumbersByScore(dataSeries, count, exclude = []) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const currentIdx = dataSeries.length;
    const scores = getCombinedScores(dataSeries, currentIdx);
    let candidates = Array.from({ length: 49 }, (_, i) => i + 1);
    if (exclude.length) candidates = candidates.filter(c => !exclude.includes(c));
    candidates.sort((a, b) => scores[b] - scores[a]);
    return candidates.slice(0, count).sort((a, b) => a - b);
}

// ----- 对外：生成单式多注（加权随机从高分池中抽取）-----
export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
    allNumbers.sort((a, b) => scores[b] - scores[a]);
    const corePool = allNumbers.slice(0, 20);   // 前20高分作为核心池

    const tickets = [];
    for (let i = 0; i < nTickets; i++) {
        let pool = [...corePool];
        let weights = pool.map(n => Math.max(scores[n], 0.01));
        let selected = [];
        for (let s = 0; s < 6; s++) {
            let total = weights.reduce((a, b) => a + b, 0);
            let rand = Math.random() * total;
            let idx = 0, acc = 0;
            while (acc + weights[idx] < rand && idx < weights.length - 1) {
                acc += weights[idx];
                idx++;
            }
            selected.push(pool[idx]);
            pool.splice(idx, 1);
            weights.splice(idx, 1);
        }
        selected.sort((a, b) => a - b);
        tickets.push(selected);
    }
    return tickets;
}
