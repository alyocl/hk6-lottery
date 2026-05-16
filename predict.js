function getCombinedScores(dataSeries, currentIdx) {
    const longFreq = new Array(50).fill(0);
    const midActive = new Array(50).fill(0);
    const shortActive = new Array(50).fill(0);
    const LONG_WINDOW = 0;       // 全部歷史
    const MID_WINDOW = 15;
    const SHORT_WINDOW = 5;

    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        const numbers = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of numbers) {
            if (LONG_WINDOW === 0 || i >= 0) longFreq[n]++;
            if (i >= currentIdx - MID_WINDOW) midActive[n]++;
            if (i >= currentIdx - SHORT_WINDOW) shortActive[n]++;
        }
    }
    const maxLong = Math.max(...longFreq.slice(1));
    const maxMid = Math.max(...midActive.slice(1));
    const maxShort = Math.max(...shortActive.slice(1));
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const longScore = maxLong ? longFreq[i] / maxLong : 0;
        const midScore = maxMid ? midActive[i] / maxMid : 0;
        const shortScore = maxShort ? shortActive[i] / maxShort : 0;
        scores[i] = 0.4 * longScore + 0.3 * midScore + 0.3 * shortScore;
    }

    // 冷熱調節（加強）
    const lastSeen = new Array(50).fill(-1);
    for (let t = currentIdx - 1; t >= 0; t--) {
        const row = dataSeries[t];
        const numbers = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of numbers) if (lastSeen[n] === -1) lastSeen[n] = t;
    }
    for (let i = 1; i <= 49; i++) {
        const gap = (lastSeen[i] === -1) ? 999 : (currentIdx - lastSeen[i] - 1);
        if (gap > 12 && gap <= 25) scores[i] *= 1.12;   // 提升12%
        else if (gap > 25 && gap <= 40) scores[i] *= 1.05;
        else if (gap > 40) scores[i] *= 0.98;           // 極冷微降
    }
    return scores;
}

// 單式生成改為加權隨機抽樣（保留原核心池大小20）
export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let candidates = Array.from({ length: 49 }, (_, i) => i + 1);
    candidates.sort((a, b) => scores[b] - scores[a]);
    const corePool = candidates.slice(0, 20);  // 前20高分

    const tickets = [];
    for (let i = 0; i < nTickets; i++) {
        let selected = [];
        let tempPool = [...corePool];
        let weights = tempPool.map(n => Math.max(scores[n], 0.01));
        for (let s = 0; s < 6; s++) {
            let total = weights.reduce((a,b)=>a+b,0);
            let rand = Math.random() * total;
            let idx = 0, acc = 0;
            while (acc + weights[idx] < rand && idx < weights.length-1) {
                acc += weights[idx];
                idx++;
            }
            selected.push(tempPool[idx]);
            tempPool.splice(idx,1);
            weights.splice(idx,1);
        }
        selected.sort((a,b)=>a-b);
        tickets.push(selected);
    }
    return tickets;
}
