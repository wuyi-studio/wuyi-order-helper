/**
 * 梧藝 WUYI 下單小幫手 - Google Apps Script (Webhook 接收端 & 營運分析儀表板)
 * 試算表目標 ID: 1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU
 * 
 * 功能：
 *   1. 接收 Chrome 擴充功能「一鍵複製小卡」自動同步的訂單資料
 *   2. 防重複記錄：依據「取貨日期＋顧客姓名＋聯絡電話/LINE名稱」比對，已存在則覆寫更新，絕不重複插入
 *   3. 自動將訂單歸檔至「YYYY-MM」月份工作表 (支援 20 項標準欄位)
 *   4. 自動更新「📊 營運總覽與指標分析」儀表板：
 *      - 當年記錄 (營收、訂單數、客單價)
 *      - 當月記錄 (營收、訂單數、客單價)
 *      - 當週記錄 (本週營收、本週訂單數)
 *      - 當日記錄 (今日待取件數、今日取件清單)
 *      - 各項指標分析 (商品佔比、蛋糕尺寸排行、配件加購率、自取門市分佈)
 */

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);

    // 1. 綁定目標試算表
    var targetSpreadsheetId = "1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      ss = SpreadsheetApp.openById(targetSpreadsheetId);
    }

    // 2. 正規化取貨日期 (支援 1102 四碼格式與一般日期)
    var dateStr = normalizeDate(data.pickupDate);
    var sheetName = dateStr ? dateStr.substring(0, 7) : Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM");

    // 3. 取得或建立該月份工作表
    var sheet = ss.getSheetByName(sheetName);
    var headers = [
      "取貨日期", "星期", "顧客姓名", "聯絡電話", "LINE名稱",
      "商品類別", "蛋糕規格", "花束規格", "訂單總額", "蛋糕口味說明",
      "蛋糕題字/插牌內容", "慶祝歲數", "加購保冰袋", "加購餐具", "加購蠟燭",
      "加購插牌", "花束色系", "取件時間", "取件地點/配送", "原始備忘錄檔案"
    ];

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // 4. 計算 20 項標準欄位值
    var weekday = getWeekdayStr(dateStr);
    var customerName = (data.customerName || "").trim();
    var customerPhone = (data.customerPhone || "").replace(/[^\d]/g, "");
    var lineName = (data.lineName || "").trim();

    var orderType = "蛋糕";
    if (data.orderType === "flower") orderType = "花束";
    if (data.orderType === "combined") orderType = "蛋糕+花束";

    var cakeSize = data.cakeSize || "";
    var flowerSpec = data.flowerBudget ? "預算:" + data.flowerBudget : (data.flowerNote || "");
    var totalPrice = Number(data.totalPrice) || 0;
    var cakeFlavor = data.cakeFlavor || "";
    var inscription = data.cakeInscription || "";

    var ageMatch = inscription.match(/\b(\d{1,3})\b/);
    var age = ageMatch ? ageMatch[1] : "";

    var addonStr = data.addon || "";
    var hasIceBag = /保冷|保冰/.test(addonStr) ? "是" : "否";
    var hasCutlery = /餐具|盤/.test(addonStr) ? "是" : "否";
    var hasCandle = /蠟燭/.test(addonStr) ? "是" : "否";
    var hasTopper = /插牌/.test(addonStr) ? "是" : "否";

    var flowerColor = data.flowerColor || "";
    var pickupTime = data.pickupTime || "";
    var location = data.location || "台南友愛門市自取";
    var sourceNote = "WUYI小幫手_" + Utilities.formatDate(new Date(), "GMT+8", "yyyyMMdd_HHmmss");

    var rowValues = [
      dateStr, weekday, customerName, customerPhone, lineName,
      orderType, cakeSize, flowerSpec, totalPrice, cakeFlavor,
      inscription, age, hasIceBag, hasCutlery, hasCandle,
      hasTopper, flowerColor, pickupTime, location, sourceNote
    ];

    // 5. 比對重複 (Upsert 防止重複記錄)
    var lastRow = sheet.getLastRow();
    var foundRow = -1;

    if (lastRow > 1) {
      var existingData = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = 0; i < existingData.length; i++) {
        var rDate = existingData[i][0] ? Utilities.formatDate(new Date(existingData[i][0]), "GMT+8", "yyyy-MM-dd") : "";
        var rName = (existingData[i][2] || "").toString().trim();
        var rPhone = (existingData[i][3] || "").toString().replace(/[^\d]/g, "");
        var rLine = (existingData[i][4] || "").toString().trim();

        // 日期相同，且 (電話相同 或 姓名相同 或 LINE名稱相同) 即視為同一筆訂單更新
        var isDuplicate = (rDate === dateStr) && (
          (customerPhone && rPhone === customerPhone) ||
          (customerName && rName === customerName) ||
          (lineName && rLine === lineName)
        );

        if (isDuplicate) {
          foundRow = i + 2;
          break;
        }
      }
    }

    if (foundRow > 0) {
      // 覆寫更新既有列 (不重複新增)
      sheet.getRange(foundRow, 1, 1, headers.length).setValues([rowValues]);
    } else {
      // 全新訂單新增列
      sheet.appendRow(rowValues);
    }

    // 6. 即時自動重新整理「營運總覽與指標分析」儀表板
    try {
      updateAnalyticsDashboard(ss);
    } catch (dashErr) {
      console.warn("Dashboard update warning: " + dashErr.toString());
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      action: foundRow > 0 ? "updated" : "inserted",
      row: foundRow > 0 ? foundRow : sheet.getLastRow(),
      sheet: sheetName
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 試算表開啟時自訂選單
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍰 梧藝營運系統')
    .addItem('🔄 立即重新整理指標分析儀表板', 'manualRefreshDashboard')
    .addToUi();
}

function manualRefreshDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  updateAnalyticsDashboard(ss);
  SpreadsheetApp.getActiveSpreadsheet().toast('✅ 營運指標分析儀表板已更新！', '梧藝下單小幫手', 3);
}

/**
 * 即時計算並更新「📊 營運總覽與指標分析」工作表
 */
function updateAnalyticsDashboard(ss) {
  var dashName = "📊 營運總覽與指標分析";
  var dash = ss.getSheetByName(dashName);
  if (!dash) {
    dash = ss.insertSheet(dashName, 0); // 置於最左側第一個分頁
  }

  // 1. 蒐集所有月份訂單資料
  var now = new Date();
  var todayStr = Utilities.formatDate(now, "GMT+8", "yyyy-MM-dd");
  var currentMonthStr = todayStr.substring(0, 7);
  var currentYearStr = todayStr.substring(0, 4);

  // 計算本週區間 (週一至週日)
  var dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1(Mon) ~ 7(Sun)
  var monday = new Date(now.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000);
  var sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  var mondayStr = Utilities.formatDate(monday, "GMT+8", "yyyy-MM-dd");
  var sundayStr = Utilities.formatDate(sunday, "GMT+8", "yyyy-MM-dd");

  var sheets = ss.getSheets();
  var allOrders = [];

  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var sName = s.getName();
    // 篩選 YYYY-MM 格式工作表
    if (/^\d{4}-\d{2}$/.test(sName)) {
      var lastR = s.getLastRow();
      if (lastR > 1) {
        var vals = s.getRange(2, 1, lastR - 1, 20).getValues();
        for (var j = 0; j < vals.length; j++) {
          var row = vals[j];
          var rawDate = row[0];
          var dateFormatted = "";
          if (rawDate instanceof Date) {
            dateFormatted = Utilities.formatDate(rawDate, "GMT+8", "yyyy-MM-dd");
          } else if (rawDate) {
            dateFormatted = rawDate.toString().trim();
          }

          allOrders.push({
            date: dateFormatted,
            weekday: row[1],
            name: row[2],
            phone: row[3],
            lineName: row[4],
            orderType: row[5],
            cakeSize: row[6],
            flowerSpec: row[7],
            totalPrice: Number(row[8]) || 0,
            cakeFlavor: row[9],
            inscription: row[10],
            age: row[11],
            hasIceBag: row[12] === "是",
            hasCutlery: row[13] === "是",
            hasCandle: row[14] === "是",
            hasTopper: row[15] === "是",
            flowerColor: row[16],
            pickupTime: row[17],
            location: row[18]
          });
        }
      }
    }
  }

  // 2. 指標統計聚合
  var stats = {
    // 當年
    yearOrders: 0,
    yearRevenue: 0,
    // 當月
    monthOrders: 0,
    monthRevenue: 0,
    // 當週
    weekOrders: 0,
    weekRevenue: 0,
    // 當日
    todayOrders: 0,
    todayRevenue: 0,
    // 商品佔比
    cakeCount: 0,
    flowerCount: 0,
    combinedCount: 0,
    // 蛋糕尺寸分佈
    sizes: {},
    // 蛋糕口味分佈
    flavors: {},
    // 加購配件數
    iceBagCount: 0,
    cutleryCount: 0,
    candleCount: 0,
    topperCount: 0,
    // 今日取貨名單
    todayPickups: []
  };

  for (var k = 0; k < allOrders.length; k++) {
    var ord = allOrders[k];
    var d = ord.date;
    var rev = ord.totalPrice;

    // 當年
    if (d.startsWith(currentYearStr)) {
      stats.yearOrders++;
      stats.yearRevenue += rev;
    }

    // 當月
    if (d.startsWith(currentMonthStr)) {
      stats.monthOrders++;
      stats.monthRevenue += rev;
    }

    // 當週
    if (d >= mondayStr && d <= sundayStr) {
      stats.weekOrders++;
      stats.weekRevenue += rev;
    }

    // 當日
    if (d === todayStr) {
      stats.todayOrders++;
      stats.todayRevenue += rev;
      stats.todayPickups.push(ord);
    }

    // 商品佔比
    if (ord.orderType === "蛋糕") stats.cakeCount++;
    else if (ord.orderType === "花束") stats.flowerCount++;
    else if (ord.orderType === "蛋糕+花束") stats.combinedCount++;

    // 尺寸
    if (ord.cakeSize) {
      stats.sizes[ord.cakeSize] = (stats.sizes[ord.cakeSize] || 0) + 1;
    }

    // 加購
    if (ord.hasIceBag) stats.iceBagCount++;
    if (ord.hasCutlery) stats.cutleryCount++;
    if (ord.hasCandle) stats.candleCount++;
    if (ord.hasTopper) stats.topperCount++;
  }

  var yearAOV = stats.yearOrders > 0 ? Math.round(stats.yearRevenue / stats.yearOrders) : 0;
  var monthAOV = stats.monthOrders > 0 ? Math.round(stats.monthRevenue / stats.monthOrders) : 0;

  // 3. 繪製儀表板內容
  dash.clear();
  dash.setTabColor("#7C3AED");

  // 標題列
  dash.getRange("A1:G1").merge()
    .setValue("🍰 梧藝 WUYI 甜點花藝 · 營運總覽與指標分析儀表板")
    .setFontSize(16).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.setRowHeight(1, 45);

  dash.getRange("A2:G2").merge()
    .setValue("⏰ 最後即時更新時間：" + Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd HH:mm:ss") + "  |  今日日期：" + todayStr + " (" + getWeekdayStr(todayStr) + ")")
    .setFontSize(10).setFontColor("#64748B").setHorizontalAlignment("center").setBackground("#F8FAFC");
  dash.setRowHeight(2, 26);

  // 區間統計 KPI 卡片 (第 4~6 列)
  dash.getRange("A4").setValue("🌟 當年營運累計 (" + currentYearStr + " 年)").setFontWeight("bold").setFontSize(11);
  dash.getRange("B4").setValue("訂單總量: " + stats.yearOrders + " 筆").setFontColor("#0284C7");
  dash.getRange("C4").setValue("總營業額: $" + stats.yearRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#0F172A");
  dash.getRange("D4").setValue("平均客單價: $" + yearAOV.toLocaleString()).setFontColor("#475569");

  dash.getRange("A5").setValue("📅 當月營運累計 (" + currentMonthStr + " 月)").setFontWeight("bold").setFontSize(11);
  dash.getRange("B5").setValue("訂單總量: " + stats.monthOrders + " 筆").setFontColor("#0284C7");
  dash.getRange("C5").setValue("總營業額: $" + stats.monthRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#7C3AED");
  dash.getRange("D5").setValue("平均客單價: $" + monthAOV.toLocaleString()).setFontColor("#475569");

  dash.getRange("A6").setValue("⚡ 當週營運累計 (" + mondayStr.substring(5) + " ~ " + sundayStr.substring(5) + ")").setFontWeight("bold").setFontSize(11);
  dash.getRange("B6").setValue("訂單總量: " + stats.weekOrders + " 筆").setFontColor("#0284C7");
  dash.getRange("C6").setValue("總營業額: $" + stats.weekRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#059669");

  dash.getRange("A7").setValue("📍 當日預約取貨 (" + todayStr + ")").setFontWeight("bold").setFontSize(11);
  dash.getRange("B7").setValue("待取件數: " + stats.todayOrders + " 筆").setFontWeight("bold").setFontColor("#DC2626");
  dash.getRange("C7").setValue("當日金額: $" + stats.todayRevenue.toLocaleString()).setFontWeight("bold").setFontColor("#DC2626");

  dash.getRange("A4:D7").setBackground("#F1F5F9").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);

  // 指標分析 1：商品類別佔比 (A9:D13)
  var totalOrders = allOrders.length || 1;
  dash.getRange("A9:D9").merge().setValue("📊 商品類別銷售分佈").setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
  dash.getRange("A10:D10").setValues([["類別", "銷售筆數", "總量佔比", "狀態"]]).setFontWeight("bold").setBackground("#E2E8F0");
  dash.getRange("A11:D13").setValues([
    ["🎂 客製蛋糕", stats.cakeCount, (stats.cakeCount / totalOrders * 100).toFixed(1) + "%", stats.cakeCount > 0 ? "主力商品" : "-"],
    ["💐 精緻花束", stats.flowerCount, (stats.flowerCount / totalOrders * 100).toFixed(1) + "%", "-"],
    ["🎁 蛋糕+花束組合", stats.combinedCount, (stats.combinedCount / totalOrders * 100).toFixed(1) + "%", stats.combinedCount > 0 ? "高單價組合" : "-"]
  ]).setBackground("#FFFFFF");
  dash.getRange("A9:D13").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);

  // 指標分析 2：加購配件轉換率分析 (F9:G13)
  dash.getRange("F9:G9").merge().setValue("🕯️ 加購配件轉換分析").setBackground("#7C3AED").setFontColor("#FFFFFF").setFontWeight("bold");
  dash.getRange("F10:G10").setValues([["加購項目", "加購次數 (轉換率)"]]).setFontWeight("bold").setBackground("#EDE9FE");
  dash.getRange("F11:G14").setValues([
    ["🕯️ 造型蠟燭", stats.candleCount + " 筆 (" + (stats.candleCount / totalOrders * 100).toFixed(1) + "%)"],
    ["❄️ 保冷袋", stats.iceBagCount + " 筆 (" + (stats.iceBagCount / totalOrders * 100).toFixed(1) + "%)"],
    ["🍴 派對餐具", stats.cutleryCount + " 筆 (" + (stats.cutleryCount / totalOrders * 100).toFixed(1) + "%)"],
    ["🎉 慶祝插牌", stats.topperCount + " 筆 (" + (stats.topperCount / totalOrders * 100).toFixed(1) + "%)"]
  ]).setBackground("#FFFFFF");
  dash.getRange("F9:G14").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);

  // 當日取貨清單即時看板 (A16 開始)
  dash.getRange("A16:G16").merge().setValue("📋 今日取件即時清單 (" + todayStr + " 共 " + stats.todayOrders + " 筆)").setBackground("#DC2626").setFontColor("#FFFFFF").setFontWeight("bold");
  var pickupHeaders = ["取件時間", "顧客姓名", "聯絡電話", "LINE名稱", "商品規格", "口味/備註", "訂單金額"];
  dash.getRange("A17:G17").setValues([pickupHeaders]).setBackground("#FEE2E2").setFontWeight("bold");

  if (stats.todayPickups.length > 0) {
    var pRows = [];
    for (var m = 0; m < stats.todayPickups.length; m++) {
      var po = stats.todayPickups[m];
      pRows.push([
        po.pickupTime || "未定",
        po.name,
        po.phone,
        po.lineName,
        po.cakeSize || po.flowerSpec || po.orderType,
        po.cakeFlavor || po.inscription || "",
        po.totalPrice ? "$" + po.totalPrice : ""
      ]);
    }
    dash.getRange(18, 1, pRows.length, 7).setValues(pRows).setBackground("#FFFFFF");
    dash.getRange(16, 1, pRows.length + 2, 7).setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
  } else {
    dash.getRange("A18:G18").merge().setValue("今日尚無預約取件訂單").setHorizontalAlignment("center").setFontColor("#94A3B8").setBackground("#FFFFFF");
    dash.getRange("A16:G18").setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
  }

  // 自動調整欄寬
  for (var c = 1; c <= 7; c++) {
    dash.autoResizeColumn(c);
    var currentW = dash.getColumnWidth(c);
    if (currentW < 120) dash.setColumnWidth(c, 120);
  }
}

// 輔助函式：日期正規化為 YYYY-MM-DD
function normalizeDate(raw) {
  if (!raw) return Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM-dd");
  var str = raw.toString().trim();
  var currentYear = new Date().getFullYear();

  // 支援 4 碼純數字 (例如 1102 -> YYYY-11-02)
  if (/^\d{4}$/.test(str)) {
    var m = str.substring(0, 2);
    var d = str.substring(2, 4);
    return currentYear + "-" + m + "-" + d;
  }

  str = str.replace(/[\/\.]/g, "-");
  var parts = str.split("-");

  if (parts.length === 3) {
    var y = parts[0].length === 4 ? parts[0] : currentYear;
    var m = parts[1].padStart(2, "0");
    var d = parts[2].padStart(2, "0");
    return y + "-" + m + "-" + d;
  } else if (parts.length === 2) {
    var m = parts[0].padStart(2, "0");
    var d = parts[1].padStart(2, "0");
    return currentYear + "-" + m + "-" + d;
  }
  return str;
}

// 輔助函式：星期推算
function getWeekdayStr(dateStr) {
  try {
    var parts = dateStr.split("-");
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var days = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    return days[d.getDay()] || "";
  } catch (e) {
    return "";
  }
}
