/**
 * Code.gs - V2.5 (Stable Production)
 * 包含: LockService, User Log, 手機匯入觸發, 標準庫存讀取
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('在森林那邊庫存系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// --- 讀取類函式 ---

function getSkuList() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[04_SKU對照表]');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  // 讀取 A~G (包含分類)
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues(); 
  
  let items = data
    // 過濾掉 Soft_Delete, EOL, 以及 "組合" (入庫只入單品)
    .filter(row => row[0] !== "" && 
                   !row[5].includes("Soft_Delete") && 
                   !row[5].includes("EOL") &&
                   row[6] !== "組合") 
    .map(row => ({ 
      id: row[0], 
      name: row[1],
      category: row[6] || "未分類" 
    }));

  items.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.name.localeCompare(b.name);
  });

  return items;
}

function getPickingList() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[05_撿貨單]');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  // 修改：讀取 5 欄 [日期, 撿貨代碼, 訂單號, 物流, 平台]
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  
  return data.map(row => {
    if (row[0] instanceof Date) row[0] = Utilities.formatDate(row[0], Session.getScriptTimeZone(), "MM/dd");
    return row;
  });
}

function getInventoryStatus() {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[00_儀表板]');
  const skuSheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[04_SKU對照表]');
  
  const lastRow = sheet.getLastRow();
  const skuLastRow = skuSheet.getLastRow();
  
  if (lastRow < 2) return [];
  const dashData = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  
  if (skuLastRow < 2) return []; 
  // 讀取 A~H (包含安全庫存)
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
    
    // 庫存列表不顯示組合包
    if (info.category === '組合') return; 

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

// 產生撿貨單接口
function triggerManualImport(operator) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) throw new Error('系統忙碌中');
    const resultMsg = generateDailyPickingList(true);
    console.log(`Web App 匯入執行者: ${operator}`);
    return resultMsg;
  } catch (e) { throw e; } finally { lock.releaseLock(); }
}

// 【新增】撤銷接口
function triggerUndoImport(operator) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) throw new Error('系統忙碌中');
    // 呼叫 main.gs 的撤銷功能
    const resultMsg = undoLastImport(true);
    console.log(`Web App 撤銷執行者: ${operator}`);
    return resultMsg;
  } catch (e) { throw e; } finally { lock.releaseLock(); }
}

// --- 寫入類函式 (LockService 保護) ---

function submitProduction(sku, qty, operator) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) throw new Error('系統忙碌中 (Timeout)');

    const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[02_生產紀錄]');
    const note = `App入庫 (${operator})`;
    sheet.appendRow([new Date(), sku, qty, note]);
    
    // 寫入後嘗試重算儀表板
    try {
      if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard();
    } catch(e) { console.error(e); }

  } catch (e) {
    console.error("入庫失敗: " + e.toString());
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function adjustInventory(sku, targetQty, operator) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) throw new Error('系統忙碌中 (Timeout)');

    const currentStock = getCurrentStockOf(sku);
    const delta = parseInt(targetQty) - currentStock;
    if (delta === 0) return; 

    const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[02_生產紀錄]');
    const note = `盤點修正 (${operator})`;
    sheet.appendRow([new Date(), sku, delta, note]);

    try {
      if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard();
    } catch(e) { console.error(e); }

  } catch (e) {
    console.error("盤點失敗: " + e.toString());
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function clearStagingArea() {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  
  // 1. 清空 [00_數據暫存區]
  const stagingSheet = ss.getSheetByName('[00_數據暫存區]');
  if (stagingSheet) {
    stagingSheet.getRange("A2:A").clearContent();
    stagingSheet.getRange("C2:J").clearContent();
  }

  // 2. 清空 [05_撿貨單] (讓 App 變乾淨)
  const pickingSheet = ss.getSheetByName('[05_撿貨單]');
  if (pickingSheet && pickingSheet.getLastRow() > 1) {
    pickingSheet.getRange(2, 1, pickingSheet.getLastRow() - 1, pickingSheet.getLastColumn()).clearContent();
  }
}

// 輔助: 取得當前庫存 (為了計算 Delta)
function getCurrentStockOf(sku) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[00_儀表板]');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == sku) return parseInt(data[i][2]) || 0;
  }
  return 0;
}

// function triggerManualImport Removed (V2.3)