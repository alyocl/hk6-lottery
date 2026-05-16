// ==================== 六合彩预测核心引擎（统一评分 + 多模式支持）====================
// 本模块导出：
//   - predictTicketsFixed(dataSeries, nTickets)   → 用于单式生成多注
//   - getTopNumbersByScore(dataSeries, count, exclude) → 用于复式/胆拖获取高分号码池

// ----- 内部评分函数（长期频率 + 短期活跃度 + 轻度冷热调节）-----
function getCombinedScores(dataSeries, currentIdx) {
    const longFreq = new Array(50).fill(0);
    const shortActive = new Array(50).fill(0);
    const SHORT_WINDOW = 20;

    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        const numbers = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of numbers) {
            longFreq[n]++;
            if (i >= currentIdx - SHORT_WINDOW) shortActive[n]++;
        }
    }

    const maxLong = Math.max(...longFreq.slice(1));
    const maxShort = Math.max(...shortActive.slice(1));
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const longScore = maxLong ? longFreq[i] / maxLong : 0;
        const shortScore = maxShort ? shortActive[i] / maxShort : 0;
        scores[i] = 0.6 * longScore + 0.4 * shortScore;
    }

    const lastSeen = new Array(50).fill(-1);
    for (let t = currentIdx - 1; t >= 0; t--) {
        const row = dataSeries[t];
        const numbers = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of numbers) {
            if (lastSeen[n] === -1) lastSeen[n] = t;
        }
    }
    for (let i = 1; i <= 49; i++) {
        const gap = (lastSeen[i] === -1) ? 999 : (currentIdx - lastSeen[i] - 1);
        if (gap > 15 && gap <= 30) scores[i] *= 1.05;
        else if (gap > 30) scores[i] *= 0.95;
    }
    return scores;
}

// ----- 对外：获取综合评分最高的前 count 个号码（用于复式、胆拖）-----
export function getTopNumbersByScore(dataSeries, count, exclude = []) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const currentIdx = dataSeries.length;
    const scores = getCombinedScores(dataSeries, currentIdx);
    let candidates = Array.from({ length: 49 }, (_, i) => i + 1);
    if (exclude.length) {
        candidates = candidates.filter(c => !exclude.includes(c));
    }
    candidates.sort((a, b) => scores[b] - scores[a]);
    return candidates.slice(0, count).sort((a, b) => a - b);
}

// ----- 对外：生成单式多注（从高分池中随机组合）-----
export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const currentIdx = dataSeries.length;
    const scores = getCombinedScores(dataSeries, currentIdx);
    let allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
    allNumbers.sort((a, b) => scores[b] - scores[a]);
    const corePool = allNumbers.slice(0, 20);

    const tickets = [];
    for (let i = 0; i < nTickets; i++) {
        let poolCopy = [...corePool];
        for (let j = poolCopy.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [poolCopy[j], poolCopy[k]] = [poolCopy[k], poolCopy[j]];
        }
        let ticket = poolCopy.slice(0, 6).sort((a, b) => a - b);
        tickets.push(ticket);
    }
    return tickets;
}
