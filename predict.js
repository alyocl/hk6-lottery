// ==================== 多特征集成预测模型（前端版）====================
// 导出：predictTicketsFixed, getTopNumbersByScore

// ==================== 配置 ====================
const CONFIG = {
    // 特征权重 (可手动调整)
    featureWeights: {
        freq: 0.20,        // 历史频率
        recent: 0.20,      // 近期活跃度
        sum: 0.10,         // 和值偏差
        parity: 0.10,      // 奇偶偏差
        region: 0.10,      // 区间分布
        span: 0.05,        // 跨度
        tail: 0.10,        // 尾数
        consecutive: 0.05, // 连号
        markov: 0.10       // 马尔可夫链
    },
    // 历史窗口
    longWindow: 100,
    shortWindow: 10,
    // 马尔可夫阶数
    markovOrder: 1
};

// 辅助函数：归一化数组（0-1）
function normalize(arr, startIdx = 1) {
    let maxVal = Math.max(...arr.slice(startIdx));
    if (maxVal === 0) return arr;
    let normalized = arr.slice();
    for (let i = startIdx; i < normalized.length; i++) normalized[i] /= maxVal;
    return normalized;
}

// 1. 历史频率得分
function scoreFreq(dataSeries, currentIdx) {
    const freq = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - CONFIG.longWindow);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) freq[row[col]]++;
    }
    return normalize(freq, 1);
}

// 2. 近期活跃度得分
function scoreRecent(dataSeries, currentIdx) {
    const active = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - CONFIG.shortWindow);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) active[row[col]]++;
    }
    return normalize(active, 1);
}

// 3. 和值偏差得分：计算下一期可能的总和，然后每个号码对总和的贡献打分
function scoreSum(dataSeries, currentIdx) {
    // 计算过去N期的和值序列
    const sums = [];
    const start = Math.max(0, currentIdx - 30);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const sum = row.n1+row.n2+row.n3+row.n4+row.n5+row.n6;
        sums.push(sum);
    }
    if (sums.length < 5) return new Array(50).fill(0.5);
    // 简单预测：取最近3期平均
    const recent3 = sums.slice(-3);
    const predictedSum = recent3.reduce((a,b)=>a+b,0) / recent3.length;
    // 为每个号码打分：越接近 predictedSum / 6 的号码分数越高? 不，和值由6个号码决定
    // 更合理：计算每个号码加入后对总和的贡献与预测总和的匹配度（复杂）。简化：基于过去号码与平均总和的偏差
    // 我们使用另一种方式：计算每个号码出现时，该期总和与平均总和的偏差，偏差小则加分
    const avgSum = sums.reduce((a,b)=>a+b,0)/sums.length;
    const diffMap = new Array(50).fill(0);
    let countMap = new Array(50).fill(0);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const sum = row.n1+row.n2+row.n3+row.n4+row.n5+row.n6;
        const diff = Math.abs(sum - predictedSum);
        for (let col of ['n1','n2','n3','n4','n5','n6']) {
            const num = row[col];
            diffMap[num] += diff;
            countMap[num]++;
        }
    }
    const scores = new Array(50).fill(0);
    for (let i=1;i<=49;i++) {
        if (countMap[i] > 0) scores[i] = 1 / (1 + diffMap[i]/countMap[i] / 10); // 偏差越小分数越高
        else scores[i] = 0.5;
    }
    return normalize(scores, 1);
}

// 4. 奇偶偏差得分：预测下一期的奇偶比例（例如 3奇3偶），然后为奇/偶号码打分
function scoreParity(dataSeries, currentIdx) {
    const parityRates = [];
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        let oddCount = 0;
        for (let col of ['n1','n2','n3','n4','n5','n6']) if (row[col] % 2 === 1) oddCount++;
        parityRates.push(oddCount);
    }
    if (parityRates.length === 0) return new Array(50).fill(0.5);
    const recent = parityRates.slice(-5);
    const predictedOdd = Math.round(recent.reduce((a,b)=>a+b,0)/recent.length);
    const scores = new Array(50).fill(0);
    for (let i=1;i<=49;i++) {
        if (i % 2 === 1) scores[i] = predictedOdd / 6;
        else scores[i] = (6 - predictedOdd) / 6;
    }
    return normalize(scores, 1);
}

// 5. 区间分布得分：将1-49分成5个区间，预测每个区间内号码个数，给号码打分
function scoreRegion(dataSeries, currentIdx) {
    const regions = [[1,10],[11,20],[21,30],[31,40],[41,49]];
    const regionCounts = new Array(regions.length).fill(0);
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1,row.n2,row.n3,row.n4,row.n5,row.n6];
        for (let r=0; r<regions.length; r++) {
            const [low,high] = regions[r];
            const cnt = nums.filter(n => n>=low && n<=high).length;
            regionCounts[r] += cnt;
        }
    }
    const avgCounts = regionCounts.map(c => c / (currentIdx - start));
    const predictedCounts = avgCounts.map(c => Math.round(c));
    // 为每个区间内的号码打分：该区间预测个数/区间大小（归一化）
    const scores = new Array(50).fill(0);
    for (let r=0; r<regions.length; r++) {
        const [low,high] = regions[r];
        const scorePerNum = predictedCounts[r] / (high - low + 1);
        for (let i=low; i<=high; i++) scores[i] = scorePerNum;
    }
    return normalize(scores, 1);
}

// 6. 跨度得分：预测下一期跨度（最大值-最小值），每个号码对跨度的贡献打分
function scoreSpan(dataSeries, currentIdx) {
    const spans = [];
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1,row.n2,row.n3,row.n4,row.n5,row.n6];
        const span = Math.max(...nums) - Math.min(...nums);
        spans.push(span);
    }
    if (spans.length === 0) return new Array(50).fill(0.5);
    const recentSpans = spans.slice(-5);
    const predictedSpan = recentSpans.reduce((a,b)=>a+b,0)/recentSpans.length;
    // 跨度与号码的位置有关，难以直接打分。简化：根据历史数据，每个号码出现时与同期的跨度偏差
    const diffMap = new Array(50).fill(0);
    let countMap = new Array(50).fill(0);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1,row.n2,row.n3,row.n4,row.n5,row.n6];
        const span = Math.max(...nums) - Math.min(...nums);
        const diff = Math.abs(span - predictedSpan);
        for (let col of ['n1','n2','n3','n4','n5','n6']) {
            const num = row[col];
            diffMap[num] += diff;
            countMap[num]++;
        }
    }
    const scores = new Array(50).fill(0);
    for (let i=1;i<=49;i++) {
        if (countMap[i] > 0) scores[i] = 1 / (1 + diffMap[i]/countMap[i] / 10);
        else scores[i] = 0.5;
    }
    return normalize(scores, 1);
}

// 7. 尾数得分：预测下一期各个尾数（0-9）的出现次数，给对应尾数的号码打分
function scoreTail(dataSeries, currentIdx) {
    const tailCounts = new Array(10).fill(0);
    const start = Math.max(0, currentIdx - 20);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1,row.n2,row.n3,row.n4,row.n5,row.n6];
        for (let n of nums) {
            tailCounts[n % 10]++;
        }
    }
    const avgPerTail = tailCounts.map(c => c / (currentIdx - start) / 6); // 每个尾数平均每个号码出现的频率
    const scores = new Array(50).fill(0);
    for (let i=1;i<=49;i++) {
        const tail = i % 10;
        scores[i] = avgPerTail[tail];
    }
    return normalize(scores, 1);
}

// 8. 连号得分：预测下一期是否有连号（连续数字），为可能构成连号的号码加分（复杂，简化：根据历史连号频率给号码加分）
function scoreConsecutive(dataSeries, currentIdx) {
    // 简单实现：统计出现连号的期数中，哪些号码常出现在连号中
    const consecCount = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 50);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        const nums = [row.n1,row.n2,row.n3,row.n4,row.n5,row.n6];
        nums.sort((a,b)=>a-b);
        for (let j=0; j<5; j++) {
            if (nums[j+1] === nums[j]+1) {
                // 发现连号，给这两个号码加分
                consecCount[nums[j]]++;
                consecCount[nums[j+1]]++;
            }
        }
    }
    const scores = new Array(50).fill(0);
    for (let i=1;i<=49;i++) scores[i] = consecCount[i];
    return normalize(scores, 1);
}

// 9. 马尔可夫链得分（基于上一期号码）
function scoreMarkov(dataSeries, currentIdx) {
    if (currentIdx < 2) return new Array(50).fill(0.5);
    const trans = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - 50);
    for (let t = start+1; t < currentIdx; t++) {
        const prevRow = dataSeries[t-1];
        const curRow = dataSeries[t];
        const prevSet = new Set([prevRow.n1, prevRow.n2, prevRow.n3, prevRow.n4, prevRow.n5, prevRow.n6]);
        const curSet = new Set([curRow.n1, curRow.n2, curRow.n3, curRow.n4, curRow.n5, curRow.n6]);
        for (let p of prevSet) {
            for (let c of curSet) {
                trans[c]++;
            }
        }
    }
    const lastRow = dataSeries[currentIdx-1];
    const lastSet = new Set([lastRow.n1, lastRow.n2, lastRow.n3, lastRow.n4, lastRow.n5, lastRow.n6]);
    const markovScore = new Array(50).fill(0);
    for (let c = 1; c <= 49; c++) {
        let total = 0;
        for (let p of lastSet) total += trans[c];
        markovScore[c] = total;
    }
    return normalize(markovScore, 1);
}

// 综合得分（加权平均）
function getCombinedScores(dataSeries, currentIdx) {
    const featureScores = {
        freq: scoreFreq(dataSeries, currentIdx),
        recent: scoreRecent(dataSeries, currentIdx),
        sum: scoreSum(dataSeries, currentIdx),
        parity: scoreParity(dataSeries, currentIdx),
        region: scoreRegion(dataSeries, currentIdx),
        span: scoreSpan(dataSeries, currentIdx),
        tail: scoreTail(dataSeries, currentIdx),
        consecutive: scoreConsecutive(dataSeries, currentIdx),
        markov: scoreMarkov(dataSeries, currentIdx)
    };
    const combined = new Array(50).fill(0);
    for (let i=1;i<=49;i++) {
        let total = 0;
        for (let [name, scores] of Object.entries(featureScores)) {
            total += CONFIG.featureWeights[name] * scores[i];
        }
        combined[i] = total;
    }
    return normalize(combined, 1);
}

// 对外：获取综合得分最高的前 count 个号码（用于复式、胆拖）
export function getTopNumbersByScore(dataSeries, count, exclude = []) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const currentIdx = dataSeries.length;
    const scores = getCombinedScores(dataSeries, currentIdx);
    let candidates = Array.from({ length: 49 }, (_, i) => i + 1);
    if (exclude.length) candidates = candidates.filter(c => !exclude.includes(c));
    candidates.sort((a, b) => scores[b] - scores[a]);
    return candidates.slice(0, count).sort((a, b) => a - b);
}

// 对外：生成单式多注（从高分池中加权随机选号，增加多样性）
export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const scores = getCombinedScores(dataSeries, dataSeries.length);
    let allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
    allNumbers.sort((a, b) => scores[b] - scores[a]);
    // 取前 20 名作为核心池
    const corePool = allNumbers.slice(0, 20);
    const tickets = [];
    for (let i = 0; i < nTickets; i++) {
        let pool = [...corePool];
        let weights = pool.map(n => Math.max(scores[n], 0.01));
        let selected = [];
        for (let s = 0; s < 6; s++) {
            let total = weights.reduce((a,b)=>a+b,0);
            let rand = Math.random() * total;
            let idx = 0, acc = 0;
            while (acc + weights[idx] < rand && idx < weights.length-1) {
                acc += weights[idx];
                idx++;
            }
            selected.push(pool[idx]);
            pool.splice(idx,1);
            weights.splice(idx,1);
        }
        selected.sort((a,b)=>a-b);
        tickets.push(selected);
    }
    return tickets;
}
