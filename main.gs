/**
 * main.gs (V2.8.1_DebugDisplay)
 * 修改：將 InventoryManager 回傳的查帳訊息顯示在前端 Alert 中。
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
      const shopeeOrders = ShopeeTextParser.parseShopeeData(shopeeRawData);
      const uniqueShopee = new Set(shopeeOrders.map(o => o.orderId));
      shopeeCount = uniqueShopee.size;
      allOrders = allOrders.concat(shopeeOrders);
    } catch (e) { console.error(e); }
  }

  if (wooRawData.length > 0 && typeof WooCommerceParser !== 'undefined') {
    try {
      const wooOrders = WooCommerceParser.parseWooData(wooRawData);
      const uniqueWoo = new Set(wooOrders.map(o => o.orderId));
      wooCount = uniqueWoo.size;
      allOrders = allOrders.concat(wooOrders);
    } catch (e) { console.error(e); }
  }

  if (allOrders.length === 0) return response('⚠️ 無有效訂單', isWebApp);

  // 2. 寫入 DB
  saveToSalesDatabase(allOrders);

  // 3. 寫入撿貨單
  saveToPickingList(allOrders);

  SpreadsheetApp.flush(); 

  // 4. 更新庫存並檢查超賣
  let invMsg = "";
  let alertMsg = "";
  let debugLog = "";
  
  if (typeof InventoryManager !== 'undefined') {
    try {
      // 接收回傳的查帳字串
      debugLog = InventoryManager.refreshDashboard();
      
      const oversoldList = InventoryManager.checkOversoldItems();
      if (oversoldList.length > 0) {
        const itemsStr = oversoldList.map(i => `${i.name}(${i.stock})`).join(', ');
        alertMsg = `\n🔥 嚴重警告：庫存不足！\n${itemsStr}`;
      }
      
      invMsg = "庫存已更新";
    } catch (e) {
      invMsg = "❌ 庫存計算失敗";
    }
  }

  const total = shopeeCount + wooCount;
  // 將 debugLog 加入回傳訊息
  return response(`✅ 成功！\n官網: ${wooCount} | 蝦皮: ${shopeeCount} | 總共: ${total}\n${alertMsg}\n\n${debugLog}`, isWebApp);
}

// ... (其餘函式 undoLastImport, saveToSalesDatabase 等保持不變) ...
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

  return response(`✅ 已回復上一步！\n刪除 ${deletedCount} 筆紀錄。\n庫存已復原。`, isWebApp);
}

function response(msg, isWebApp) {
  if (isWebApp) return msg;
  else { SpreadsheetApp.getUi().alert(msg); return msg; }
}

function saveToSalesDatabase(orders) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[03_銷售數據池]');
  const newRows = [];
  orders.forEach(order => {
    const items = expandSku(order.sku, order.qty);
    items.forEach(item => {
      newRows.push([order.date, order.platform, order.orderId, item.sku, item.qty, order.raw]);
    });
  });
  if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
}

function saveToPickingList(orders) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[05_撿貨單]');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();

  const ordersMap = {};
  orders.forEach(order => {
    const oid = order.orderId;
    if (!ordersMap[oid]) {
      ordersMap[oid] = { date: order.date, logistics: order.logistics, tracking: order.trackingNumber || "", platform: order.platform, items: {} };
    }
    const abbr = order.abbr || "?";
    if (!ordersMap[oid].items[abbr]) ordersMap[oid].items[abbr] = 0;
    ordersMap[oid].items[abbr] += order.qty;
  });

  const newRows = Object.keys(ordersMap).map(oid => {
    const o = ordersMap[oid];
    const itemStr = Object.entries(o.items).map(([abbr, qty]) => `${qty}${abbr}`).join(' ');
    
    let trackingDisplay = "";
    if (o.tracking && o.tracking.length >= 4) {
      trackingDisplay = o.tracking.slice(-4);
    } else {
      trackingDisplay = o.tracking;
    }

    let finalStr = itemStr;
    const isShopeeXpress = o.logistics.includes("蝦皮店到店");
    const isOneBig = (itemStr === "1大");

    if (trackingDisplay) {
      if ( !(isShopeeXpress && isOneBig) ) {
        finalStr += ` ${trackingDisplay}`;
      }
    }
    if (!isShopeeXpress) {
      finalStr += ` (${o.logistics})`;
    }

    return [o.date, finalStr, oid, o.logistics, o.platform];
  });

  if (newRows.length > 0) sheet.getRange(2, 1, newRows.length, 5).setValues(newRows);
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
    results.push({ sku: finalSku, qty: orderQty * multiplier });
  });
  return results;
}