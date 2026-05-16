// ==================== 改良版評分函數（以長期頻率為主，短期為輔）====================
function getCombinedScores(dataSeries, currentIdx) {
    const longFreq = new Array(50).fill(0);
    const shortActive = new Array(50).fill(0);
    const window = 20; // 近期窗口
    
    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) {
            longFreq[row[col]]++;
            if (i >= currentIdx - window) shortActive[row[col]]++;
        }
    }
    // 正規化
    const maxLong = Math.max(...longFreq.slice(1));
    const maxShort = Math.max(...shortActive.slice(1));
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const longScore = maxLong ? longFreq[i] / maxLong : 0;
        const shortScore = maxShort ? shortActive[i] / maxShort : 0;
        // 權重：長期0.6，短期0.4，避免過度追熱
        scores[i] = 0.6 * longScore + 0.4 * shortScore;
    }
    // 可選：輕微獎勵冷門（超過15期未出的加分），但不扣分
    const lastSeen = new Array(50).fill(-1);
    for (let t = currentIdx-1; t >= 0; t--) {
        const row = dataSeries[t];
        for (let col of ['n1','n2','n3','n4','n5','n6']) {
            if (lastSeen[row[col]] === -1) lastSeen[row[col]] = t;
        }
    }
    for (let i = 1; i <= 49; i++) {
        const gap = (lastSeen[i] === -1) ? 999 : (currentIdx - lastSeen[i] - 1);
        if (gap > 15 && gap <= 30) scores[i] *= 1.05;  // 輕微提升
        else if (gap > 30) scores[i] *= 0.95;          // 超過30期未出稍微降權
    }
    return scores;
}

// 取得綜合分數最高的 N 個號碼（供複式、膽拖使用）
export function getTopNumbersByScore(dataSeries, count, exclude = []) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let candidates = Array.from({length:49}, (_,i)=>i+1);
    candidates = candidates.filter(c => !exclude.includes(c));
    candidates.sort((a,b) => scores[b] - scores[a]);
    return candidates.slice(0, count).sort((a,b)=>a-b);
}

// 單式預測：從高分池中隨機生成多注（避免僅取前N名造成每注相同）
export function predictTicketsFixed(dataSeries, nTickets) {
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    // 取前 20 名作為核心池
    let candidates = Array.from({length:49}, (_,i)=>i+1);
    candidates.sort((a,b) => scores[b] - scores[a]);
    const corePool = candidates.slice(0, 20);
    const tickets = [];
    for (let i = 0; i < nTickets; i++) {
        let shuffled = [...corePool];
        for (let j = shuffled.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
        }
        let ticket = shuffled.slice(0, 6).sort((a,b)=>a-b);
        tickets.push(ticket);
    }
    return tickets;
}

// 可选：导出配置，方便调试
export { CONFIG };
