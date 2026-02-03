/**
 * main.gs (V3.1_Broadcasting)
 * 修改：匯入廣播包含：統計、撿貨單、超賣警報、叫貨提醒。
 */
function generateDailyPickingList(isWebApp = false) {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const stagingSheet = ss.getSheetByName('[00_數據暫存區]');
  if (!stagingSheet) return response("❌ 找不到 [00_數據暫存區]", isWebApp);

  const shopeeRawData = stagingSheet.getRange("A2:A").getValues().flat().filter(String).join("\n");
  const lastRow = stagingSheet.getLastRow();
  const wooRawData = lastRow > 1 ? stagingSheet.getRange(2, 3, lastRow - 1, 8).getValues() : [];

  let allOrders = [];
  let shopeeCount = 0;
  let wooCount = 0;

  // 1. 解析
  if (shopeeRawData && typeof ShopeeTextParser !== 'undefined') {
    try {
      const sOrders = ShopeeTextParser.parseShopeeData(shopeeRawData);
      shopeeCount = (new Set(sOrders.map(o => o.orderId))).size;
      allOrders = allOrders.concat(sOrders);
    } catch (e) { console.error(e); }
  }
  if (wooRawData.length > 0 && typeof WooCommerceParser !== 'undefined') {
    try {
      const wOrders = WooCommerceParser.parseWooData(wooRawData);
      wooCount = (new Set(wOrders.map(o => o.orderId))).size;
      allOrders = allOrders.concat(wOrders);
    } catch (e) { console.error(e); }
  }

  if (allOrders.length === 0) return response('⚠️ 無有效訂單', isWebApp);

  // 2. 寫入 DB
  saveToSalesDatabase(allOrders);
  // 3. 寫入撿貨單 (取得文字)
  const pickingText = saveToPickingList(allOrders);

  SpreadsheetApp.flush(); 

  // 4. 更新庫存 & 準備通知
  let invMsg = "";
  let alertMsg = "";
  let lineAlertText = "";
  let debugLog = "";
  
  if (typeof InventoryManager !== 'undefined') {
    try {
      debugLog = InventoryManager.refreshDashboard();
      
      const oversold = InventoryManager.checkOversoldItems();
      const lowStock = InventoryManager.checkLowStockItems();
      
      if (oversold.length > 0) {
        lineAlertText += `🔥 【嚴重超賣】 (需處理)：\n${oversold.map(i => `- ${i.name} (${i.stock})`).join('\n')}\n\n`;
        alertMsg = `🔥 嚴重超賣：\n${oversold.map(i => `${i.name}`).join(',')}`;
      }
      
      // ❌ 修改點：把下面這段「低庫存」註解掉，讓它不要出現在每日通知裡
      // if (lowStock.length > 0) {
      //   lineAlertText += `⚠️ 【低庫存預警】 (請叫貨)：\n${lowStock.map(i => `- ${i.name} (剩${i.stock})`).join('\n')}`;
      // }
      
      invMsg = "庫存已更新";
    } catch (e) { invMsg = "❌ 庫存計算失敗"; }
  }

  // --- 修正點開始：把 total 定義移到這裡 ---
  const total = shopeeCount + wooCount;
  // -------------------------------------

  // 5. 發送 LINE 廣播
  if (typeof LineMessaging !== 'undefined') {
    // 這裡原本定義 total 的地方刪掉，直接用上面的 total
    let lineMsg = `📣 【撿貨作業通知】\n訂單已匯入，請開始作業。\n\n📊 匯入統計：\n官網: ${wooCount} | 蝦皮: ${shopeeCount} | 總計: ${total}`;
    
    if (pickingText) lineMsg += `\n\n📋 撿貨清單：\n${pickingText}`;

    if (lineAlertText) {
      lineMsg += `\n\n----------------\n${lineAlertText}\n----------------`;
    }

    LineMessaging.sendPush(lineMsg);
  }

  const frontAlert = alertMsg ? `\n🔥 嚴重警告：\n${alertMsg}` : "";
  // 這裡現在可以讀到 total 了，不會再報錯
  return response(`✅ 成功！\n官網: ${wooCount} | 蝦皮: ${shopeeCount} | 總共: ${total}\n${frontAlert}\n\n${debugLog}`, isWebApp);
}

// ... (以下為輔助函式，請覆蓋 saveToPickingList 以支援回傳文字) ...

function saveToPickingList(orders) {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const sheet = ss.getSheetByName('[05_撿貨單]');
  const skuSheet = ss.getSheetByName('[04_SKU對照表]');

  // 1. 先建立 SKU -> 簡稱 的對照表 (為了把炸開後的 SKU 轉回簡稱)
  const skuData = skuSheet.getRange(2, 1, skuSheet.getLastRow() - 1, 3).getValues();
  const skuToAbbrMap = {};
  skuData.forEach(row => {
    // row[0] = 內部SKU, row[2] = 撿貨簡稱
    // 我們只存「單品」的簡稱，因為組合包已經被炸開了，用不到組合包的簡稱
    if (row[0] && row[2]) {
      skuToAbbrMap[String(row[0]).trim()] = String(row[2]).trim();
    }
  });

  // 清空舊資料
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  
  const ordersMap = {};

  orders.forEach(order => {
    const oid = order.orderId;
    if (!ordersMap[oid]) {
      ordersMap[oid] = { 
        date: order.date, 
        logistics: order.logistics, 
        tracking: order.trackingNumber || "", 
        platform: order.platform, 
        items: {} // 這裡改用 SKU 當 key，而不是簡稱
      };
    }

    // 🔥 關鍵改變：使用 expandSku 把商品「炸開」成單品
    // 假設 order.sku 是 "wo_loofah_01*10" 且 qty 是 2
    // expandSku 會回傳 [{sku: "wo_loofah_01", qty: 20}]
    const components = expandSku(order.sku, order.qty);

    components.forEach(comp => {
      // 嘗試找出單品的簡稱 (例如 wo_loofah_01 -> 菜)
      // 如果找不到 (可能是新品)，就暫時顯示 SKU 本身
      const abbr = skuToAbbrMap[comp.sku] || comp.sku; 

      if (!ordersMap[oid].items[abbr]) {
        ordersMap[oid].items[abbr] = 0;
      }
      // 累加數量
      ordersMap[oid].items[abbr] += comp.qty;
    });
  });

  // 3. 轉成文字格式
  const newRows = Object.keys(ordersMap).map(oid => {
    const o = ordersMap[oid];
    
    // 組合字串：數量 + 簡稱 (例如 "20菜")
    const itemStr = Object.entries(o.items)
      .map(([abbr, qty]) => `${qty}${abbr}`)
      .join(' ');

    let tracking = o.tracking;
    if (tracking.length >= 4) tracking = tracking.slice(-4); // 只取後四碼
    
    let finalStr = itemStr;
    const isShopeeXpress = o.logistics.includes("蝦皮店到店");
    
    // 特殊邏輯：如果是蝦皮店到店，且內容只有 "1大" (大長砧)，則隱藏單號 (讓畫面乾淨)
    // 注意：這裡的 "1大" 是指炸開後的結果
    const isOneBigOnly = (itemStr === "1大"); 

    if (tracking) {
      if (!(isShopeeXpress && isOneBigOnly)) finalStr += ` ${tracking}`;
    }
    
    if (!isShopeeXpress) finalStr += ` (${o.logistics})`;
    
    return [o.date, finalStr, oid, o.logistics, o.platform];
  });

  if (newRows.length > 0) sheet.getRange(2, 1, newRows.length, 5).setValues(newRows);
  
  return newRows.map(row => row[1]).join('\n');
}

function undoLastImport(isWebApp = false) {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const stagingSheet = ss.getSheetByName('[00_數據暫存區]');
  const shopeeRawData = stagingSheet.getRange("A2:A").getValues().flat().filter(String).join("\n");
  const lastRow = stagingSheet.getLastRow();
  const wooRawData = lastRow > 1 ? stagingSheet.getRange(2, 3, lastRow - 1, 8).getValues() : [];
  let orderIdsToRemove = [];
  if (shopeeRawData && typeof ShopeeTextParser !== 'undefined') {
    try { const sOrders = ShopeeTextParser.parseShopeeData(shopeeRawData); sOrders.forEach(o => orderIdsToRemove.push(o.orderId)); } catch (e) {}
  }
  if (wooRawData.length > 0 && typeof WooCommerceParser !== 'undefined') {
    try { const wOrders = WooCommerceParser.parseWooData(wooRawData); wOrders.forEach(o => orderIdsToRemove.push(o.orderId)); } catch (e) {}
  }
  orderIdsToRemove = [...new Set(orderIdsToRemove)];
  if (orderIdsToRemove.length === 0) return response("⚠️ 無法識別訂單號", isWebApp);
  const dbSheet = ss.getSheetByName('[03_銷售數據池]');
  const dbLastRow = dbSheet.getLastRow();
  let deletedCount = 0;
  if (dbLastRow > 1) {
    const data = dbSheet.getRange(2, 1, dbLastRow - 1, 3).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (orderIdsToRemove.includes(String(data[i][2]))) {
        dbSheet.deleteRow(i + 2);
        deletedCount++;
      }
    }
  }
  const pickSheet = ss.getSheetByName('[05_撿貨單]');
  if (pickSheet.getLastRow() > 1) pickSheet.getRange(2, 1, pickSheet.getLastRow() - 1, 5).clearContent();
  try { if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard(); } catch (e) {}
  
  if (typeof LineMessaging !== 'undefined') {
    LineMessaging.sendPush(`↩️ 【作業取消】\n剛剛的匯入已復原 (刪除 ${deletedCount} 筆)，請暫停撿貨。`);
  }
  return response(`✅ 已回復上一步！\n刪除 ${deletedCount} 筆紀錄。\n庫存已復原。`, isWebApp);
}

function response(msg, isWebApp) { if (isWebApp) return msg; else { SpreadsheetApp.getUi().alert(msg); return msg; } }
function saveToSalesDatabase(orders) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[03_銷售數據池]');
  const newRows = [];
  orders.forEach(order => {
    const items = expandSku(order.sku, order.qty);
    items.forEach(item => { newRows.push([order.date, order.platform, order.orderId, item.sku, item.qty, order.raw]); });
  });
  if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
}
function expandSku(skuStr, orderQty) {
  if (!skuStr) return [];
  const results = [];
  const parts = skuStr.split(',');
  parts.forEach(part => {
    part = part.trim(); if (!part) return;
    let finalSku = part; let multiplier = 1;
    if (part.includes('*')) { const subParts = part.split('*'); finalSku = subParts[0].trim(); multiplier = parseInt(subParts[1]) || 1; }
    results.push({ sku: finalSku, qty: orderQty * multiplier });
  });
  return results;
}
// 這是為了讓前端 HTML 按鈕找得到的函式名稱
function triggerManualImport() {
  // 呼叫我們主要寫好的 V3.1 邏輯，並傳入 true 代表這是從 Web App 呼叫的
  return generateDailyPickingList(true);
}
// 這是讓前端 HTML 按鈕找得到的「復原」函式名稱
function triggerUndoImport() {
  // 呼叫主程式的 undoLastImport，並傳入 true (代表是 Web App 呼叫的)
  return undoLastImport(true);
}

// 🚑 LINE 廣播診斷程式
function debugLineSystem() {
  console.log("=== 開始診斷 LINE 廣播系統 ===");
  
  // 1. 檢查鑰匙 (Script Properties)
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  var groupId = PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID');
  
  console.log("檢查設定檔...");
  if (!token) {
    console.error("❌ 失敗：找不到 'LINE_ACCESS_TOKEN'。請去「專案設定 -> 指令碼屬性」新增。");
  } else {
    console.log("✅ Token 讀取成功 (前五碼): " + token.substring(0, 5) + "...");
  }

  if (!groupId) {
    console.error("❌ 失敗：找不到 'LINE_GROUP_ID'。請去「專案設定 -> 指令碼屬性」新增。");
  } else {
    console.log("✅ Group ID 讀取成功: " + groupId);
  }

  // 2. 如果鑰匙都有，嘗試發送
  if (token && groupId) {
    console.log("嘗試發送測試訊息...");
    if (typeof LineMessaging !== 'undefined') {
      LineMessaging.sendPush("🔧 這是系統測試訊息，看到代表廣播功能正常！");
      console.log("✅ 發送指令已執行，請檢查手機 LINE 群組。");
    } else {
      console.error("❌ 失敗：找不到 'LineMessaging' 模組。請確認檔案是否存在。");
    }
  } else {
    console.log("⚠️ 因缺少設定，跳過發送測試。");
  }
  console.log("=== 診斷結束 ===");
}
