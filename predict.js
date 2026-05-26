// ==================== 多特征集成预测模型 v3.0 ====================
// 导出：predictTicketsFixed, getTopNumbersByScore

// ------------------- 可调权重（用户可手动修改） -------------------
const WEIGHTS = {
    // 基本统计特征
    longFreq: 0.08,
    shortFreq: 0.08,
    zscore: 0.06,
    maDensity: 0.06,
    // 时序特征
    markov1: 0.06,
    markov2: 0.04,
    ar2: 0.04,
    // 组合特征
    sumDev: 0.06,
    parity: 0.06,
    region: 0.06,
    span: 0.04,
    tail: 0.06,
    consecutive: 0.04,
    // 高级特征
    gapReg: 0.06,
    bayesPost: 0.06,
    ensembleVote: 0.10,
    // 区间交叉特征
    crossSum: 0.04
};

// 辅助函数
function normalize(scores) {
    let max = Math.max(...scores.slice(1));
    if (max === 0) return scores;
    let norm = scores.slice();
    for (let i = 1; i <= 49; i++) norm[i] /= max;
    return norm;
}

// ---------- 1. 基本统计特征 ----------
function scoreLongFreq(dataSeries, currentIdx) {
    const freq = new Array(50).fill(0);
    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => freq[n]++);
    }
    return normalize(freq);
}

function scoreShortFreq(dataSeries, currentIdx) {
    const freq = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 15);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => freq[n]++);
    }
    return normalize(freq);
}

function scoreZScore(dataSeries, currentIdx) {
    // 计算每个号码的历史出现次数均值和标准差，然后标准化
    const counts = new Array(50).fill(0);
    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => counts[n]++);
    }
    const mean = counts.reduce((a,b) => a+b, 0) / 49;
    let variance = 0;
    for (let i = 1; i <= 49; i++) variance += (counts[i] - mean) ** 2;
    const std = Math.sqrt(variance / 49);
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        scores[i] = (counts[i] - mean) / (std === 0 ? 1 : std);
    }
    // 将 Z-Score 映射到 0-1（使用逻辑函数）
    for (let i = 1; i <= 49; i++) scores[i] = 1 / (1 + Math.exp(-scores[i] / 1.5));
    return normalize(scores);
}

function scoreMADensity(dataSeries, currentIdx) {
    // 移动平均密度：最近5期与最近20期的比值
    const shortWin = 5, longWin = 20;
    const shortCount = new Array(50).fill(0);
    const longCount = new Array(50).fill(0);
    for (let i = Math.max(0, currentIdx - shortWin); i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => shortCount[n]++);
    }
    for (let i = Math.max(0, currentIdx - longWin); i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => longCount[n]++);
    }
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const shortDensity = shortCount[i] / shortWin;
        const longDensity = longCount[i] / longWin;
        if (longDensity === 0) scores[i] = shortDensity > 0 ? 1 : 0;
        else scores[i] = Math.min(1.2, shortDensity / longDensity);
    }
    return normalize(scores);
}

// ---------- 2. 时序特征 ----------
function scoreMarkov1(dataSeries, currentIdx) {
    if (currentIdx < 2) return new Array(50).fill(0.5);
    const trans = new Array(50).fill(0);
    let total = 0;
    const start = Math.max(0, currentIdx - 50);
    for (let t = start+1; t < currentIdx; t++) {
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

function scoreMarkov2(dataSeries, currentIdx) {
    // 二阶马尔可夫：基于前两期组合
    if (currentIdx < 3) return new Array(50).fill(0.5);
    const trans = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 50);
    for (let t = start+2; t < currentIdx; t++) {
        const prev1Row = dataSeries[t-2];
        const prev2Row = dataSeries[t-1];
        const curRow = dataSeries[t];
        const prevSet = new Set([prev1Row.n1, prev1Row.n2, prev1Row.n3, prev1Row.n4, prev1Row.n5, prev1Row.n6,
                                 prev2Row.n1, prev2Row.n2, prev2Row.n3, prev2Row.n4, prev2Row.n5, prev2Row.n6]);
        const curSet = new Set([curRow.n1, curRow.n2, curRow.n3, curRow.n4, curRow.n5, curRow.n6]);
        for (let p of prevSet) {
            for (let c of curSet) {
                trans[c]++;
            }
        }
    }
    const last1 = dataSeries[currentIdx-2];
    const last2 = dataSeries[currentIdx-1];
    const lastSet = new Set([last1.n1, last1.n2, last1.n3, last1.n4, last1.n5, last1.n6,
                             last2.n1, last2.n2, last2.n3, last2.n4, last2.n5, last2.n6]);
    const scores = new Array(50).fill(0);
    for (let c = 1; c <= 49; c++) {
        let sum = 0;
        for (let p of lastSet) sum += trans[c];
        scores[c] = sum;
    }
    return normalize(scores);
}

function scoreAR2(dataSeries, currentIdx) {
    // 简单AR(2)预测每个号码的出现概率（用过去两期是否出现作为因子）
    if (currentIdx < 2) return new Array(50).fill(0.5);
    const last1 = dataSeries[currentIdx-1];
    const last2 = dataSeries[currentIdx-2];
    const last1Set = new Set([last1.n1, last1.n2, last1.n3, last1.n4, last1.n5, last1.n6]);
    const last2Set = new Set([last2.n1, last2.n2, last2.n3, last2.n4, last2.n5, last2.n6]);
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        let score = 0.5;
        if (last1Set.has(i)) score += 0.3;
        if (last2Set.has(i)) score += 0.2;
        scores[i] = Math.min(1, score);
    }
    return normalize(scores);
}

// ---------- 3. 组合特征 ----------
function scoreSumDev(dataSeries, currentIdx) {
    const sums = [];
    const start = Math.max(0, currentIdx - 30);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const sum = row.n1 + row.n2 + row.n3 + row.n4 + row.n5 + row.n6;
        sums.push(sum);
    }
    if (sums.length < 5) return new Array(50).fill(0.5);
    const predictedSum = sums.slice(-3).reduce((a,b)=>a+b,0) / 3;
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

function scoreParity(dataSeries, currentIdx) {
    const parityRates = [];
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        let oddCount = 0;
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => { if (n % 2 === 1) oddCount++; });
        parityRates.push(oddCount);
    }
    const predictedOdd = Math.round(parityRates.slice(-5).reduce((a,b)=>a+b,0) / 5);
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        if (i % 2 === 1) scores[i] = predictedOdd / 6;
        else scores[i] = (6 - predictedOdd) / 6;
    }
    return normalize(scores);
}

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

// ---------- 4. 高级特征 ----------
function scoreGapRegression(dataSeries, currentIdx) {
    // 基于平均遗漏间隔
    const lastSeen = new Array(50).fill(-1);
    const intervals = new Array(50).fill(0);
    const counts = new Array(50).fill(0);
    for (let t = 0; t < currentIdx; t++) {
        const row = dataSeries[t];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of nums) {
            if (lastSeen[n] !== -1) {
                intervals[n] += (t - lastSeen[n]);
                counts[n]++;
            }
            lastSeen[n] = t;
        }
    }
    const avgGap = new Array(50);
    for (let i = 1; i <= 49; i++) {
        if (counts[i] > 0) avgGap[i] = intervals[i] / counts[i];
        else avgGap[i] = 20;
    }
    const currentGap = new Array(50);
    for (let i = 1; i <= 49; i++) {
        if (lastSeen[i] === -1) currentGap[i] = 999;
        else currentGap[i] = currentIdx - lastSeen[i] - 1;
    }
    const scores = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        let ratio = currentGap[i] / avgGap[i];
        scores[i] = Math.min(1, ratio / 1.5);
    }
    return normalize(scores);
}

function scoreBayesPosterior(dataSeries, currentIdx) {
    // 简单贝叶斯更新：以历史频率为先验，以最近5期的频率为似然，计算后验
    const prior = new Array(50).fill(0);
    for (let i = 0; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => prior[n]++);
    }
    const totalPrior = prior.reduce((a,b)=>a+b, 0);
    for (let i = 1; i <= 49; i++) prior[i] = (prior[i] + 1) / (totalPrior + 49); // 拉普拉斯平滑
    const likelihood = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 5);
    let totalLike = 0;
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].forEach(n => { likelihood[n]++; totalLike++; });
    }
    for (let i = 1; i <= 49; i++) likelihood[i] = (likelihood[i] + 1) / (totalLike + 49);
    const posterior = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) posterior[i] = prior[i] * likelihood[i];
    return normalize(posterior);
}

function scoreEnsembleVote(dataSeries, currentIdx) {
    // 集成投票：收集几个关键子预测器的排名，投票计分
    const subScores = [
        scoreLongFreq(dataSeries, currentIdx),
        scoreShortFreq(dataSeries, currentIdx),
        scoreMADensity(dataSeries, currentIdx),
        scoreMarkov1(dataSeries, currentIdx),
        scoreSumDev(dataSeries, currentIdx),
        scoreRegion(dataSeries, currentIdx),
        scoreTail(dataSeries, currentIdx),
        scoreGapRegression(dataSeries, currentIdx)
    ];
    const votes = new Array(50).fill(0);
    for (let s of subScores) {
        const ranked = Array.from({length:49}, (_,i)=>i+1).sort((a,b) => s[b] - s[a]);
        for (let i = 0; i < 10; i++) votes[ranked[i]] += (10 - i);
    }
    return normalize(votes);
}

function scoreCrossSum(dataSeries, currentIdx) {
    // 交叉和值特征：将号码拆成十位和个位之和
    const sumDigits = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6];
        for (let n of nums) {
            const tens = Math.floor(n / 10);
            const ones = n % 10;
            sumDigits[tens + ones]++;
        }
    }
    const scores = new Array(50).fill(0);
    const maxSum = Math.max(...sumDigits.slice(1));
    for (let i = 1; i <= 49; i++) {
        const tens = Math.floor(i / 10);
        const ones = i % 10;
        scores[i] = sumDigits[tens + ones] / maxSum;
    }
    return normalize(scores);
}

// ---------- 综合评分（加权投票） ----------
function getCombinedScores(dataSeries, currentIdx) {
    const featureScores = {
        longFreq: scoreLongFreq(dataSeries, currentIdx),
        shortFreq: scoreShortFreq(dataSeries, currentIdx),
        zscore: scoreZScore(dataSeries, currentIdx),
        maDensity: scoreMADensity(dataSeries, currentIdx),
        markov1: scoreMarkov1(dataSeries, currentIdx),
        markov2: scoreMarkov2(dataSeries, currentIdx),
        ar2: scoreAR2(dataSeries, currentIdx),
        sumDev: scoreSumDev(dataSeries, currentIdx),
        parity: scoreParity(dataSeries, currentIdx),
        region: scoreRegion(dataSeries, currentIdx),
        span: scoreSpan(dataSeries, currentIdx),
        tail: scoreTail(dataSeries, currentIdx),
        consecutive: scoreConsecutive(dataSeries, currentIdx),
        gapReg: scoreGapRegression(dataSeries, currentIdx),
        bayesPost: scoreBayesPosterior(dataSeries, currentIdx),
        ensembleVote: scoreEnsembleVote(dataSeries, currentIdx),
        crossSum: scoreCrossSum(dataSeries, currentIdx)
    };
    const combined = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        let total = 0;
        for (let [name, scores] of Object.entries(featureScores)) {
            if (WEIGHTS[name] !== undefined) total += WEIGHTS[name] * scores[i];
        }
        combined[i] = total;
    }
    return normalize(combined);
}

// ---------- 对外接口 ----------
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
