// ==================== 统一高分预测引擎 v4.2（确定性分层多注，第四注混合前三注）====================
// 导出：getTopNumbersByScore, predictTicketsFixed

// ----- 内部评分函数（长期40% + 中期30% + 短期30% + 冷热调节）-----
function getCombinedScores(dataSeries, currentIdx) {
    const longFreq = new Array(50).fill(0);
    const midActive = new Array(50).fill(0);
    const shortActive = new Array(50).fill(0);
    const MID_WINDOW = 15;
    const SHORT_WINDOW = 5;

    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of nums) {
            longFreq[n]++;
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

    // 冷热调节
    const lastSeen = new Array(50).fill(-1);
    for (let t = currentIdx - 1; t >= 0; t--) {
        const row = dataSeries[t];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of nums) if (lastSeen[n] === -1) lastSeen[n] = t;
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

// ----- 对外：生成单式多注（确定性分层混合）-----
export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
    allNumbers.sort((a, b) => scores[b] - scores[a]);
    
    const top6 = allNumbers.slice(0, 6);               // 1-6
    const top7_12 = allNumbers.slice(6, 12);           // 7-12
    const top13_18 = allNumbers.slice(12, 18);         // 13-18
    
    const tickets = [];
    
    // 第一注：最高分6个
    tickets.push([...top6].sort((a, b) => a - b));
    
    if (nTickets >= 2) {
        // 第二注：top6 前3个 + top7_12 前3个
        const second = [...top6.slice(0, 3), ...top7_12.slice(0, 3)];
        tickets.push(second.sort((a, b) => a - b));
    }
    
    if (nTickets >= 3) {
        // 第三注：top6 后3个 + top7_12 后3个
        const third = [...top6.slice(3, 6), ...top7_12.slice(3, 6)];
        tickets.push(third.sort((a, b) => a - b));
    }
    
    if (nTickets >= 4) {
        // 第四注：从前三注中每注各取两个号码（确定性索引）
        let fourthNumbers = [];
        if (tickets[0]) fourthNumbers.push(tickets[0][0], tickets[0][3]);
        if (tickets[1]) fourthNumbers.push(tickets[1][1], tickets[1][4]);
        if (tickets[2]) fourthNumbers.push(tickets[2][2], tickets[2][5]);
        // 去重
        let unique = [...new Set(fourthNumbers)];
        if (unique.length < 6) {
            let need = 6 - unique.length;
            let candidates = top13_18.filter(n => !unique.includes(n));
            unique.push(...candidates.slice(0, need));
        }
        let fourth = unique.slice(0, 6);
        tickets.push(fourth.sort((a, b) => a - b));
    }
    
    // 如果请求超过4注，多余注重复第四注
    if (nTickets > 4) {
        for (let i = 4; i < nTickets; i++) {
            tickets.push([...tickets[3]]);
        }
    }
    
    return tickets.slice(0, nTickets);
}
