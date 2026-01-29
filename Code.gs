/**
 * Code.gs (V3.1 潔淨版)
 * 專注於：庫存系統核心、網頁介面、排程報告
 * 已移除：WooCommerce 即時通知相關代碼
 */

// ==========================================
// 1. Web App 介面 (前台入口)
// ==========================================
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('在森林那邊庫存系統 V3')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 雖然我們關閉了 Webhook，但保留一個最簡單的 doPost 以防萬一 (避免報錯)
function doPost(e) {
  return ContentService.createTextOutput("OK");
}

// ==========================================
// 2. 排程任務 (建議設定觸發條件)
// ==========================================

// 📅 每週補貨報告 (建議設定：每週一早上 09:00)
function sendWeeklyRestockReport() {
  console.log("開始執行每週補貨檢查...");
  
  if (typeof InventoryManager === 'undefined' || typeof LineMessaging === 'undefined') {
    console.error("❌ 找不到必要的模組 (InventoryManager 或 LineMessaging)");
    return;
  }

  try {
    // 1. 刷新庫存計算
    InventoryManager.refreshDashboard();

    // 2. 檢查低水位
    const lowStock = InventoryManager.checkLowStockItems();

    // 3. 有缺貨才通知
    if (lowStock.length > 0) {
      let msg = `📅 【每週補貨提醒】\n目前有 ${lowStock.length} 項商品低於安全水位，請安排叫貨：\n\n`;
      msg += lowStock.map(i => `● ${i.name} (剩 ${i.stock})`).join('\n');
      msg += `\n\n(安全水位設定請參考 [04_SKU對照表] H 欄)`;

      LineMessaging.sendPush(msg);
    }
  } catch (e) {
    console.error("❌ 補貨報告執行失敗: " + e.toString());
  }
}

// ☀️ 每日晨報/撿貨通知 (通常由前端按鈕觸發，但也保留可排程執行的接口)
function sendDailyMorningReport() {
  if (typeof InventoryManager === 'undefined' || typeof LineMessaging === 'undefined') return;
  try { InventoryManager.refreshDashboard(); } catch(e) {}
  
  const report = InventoryManager.getDailyReportText();
  if (report) { 
    LineMessaging.sendDailyReport(report);
  }
}

// ==========================================
// 3. 前端 API (給 index.html 呼叫用)
// ==========================================

// 取得 SKU 列表 (用於下拉選單)
function getSkuList() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[04_SKU對照表]');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  // 過濾掉刪除或組合商品
  let items = data.filter(row => row[0] !== "" && !row[5].includes("Soft_Delete") && !row[5].includes("EOL") && row[6] !== "組合")
                  .map(row => ({ id: row[0], name: row[1], category: row[6] || "未分類" }));
  // 排序
  items.sort((a, b) => { 
    if (a.category !== b.category) return a.category.localeCompare(b.category); 
    return a.name.localeCompare(b.name); 
  });
  return items;
}

// 取得撿貨單預覽
function getPickingList() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[05_撿貨單]');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return data.map(row => { 
    if (row[0] instanceof Date) row[0] = Utilities.formatDate(row[0], Session.getScriptTimeZone(), "MM/dd"); 
    return row; 
  });
}

// 取得儀表板庫存狀態 (前端顯示紅綠燈用)
function getInventoryStatus() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[00_儀表板]');
  const skuSheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[04_SKU對照表]');
  
  const lastRow = sheet.getLastRow(); 
  const skuLastRow = skuSheet.getLastRow();
  
  if (lastRow < 2) return [];
  
  const dashData = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  if (skuLastRow < 2) return []; 
  
  const skuData = skuSheet.getRange(2, 1, skuLastRow - 1, 8).getValues();
  const skuInfoMap = {};
  
  skuData.forEach(row => { 
    skuInfoMap[row[0]] = { 
      category: row[6] || "未分類", 
      safetyStock: (row[7] === "" || row[7] == null) ? 5 : parseInt(row[7]) 
    }; 
  });
  
  const result = [];
  dashData.forEach(row => {
    const sku = row[1]; 
    const info = skuInfoMap[sku] || { category: "未分類", safetyStock: 5 };
    
    if (info.category === '組合') return; // 不顯示虛擬組合
    
    const stock = parseInt(row[2]) || 0; 
    const isLow = stock <= info.safetyStock;
    
    result.push({ 
      name: row[0], 
      id: sku, 
      stock: stock, 
      status: isLow ? "⚠️ 需補貨" : "✅ 正常", 
      rawStatus: row[3], 
      category: info.category, 
      safetyStock: info.safetyStock, 
      isLow: isLow 
    });
  });
  return result;
}

// 提交生產入庫
function submitProduction(sku, qty, operator) {
  const lock = LockService.getScriptLock();
  try { 
    if (!lock.tryLock(10000)) throw new Error('系統忙碌中 (Timeout)');
    const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[02_生產紀錄]');
    sheet.appendRow([new Date(), sku, qty, `App入庫 (${operator})`]);
    try { if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard(); } catch(e) {}
  } catch (e) { throw e; } finally { lock.releaseLock(); }
}

// 盤點修正 (直接調整到指定數量)
function adjustInventory(sku, targetQty, operator) {
  const lock = LockService.getScriptLock();
  try { 
    if (!lock.tryLock(10000)) throw new Error('系統忙碌中 (Timeout)');
    
    const currentStock = getCurrentStockOf(sku); 
    const delta = parseInt(targetQty) - currentStock; 
    
    if (delta === 0) return; 
    
    const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[02_生產紀錄]');
    sheet.appendRow([new Date(), sku, delta, `盤點修正 (${operator})`]);
    
    try { if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard(); } catch(e) {}
  } catch (e) { throw e; } finally { lock.releaseLock(); }
}

// 清除撿貨單暫存區 (每日重置用)
function clearStagingArea() {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const s = ss.getSheetByName('[00_數據暫存區]'); 
  if(s) { 
    s.getRange("A2:A").clearContent(); 
    s.getRange("C2:J").clearContent(); 
  }
  const p = ss.getSheetByName('[05_撿貨單]'); 
  if(p && p.getLastRow()>1) {
    p.getRange(2,1,p.getLastRow()-1,p.getLastColumn()).clearContent();
  }
}

// 輔助函式：取得單一商品當前庫存
function getCurrentStockOf(sku) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[00_儀表板]');
  const data = sheet.getDataRange().getValues(); 
  for(let i=1; i<data.length; i++) { 
    if(data[i][1]==sku) return parseInt(data[i][2])||0; 
  } 
  return 0;
}