/**
 * Code.gs (V3.1)
 * 包含 WooCommerce Webhook 與 晨報排程
 */

// 1. Web App 介面
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('在森林那邊庫存系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 2. 接收 WooCommerce Webhook (新訂單通知)
function doPost(e) {
  // 如果是 LINE 平台的驗證請求，直接回傳 OK
  if (e && e.postData && e.postData.contents) {
     try {
       var check = JSON.parse(e.postData.contents);
       // 如果包含 events，代表是 LINE 來的 (可能是誤觸)，我們不處理，但也回個 OK
       if(check.events) return ContentService.createTextOutput("LINE Event Received");
     } catch(err) {}
  }

  // 正式處理 WooCommerce 資料
  let json = {};
  try {
    json = JSON.parse(e.postData.contents);
  } catch(err) {
    return ContentService.createTextOutput("Error");
  }

  // 提取訂單資訊
  const orderId = json.id; 
  const total = json.total;
  const items = json.line_items || [];
  
  if (!orderId) return ContentService.createTextOutput("No Order ID");

  // 組合訊息
  let msg = `💰 官網新訂單 #${orderId}\n金額: $${total}\n----------------`;
  items.slice(0, 5).forEach(item => { // 只顯示前5項
    msg += `\n📦 ${item.name} x ${item.quantity}`;
  });
  if (items.length > 5) msg += `\n...還有 ${items.length - 5} 項商品`;

  // 發送 LINE
  if (typeof LineMessaging !== 'undefined') {
    LineMessaging.sendPush(msg);
  }

  return ContentService.createTextOutput("Webhook Received");
}

// 3. 每日晨報 (排程執行)
function sendDailyMorningReport() {
  if (typeof InventoryManager === 'undefined' || typeof LineMessaging === 'undefined') return;
  try { InventoryManager.refreshDashboard(); } catch(e) {}
  
  const report = InventoryManager.getDailyReportText();
  if (report) { // 有異常才發
    LineMessaging.sendDailyReport(report);
  }
}

// ... (以下為讀取資料 API: getSkuList, getPickingList 等，請保持原樣不要動) ...
function getSkuList() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[04_SKU對照表]');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  let items = data.filter(row => row[0] !== "" && !row[5].includes("Soft_Delete") && !row[5].includes("EOL") && row[6] !== "組合").map(row => ({ id: row[0], name: row[1], category: row[6] || "未分類" }));
  items.sort((a, b) => { if (a.category !== b.category) return a.category.localeCompare(b.category); return a.name.localeCompare(b.name); });
  return items;
}
function getPickingList() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[05_撿貨單]');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return data.map(row => { if (row[0] instanceof Date) row[0] = Utilities.formatDate(row[0], Session.getScriptTimeZone(), "MM/dd"); return row; });
}
function getInventoryStatus() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[00_儀表板]');
  const skuSheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[04_SKU對照表]');
  const lastRow = sheet.getLastRow(); const skuLastRow = skuSheet.getLastRow();
  if (lastRow < 2) return [];
  const dashData = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  if (skuLastRow < 2) return []; 
  const skuData = skuSheet.getRange(2, 1, skuLastRow - 1, 8).getValues();
  const skuInfoMap = {};
  skuData.forEach(row => { skuInfoMap[row[0]] = { category: row[6] || "未分類", safetyStock: (row[7] === "" || row[7] == null) ? 5 : parseInt(row[7]) }; });
  const result = [];
  dashData.forEach(row => {
    const sku = row[1]; const info = skuInfoMap[sku] || { category: "未分類", safetyStock: 5 };
    if (info.category === '組合') return; 
    const stock = parseInt(row[2]) || 0; const isLow = stock <= info.safetyStock;
    result.push({ name: row[0], id: sku, stock: stock, status: isLow ? "⚠️ 需補貨" : "✅ 正常", rawStatus: row[3], category: info.category, safetyStock: info.safetyStock, isLow: isLow });
  });
  return result;
}
function submitProduction(sku, qty, operator) {
  const lock = LockService.getScriptLock();
  try { if (!lock.tryLock(10000)) throw new Error('系統忙碌中 (Timeout)');
    const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[02_生產紀錄]');
    sheet.appendRow([new Date(), sku, qty, `App入庫 (${operator})`]);
    try { if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard(); } catch(e) {}
  } catch (e) { throw e; } finally { lock.releaseLock(); }
}
function adjustInventory(sku, targetQty, operator) {
  const lock = LockService.getScriptLock();
  try { if (!lock.tryLock(10000)) throw new Error('系統忙碌中 (Timeout)');
    const currentStock = getCurrentStockOf(sku); const delta = parseInt(targetQty) - currentStock; if (delta === 0) return; 
    const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[02_生產紀錄]');
    sheet.appendRow([new Date(), sku, delta, `盤點修正 (${operator})`]);
    try { if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard(); } catch(e) {}
  } catch (e) { throw e; } finally { lock.releaseLock(); }
}
function clearStagingArea() {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const s = ss.getSheetByName('[00_數據暫存區]'); if(s) { s.getRange("A2:A").clearContent(); s.getRange("C2:J").clearContent(); }
  const p = ss.getSheetByName('[05_撿貨單]'); if(p && p.getLastRow()>1) p.getRange(2,1,p.getLastRow()-1,p.getLastColumn()).clearContent();
}
function getCurrentStockOf(sku) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[00_儀表板]');
  const data = sheet.getDataRange().getValues(); for(let i=1; i<data.length; i++) { if(data[i][1]==sku) return parseInt(data[i][2])||0; } return 0;
}
// 📅 每週補貨報告 (建議設定每週一早上執行)
function sendWeeklyRestockReport() {
  console.log("開始執行每週補貨檢查...");
  
  if (typeof InventoryManager === 'undefined' || typeof LineMessaging === 'undefined') {
    console.error("❌ 找不到必要的模組 (InventoryManager 或 LineMessaging)");
    return;
  }

  try {
    // 1. 先更新一次庫存，確保數字最新
    InventoryManager.refreshDashboard();

    // 2. 抓取低庫存商品
    const lowStock = InventoryManager.checkLowStockItems();

    // 3. 只有在「真的有東西要補」的時候才發送通知
    if (lowStock.length > 0) {
      let msg = `📅 【每週補貨提醒】\n目前有 ${lowStock.length} 項商品低於安全水位，請安排叫貨：\n\n`;
      
      // 列出商品與當前庫存
      msg += lowStock.map(i => `● ${i.name} (剩 ${i.stock})`).join('\n');
      
      msg += `\n\n(安全水位設定請參考 [04_SKU對照表] H 欄)`;

      // 發送 LINE
      LineMessaging.sendPush(msg);
      console.log("✅ 補貨通知已發送");
    } else {
      console.log("🎉 庫存充足，本週無需補貨通知。");
    }

  } catch (e) {
    console.error("❌ 補貨報告執行失敗: " + e.toString());
  }
}