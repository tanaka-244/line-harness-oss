/**
 * 西暦 → 和暦変換
 * 対応形式: "1990年1月15日" / "1990/1/15" / "1990-01-15"
 * 既に和暦の場合はそのまま返す
 */
export function convertToWareki(dateStr) {
    if (!dateStr)
        return '';
    const wareki = ['明治', '大正', '昭和', '平成', '令和'];
    for (const era of wareki) {
        if (dateStr.includes(era))
            return dateStr;
    }
    let match = dateStr.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!match) {
        match = dateStr.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
    }
    if (!match)
        return dateStr;
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);
    let eraName;
    let eraYear;
    if (year >= 2019) {
        if (year === 2019 && month < 5) {
            eraYear = 31;
            eraName = '平成';
        }
        else {
            eraYear = year - 2018;
            eraName = '令和';
        }
    }
    else if (year >= 1989) {
        if (year === 1989 && month === 1 && day < 8) {
            eraYear = 64;
            eraName = '昭和';
        }
        else {
            eraYear = year - 1988;
            eraName = '平成';
        }
    }
    else if (year >= 1926) {
        if (year === 1926 && (month < 12 || (month === 12 && day < 25))) {
            eraYear = 15;
            eraName = '大正';
        }
        else {
            eraYear = year - 1925;
            eraName = '昭和';
        }
    }
    else if (year >= 1912) {
        if (year === 1912 && (month < 7 || (month === 7 && day < 30))) {
            eraYear = 45;
            eraName = '明治';
        }
        else {
            eraYear = year - 1911;
            eraName = '大正';
        }
    }
    else {
        eraYear = year - 1867;
        eraName = '明治';
    }
    const yearStr = eraYear === 1 ? '元' : String(eraYear);
    return `${eraName}${yearStr}年${month}月${day}日`;
}
/**
 * 相対日付（昨日・3日前など）を年月日文字列に変換する（ケガ用）
 */
export function convertRelativeDate(dateStr, baseDate) {
    if (!dateStr)
        return '';
    const base = baseDate ?? new Date();
    // 既に年月日形式の場合はそのまま
    if (/\d{4}年\d{1,2}月\d{1,2}日/.test(dateStr))
        return dateStr;
    if (/\d{1,2}月\d{1,2}日/.test(dateStr))
        return dateStr;
    const relativeMap = {
        '今日': 0, '本日': 0,
        '昨日': -1,
        '一昨日': -2, 'おととい': -2,
        '3日前': -3, '三日前': -3,
        '4日前': -4, '四日前': -4,
        '5日前': -5, '五日前': -5,
        '1週間前': -7, '一週間前': -7,
        '2週間前': -14, '二週間前': -14,
        '1ヶ月前': -30, '一ヶ月前': -30,
    };
    for (const [pattern, days] of Object.entries(relativeMap)) {
        if (dateStr.includes(pattern)) {
            return formatDate(addDays(base, days));
        }
    }
    const numMatch = dateStr.match(/(\d+)日前/);
    if (numMatch) {
        return formatDate(addDays(base, -parseInt(numMatch[1])));
    }
    return dateStr;
}
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function formatDate(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${y}年${m}月${day}日`;
}
