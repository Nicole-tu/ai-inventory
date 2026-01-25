/**
 * main.gs - V2.3 (Stable Production)
 * 負責: 解析訂單 -> 炸開組合包 -> 寫入銷售流水帳 -> 產出撿貨單 -> 觸發庫存重算
 */


function generateDailyPickingList(isWebApp = false) {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const stagingSheet = ss.getSheetByName('[00_數據暫存區]');
  
  if (!stagingSheet) {
    const msg = '❌ 錯誤：找不到 [00_數據暫存區]';
    return isWebApp ? msg : SpreadsheetApp.getUi().alert(msg);
  }

  // 1. 讀取資料
  const shopeeRawData = stagingSheet.getRange("A2:A").getValues().flat().filter(String).join("\n");
  const wooLastRow = stagingSheet.getLastRow();
  const wooRawData = wooLastRow > 1 ? stagingSheet.getRange(2, 3, wooLastRow - 1, 8).getValues() : [];

  let allOrders = [];

  // 2. 解析蝦皮
  if (shopeeRawData && typeof ShopeeTextParser !== 'undefined') {
    try {
      const shopeeOrders = ShopeeTextParser.parseShopeeData(shopeeRawData);
      allOrders = allOrders.concat(shopeeOrders);
      console.log(`蝦皮解析完成: ${shopeeOrders.length} 筆`);
    } catch (e) {
      console.error("蝦皮解析失敗: " + e.toString());
      if (!isWebApp) SpreadsheetApp.getUi().alert("❌ 蝦皮資料解析失敗，請檢查格式。");
    }
  }

  // 3. 解析官網 (由 Parser 直接寫入 Sales & Picking)
  let wooCount = 0;
  if (wooRawData.length > 0 && typeof WooCommerceParser !== 'undefined') {
    try {
      // Parser 內部會自行讀取 Sheet 並寫入，不需要傳入資料，回傳的是筆數
      wooCount = WooCommerceParser.parseWooData(true); 
      console.log(`官網解析完成: ${wooCount} 筆 (已自動寫入資料庫)`);
    } catch (e) {
      console.error("官網解析失敗: " + e.toString());
    }
  }

  if (allOrders.length === 0 && wooCount === 0) {
    const msg = '⚠️ 沒有偵測到任何訂單資料。';
    return isWebApp ? msg : SpreadsheetApp.getUi().alert(msg);
  }

  // 4. 寫入 [03_銷售數據池] (僅針對 Shopee 資料，WooCommerce 已在 Parser 內寫入)
  if (allOrders.length > 0) {
    saveToSalesDatabase(allOrders);
  }

  // 5. 寫入 [05_撿貨單] (V2.3 邏輯：不合併，逐列寫入)
  if (allOrders.length > 0) {
    saveToPickingList(allOrders);
  }

  // 重要：強制刷新 Spreadsheet 確保資料已寫入，InventoryManager 才能讀到最新數據
  SpreadsheetApp.flush();

  // 6. 強制重算庫存
  try {
    if (typeof InventoryManager !== 'undefined') {
      InventoryManager.refreshDashboard();
      console.log("✅ 儀表板已更新");
    }
  } catch (e) {
    console.error("儀表板更新失敗: " + e.toString());
  }

  const finalMsg = `✅ 處理完成！\n蝦皮: ${allOrders.length} 筆, 官網: ${wooCount} 筆。\n庫存已扣除，撿貨單已產出。`;
  return isWebApp ? finalMsg : SpreadsheetApp.getUi().alert(finalMsg);
}

// --- 輔助函式 ---

function saveToSalesDatabase(orders) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[03_銷售數據池]');
  const newRows = [];
  orders.forEach(order => {
    // 關鍵：炸開組合包 (A*10 -> 10個A)
    const items = expandSku(order.sku, order.qty);
    items.forEach(item => {
      newRows.push([
        order.date, order.platform, order.orderId, item.sku, item.qty, order.raw
      ]);
    });
  });
  if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
}

function saveToPickingList(orders) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[05_撿貨單]');
  // 先清空舊資料
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clearContent();

  // V2.3 邏輯：不合併，每筆訂單明細為一列
  // 顯示格式: "3雪" (若有物流單號則是 "3雪 3871")
  
  const newRows = orders.map(order => {
    // 撿貨內容: "數量+簡稱"
    let content = `${order.qty}${order.productName}`;
    
    // 物流單號後4碼
    let last4 = "";
    if (order.trackingNumber && order.trackingNumber.length >= 4) {
      last4 = order.trackingNumber.slice(-4);
    }
    
    if (last4) {
      content += ` ${last4}`;
    }
    
    return [order.date, content, order.orderId, order.logistics];
  });

  if (newRows.length > 0) sheet.getRange(2, 1, newRows.length, 4).setValues(newRows);
}

function expandSku(skuStr, orderQty) {
  if (!skuStr) return [];
  const results = [];
  const parts = skuStr.split(',');
  parts.forEach(part => {
    part = part.trim();
    if (!part) return;
    let finalSku = part;
    let multiplier = 1;
    if (part.includes('*')) {
      const subParts = part.split('*');
      finalSku = subParts[0].trim();
      multiplier = parseInt(subParts[1]) || 1;
    }
    const finalQty = orderQty * multiplier;
    results.push({ sku: finalSku, qty: finalQty });
  });
  return results;
}