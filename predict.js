// ==================== 高级预测算法（含江恩周期）====================
// 配置参数
const CONFIG = {
    // 数据窗口
    longWindow: 100,        // 长期频率窗口（最多100期）
    shortWindow: 15,        // 近期活跃窗口
    maShort: 3,             // 移动平均短周期
    maLong: 10,             // 移动平均长周期
    // 马尔可夫链
    markovLength: 30,       // 训练期数
    // 江恩周期
    gannCycles: [5, 7, 12, 18],  // 常用的江恩周期
    // 策略权重（总和为1）
    weights: {
        longFreq: 0.20,
        shortActive: 0.25,
        maTrend: 0.15,
        markov: 0.15,
        gann: 0.25
    },
    // Pool 大小
    poolSize: 30,
    // 是否强制排除上期号码
    excludeLast: true
};

// 辅助：归一化数组（0-1）
function normalize(arr, startIdx = 1) {
    let maxVal = Math.max(...arr.slice(startIdx));
    if (maxVal === 0) return arr;
    let normalized = arr.slice();
    for (let i = startIdx; i < normalized.length; i++) normalized[i] /= maxVal;
    return normalized;
}

// 策略1：长期频率
function calcLongFreq(dataSeries, currentIdx) {
    const freq = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - CONFIG.longWindow);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) freq[row[col]]++;
    }
    return normalize(freq, 1);
}

// 策略2：近期活跃度
function calcShortActive(dataSeries, currentIdx) {
    const active = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - CONFIG.shortWindow);
    for (let i = start; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) active[row[col]]++;
    }
    return normalize(active, 1);
}

// 策略3：移动平均趋势（比较短周期与长周期密度）
function calcMATrend(dataSeries, currentIdx) {
    const shortCount = new Array(50).fill(0);
    const longCount = new Array(50).fill(0);
    const startShort = Math.max(0, currentIdx - CONFIG.maShort);
    const startLong = Math.max(0, currentIdx - CONFIG.maLong);
    for (let i = startShort; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) shortCount[row[col]]++;
    }
    for (let i = startLong; i < currentIdx; i++) {
        const row = dataSeries[i];
        for (let col of ['n1','n2','n3','n4','n5','n6']) longCount[row[col]]++;
    }
    const trend = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        const shortDensity = shortCount[i] / CONFIG.maShort;
        const longDensity = longCount[i] / CONFIG.maLong;
        if (longDensity > 0) trend[i] = shortDensity / longDensity;
        else if (shortDensity > 0) trend[i] = 1.2;
        else trend[i] = 0.8;
        // 限制范围 0.5~1.5 然后归一化
        trend[i] = Math.min(1.5, Math.max(0.5, trend[i]));
    }
    // 归一化（使其与其它策略尺度一致）
    let maxT = Math.max(...trend.slice(1));
    for (let i = 1; i <= 49; i++) trend[i] = trend[i] / maxT;
    return trend;
}

// 策略4：马尔可夫链（基于前一期的6个号码对下一期每个号码的出现概率）
function calcMarkov(dataSeries, currentIdx) {
    if (currentIdx < 2) return new Array(50).fill(0.5);
    const trans = new Array(50).fill(0);
    const start = Math.max(0, currentIdx - CONFIG.markovLength);
    for (let t = start + 1; t < currentIdx; t++) {
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
    // 基于上一期号码预测
    const lastRow = dataSeries[currentIdx-1];
    const lastSet = new Set([lastRow.n1, lastRow.n2, lastRow.n3, lastRow.n4, lastRow.n5, lastRow.n6]);
    const markovScore = new Array(50).fill(0);
    for (let c = 1; c <= 49; c++) {
        let totalTrans = 0;
        for (let p of lastSet) totalTrans += trans[c]; // 简化：直接加总
        markovScore[c] = totalTrans;
    }
    return normalize(markovScore, 1);
}

// 策略5：江恩周期信号（检查号码出现间隔是否为周期的倍数）
function calcGannSignal(dataSeries, currentIdx) {
    // 计算每个号码上次出现的位置
    const lastSeen = new Array(50).fill(-1);
    for (let t = currentIdx-1; t >= 0; t--) {
        const row = dataSeries[t];
        for (let col of ['n1','n2','n3','n4','n5','n6']) {
            const num = row[col];
            if (lastSeen[num] === -1) lastSeen[num] = t;
        }
    }
    const signal = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        if (lastSeen[i] === -1) {
            // 从未出现过的号码给予基础分 0.3
            signal[i] = 0.3;
            continue;
        }
        const gap = currentIdx - lastSeen[i] - 1;
        for (let cycle of CONFIG.gannCycles) {
            // 如果间隔是周期的整数倍（且间隔>0），则增加信号强度
            if (gap > 0 && gap % cycle === 0) {
                signal[i] += 1.0;
            }
            // 同时也考虑间隔接近周期倍数（允许上下浮动1期）
            if (gap > 0 && Math.abs(gap % cycle - cycle) <= 1) {
                signal[i] += 0.5;
            }
        }
        // 限制最大信号值
        signal[i] = Math.min(1.5, signal[i]);
    }
    return normalize(signal, 1);
}

// 综合评分（多策略加权）
function getCombinedScores(dataSeries, currentIdx) {
    const longFreq = calcLongFreq(dataSeries, currentIdx);
    const shortActive = calcShortActive(dataSeries, currentIdx);
    const maTrend = calcMATrend(dataSeries, currentIdx);
    const markov = calcMarkov(dataSeries, currentIdx);
    const gann = calcGannSignal(dataSeries, currentIdx);
    
    const combined = new Array(50).fill(0);
    for (let i = 1; i <= 49; i++) {
        combined[i] = 
            CONFIG.weights.longFreq * longFreq[i] +
            CONFIG.weights.shortActive * shortActive[i] +
            CONFIG.weights.maTrend * maTrend[i] +
            CONFIG.weights.markov * markov[i] +
            CONFIG.weights.gann * gann[i];
    }
    return normalize(combined, 1);
}

// 构建候选池（30个号码）
function buildPool(dataSeries, currentIdx) {
    const scores = getCombinedScores(dataSeries, currentIdx);
    let candidates = Array.from({length:49}, (_,i)=>i+1);
    candidates.sort((a,b) => scores[b] - scores[a]);
    let pool = candidates.slice(0, CONFIG.poolSize);
    
    // 如果需要排除上期号码
    if (CONFIG.excludeLast && currentIdx > 0) {
        const latest = dataSeries[0];
        const excludeSet = new Set([latest.n1, latest.n2, latest.n3, latest.n4, latest.n5, latest.n6, latest.special]);
        pool = pool.filter(n => !excludeSet.has(n));
        // 如果排除后不足 poolSize，从后备中补充（按分数顺序）
        if (pool.length < CONFIG.poolSize) {
            let missing = CONFIG.poolSize - pool.length;
            let backup = candidates.filter(n => !pool.includes(n) && !excludeSet.has(n));
            pool.push(...backup.slice(0, missing));
        }
    }
    return pool;
}

// 从池中随机生成一注（6个号码）
function getRandomTicket(pool) {
    // 随机取6个不同号码
    let shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, 6).sort((a,b)=>a-b);
}

// 主要预测函数（导出供 index.html 使用）
export function predictTicketsFixed(dataSeries, nTickets) {
    if (!dataSeries || dataSeries.length === 0) return [];
    const currentIdx = dataSeries.length;
    const pool = buildPool(dataSeries, currentIdx);
    console.log("当前候选池 (前30):", pool.slice(0,30).sort((a,b)=>a-b));
    
    const tickets = [];
    for (let i = 0; i < nTickets; i++) {
        tickets.push(getRandomTicket(pool));
    }
    return tickets;
}

// 可选：导出配置，方便调试
export { CONFIG };
