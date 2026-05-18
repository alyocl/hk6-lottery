// ==================== 多特征集成预测模型（确定性） ====================
// 每个子预测器输出号码得分(0-1)，加权求和后得到综合得分
// 基于综合得分，使用确定性规则生成多注（无随机）

// 可调权重（用户可修改）
const WEIGHTS = {
    longFreq: 0.15,     // 长期频率
    shortActive: 0.15,  // 短期活跃
    maTrend: 0.10,      // 移动平均趋势
    sumDev: 0.10,       // 和值偏差
    parity: 0.08,       // 奇偶比
    region: 0.08,       // 区间分布
    span: 0.07,         // 跨度
    tail: 0.10,         // 尾数
    consecutive: 0.07,  // 连号
    markov: 0.10        // 马尔可夫
};

// 辅助：归一化数组（1-49）
function normalize(scores) {
    let max = Math.max(...scores.slice(1));
    if (max === 0) return scores;
    let norm = scores.slice();
    for (let i = 1; i <= 49; i++) norm[i] /= max;
    return norm;
}

// ------------------- 子预测器 -------------------
// 1. 长期频率
function scoreLongFreq(dataSeries, currentIdx) {
    const freq = new Array(50).fill(0);
    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => freq[n]++);
    }
    return normalize(freq);
}

// 2. 短期活跃（最近15期）
function scoreShortActive(dataSeries, currentIdx) {
    const active = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 15);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => active[n]++);
    }
    return normalize(active);
}

// 3. 移动平均趋势（比较近3期与近10期密度）
function scoreMATrend(dataSeries, currentIdx) {
    const short = new Array(50).fill(0);
    const long = new Array(50).fill(0);
    const shortWin = 3, longWin = 10;
    for (let i = Math.max(0, currentIdx - shortWin); i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => short[n]++);
    }
    for (let i = Math.max(0, currentIdx - longWin); i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => long[n]++);
    }
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const shortDensity = short[i] / shortWin;
        const longDensity = long[i] / longWin;
        if (longDensity === 0) scores[i] = shortDensity > 0 ? 1 : 0;
        else scores[i] = Math.min(1.2, shortDensity / longDensity);
    }
    return normalize(scores);
}

// 4. 和值偏差预测
function scoreSumDev(dataSeries, currentIdx) {
    // 计算过去30期的和值序列
    const sums = [];
    const start = Math.max(0, currentIdx - 30);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const sum = row.n1 + row.n2 + row.n3 + row.n4 + row.n5 + row.n6;
        sums.push(sum);
    }
    if (sums.length < 5) return new Array(50).fill(0.5);
    // 预测下一期和值（简单移动平均）
    const recent3 = sums.slice(-3);
    const predictedSum = recent3.reduce((a,b)=>a+b,0) / recent3.length;
    // 统计每个号码出现时，该期和值与预测值的偏差（偏差越小得分越高）
    const diffMap = new Array(50).fill(0);
    const countMap = new Array(50).fill(0);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const sum = row.n1 + row.n2 + row.n3 + row.n4 + row.n5 + row.n6;
        const diff = Math.abs(sum - predictedSum);
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => {
            diffMap[n] += diff;
            countMap[n]++;
        });
    }
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        if (countMap[i] > 0) scores[i] = 1 / (1 + diffMap[i] / countMap[i] / 10);
        else scores[i] = 0.5;
    }
    return normalize(scores);
}

// 5. 奇偶比预测
function scoreParity(dataSeries, currentIdx) {
    const parityRates = [];
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        let oddCount = 0;
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => { if (n % 2 === 1) oddCount++; });
        parityRates.push(oddCount);
    }
    if (parityRates.length === 0) return new Array(50).fill(0.5);
    const predictedOdd = Math.round(parityRates.slice(-5).reduce((a,b)=>a+b,0) / 5);
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        if (i % 2 === 1) scores[i] = predictedOdd / 6;
        else scores[i] = (6 - predictedOdd) / 6;
    }
    return normalize(scores);
}

// 6. 区间分布预测（5个区间）
function scoreRegion(dataSeries, currentIdx) {
    const regions = [[1,10],[11,20],[21,30],[31,40],[41,49]];
    const regionCounts = new Array(5).fill(0);
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let r = 0; r < 5; r++) {
            const [low, high] = regions[r];
            const cnt = nums.filter(n => n >= low && n <= high).length;
            regionCounts[r] += cnt;
        }
    }
    const avgCounts = regionCounts.map(c => c / (currentIdx - start));
    const predictedCounts = avgCounts.map(c => Math.round(c));
    const scores = new Array(50).fill(0);
    for (let r = 0; r < 5; r++) {
        const [low, high] = regions[r];
        const scorePerNum = predictedCounts[r] / (high - low + 1);
        for (let i = low; i <= high; i++) scores[i] = scorePerNum;
    }
    return normalize(scores);
}

// 7. 跨度预测
function scoreSpan(dataSeries, currentIdx) {
    const spans = [];
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        const span = Math.max(...nums) - Math.min(...nums);
        spans.push(span);
    }
    if (spans.length === 0) return new Array(50).fill(0.5);
    const predictedSpan = spans.slice(-5).reduce((a,b)=>a+b,0) / 5;
    const diffMap = new Array(50).fill(0);
    const countMap = new Array(50).fill(0);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        const span = Math.max(...nums) - Math.min(...nums);
        const diff = Math.abs(span - predictedSpan);
        nums.forEach(n => { diffMap[n] += diff; countMap[n]++; });
    }
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        if (countMap[i] > 0) scores[i] = 1 / (1 + diffMap[i] / countMap[i] / 10);
        else scores[i] = 0.5;
    }
    return normalize(scores);
}

// 8. 尾数分布预测
function scoreTail(dataSeries, currentIdx) {
    const tailCounts = new Array(10).fill(0);
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => tailCounts[n % 10]++);
    }
    const avgPerTail = tailCounts.map(c => c / (currentIdx - start) / 6);
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) scores[i] = avgPerTail[i % 10];
    return normalize(scores);
}

// 9. 连号倾向预测
function scoreConsecutive(dataSeries, currentIdx) {
    const consecCount = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 50);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].sort((a,b)=>a-b);
        for (let j = 0; j < 5; j++) {
            if (nums[j+1] === nums[j] + 1) {
                consecCount[nums[j]]++;
                consecCount[nums[j+1]]++;
            }
        }
    }
    return normalize(consecCount);
}

// 10. 马尔可夫链（基于上期号码）
function scoreMarkov(dataSeries, currentIdx) {
    if (currentIdx < 2) return new Array(50).fill(0.5);
    const trans = new Array(50).fill(0);
    let total = 0;
    const start = Math.max(0, currentIdx - 50);
    for (let t = start + 1; t < currentIdx; t++) {
        const prevRow = dataSeries[t-1];
        const curRow = dataSeries[t];
        const prevSet = new Set([prevRow.n1, prevRow.n2, prevRow.n3, prevRow.n4, prevRow.n5, prevRow.n6]);
        const curSet = new Set([curRow.n1, curRow.n2, curRow.n3, curRow.n4, curRow.n5, curRow.n6]);
        for (let p of prevSet) {
            for (let c of curSet) {
                trans[c]++;
                total++;
            }
        }
    }
    const lastRow = dataSeries[currentIdx-1];
    const lastSet = new Set([lastRow.n1, lastRow.n2, lastRow.n3, lastRow.n4, lastRow.n5, lastRow.n6]);
    const scores = new Array(50).fill(0);
    for (let c = 1; c <= 49; c++) {
        let sum = 0;
        for (let p of lastSet) sum += trans[c];
        scores[c] = sum;
    }
    return normalize(scores);
}

// ------------------- 综合评分 -------------------
function getCombinedScores(dataSeries, currentIdx) {
    const scores = new Array(50).fill(0);
    const features = {
        longFreq: scoreLongFreq(dataSeries, currentIdx),
        shortActive: scoreShortActive(dataSeries, currentIdx),
        maTrend: scoreMATrend(dataSeries, currentIdx),
        sumDev: scoreSumDev(dataSeries, currentIdx),
        parity: scoreParity(dataSeries, currentIdx),
        region: scoreRegion(dataSeries, currentIdx),
        span: scoreSpan(dataSeries, currentIdx),
        tail: scoreTail(dataSeries, currentIdx),
        consecutive: scoreConsecutive(dataSeries, currentIdx),
        markov: scoreMarkov(dataSeries, currentIdx)
    };
    for (let i = 1; i <= 49; i++) {
        let total = 0;
        for (let [key, arr] of Object.entries(features)) {
            total += WEIGHTS[key] * arr[i];
        }
        scores[i] = total;
    }
    return normalize(scores);
}

// ------------------- 对外接口 -------------------
export function getTopNumbersByScore(dataSeries, count, exclude = []) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let candidates = Array.from({ length: 49 }, (_, i) => i + 1);
    if (exclude.length) candidates = candidates.filter(c => !exclude.includes(c));
    candidates.sort((a, b) => scores[b] - scores[a]);
    return candidates.slice(0, count).sort((a, b) => a - b);
}

export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
    allNumbers.sort((a, b) => scores[b] - scores[a]);
    
    const top6 = allNumbers.slice(0, 6);
    const top7_12 = allNumbers.slice(6, 12);
    const top13_18 = allNumbers.slice(12, 18);
    
    const tickets = [];
    // 第一注：最高分6个
    tickets.push([...top6].sort((a,b)=>a-b));
    if (nTickets >= 2) {
        const second = [...top6.slice(0,3), ...top7_12.slice(0,3)];
        tickets.push(second.sort((a,b)=>a-b));
    }
    if (nTickets >= 3) {
        const third = [...top6.slice(3,6), ...top7_12.slice(3,6)];
        tickets.push(third.sort((a,b)=>a-b));
    }
    if (nTickets >= 4) {
        let fourthNumbers = [];
        if (tickets[0]) fourthNumbers.push(tickets[0][0], tickets[0][3]);
        if (tickets[1]) fourthNumbers.push(tickets[1][1], tickets[1][4]);
        if (tickets[2]) fourthNumbers.push(tickets[2][2], tickets[2][5]);
        let unique = [...new Set(fourthNumbers)];
        if (unique.length < 6) {
            let need = 6 - unique.length;
            let candidates = top13_18.filter(n => !unique.includes(n));
            unique.push(...candidates.slice(0, need));
        }
        let fourth = unique.slice(0,6);
        tickets.push(fourth.sort((a,b)=>a-b));
    }
    if (nTickets > 4) {
        for (let i = 4; i < nTickets; i++) tickets.push([...tickets[3]]);
    }
    return tickets.slice(0, nTickets);
}
