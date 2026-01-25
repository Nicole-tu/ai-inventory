/**
 * main.gs (V2.7_CleanDisplay)
 * 修改重點：優化撿貨單顯示邏輯，針對「1大 + 蝦皮店到店」進行極簡化顯示。
 */

function generateDailyPickingList(isWebApp = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stagingSheet = ss.getSheetByName('[00_數據暫存區]');
  if (!stagingSheet) return response("❌ 錯誤：找不到 [00_數據暫存區]", isWebApp);

  // 1. 讀取資料
  const shopeeRawData = stagingSheet.getRange("A2:A").getValues().flat().filter(String).join("\n");
  const lastRow = stagingSheet.getLastRow();
  // 官網讀取 C~J 欄
  const wooRawData = lastRow > 1 ? stagingSheet.getRange(2, 3, lastRow - 1, 8).getValues() : [];

  let allOrders = [];
  let errorLog = [];

  // 2. 解析蝦皮
  if (shopeeRawData && typeof ShopeeTextParser !== 'undefined') {
    try {
      const shopeeOrders = ShopeeTextParser.parseShopeeData(shopeeRawData);
      allOrders = allOrders.concat(shopeeOrders);
    } catch (e) {
      console.error("蝦皮解析錯誤: " + e.toString());
      errorLog.push("蝦皮解析部分失敗");
    }
  }

  // 3. 解析官網
  if (wooRawData.length > 0 && typeof WooCommerceParser !== 'undefined') {
    try {
      const wooOrders = WooCommerceParser.parseWooData(wooRawData);
      allOrders = allOrders.concat(wooOrders);
    } catch (e) {
      console.error("官網解析錯誤: " + e.toString());
      errorLog.push("官網解析部分失敗");
    }
  }

  if (allOrders.length === 0) {
    return response('⚠️ 暫存區無有效訂單 (或解析器未抓到資料)', isWebApp);
  }

  // 4. 寫入銷售 DB (維持炸開扣庫存)
  saveToSalesDatabase(allOrders);

  // 5. 寫入撿貨單 (套用新的極簡邏輯)
  saveToPickingList(allOrders);

  SpreadsheetApp.flush(); 

  // 6. 更新庫存
  let invMsg = "";
  if (typeof InventoryManager !== 'undefined') {
    try {
      InventoryManager.refreshDashboard();
      invMsg = "庫存已更新";
      console.log("✅ 庫存儀表板重算完成");
    } catch (e) {
      console.error("庫存更新失敗: " + e.toString());
      invMsg = "❌ 庫存更新失敗";
      errorLog.push("庫存沒扣成功: " + e.message);
    }
  } else {
    invMsg = "❌ 找不到 InventoryManager";
  }

  const finalStatus = errorLog.length > 0 ? "⚠️ 部分有誤" : "✅ 成功";
  return response(`${finalStatus}！\n共產出 ${allOrders.length} 筆撿貨單。\n[${invMsg}]`, isWebApp);
}

// ... (undoLastImport 保持不變) ...
function undoLastImport(isWebApp = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

  if (orderIdsToRemove.length === 0) return response("⚠️ 無法識別訂單號，無法復原。", isWebApp);

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
  if (pickSheet.getLastRow() > 1) pickSheet.getRange(2, 1, pickSheet.getLastRow() - 1, 4).clearContent();

  try { if (typeof InventoryManager !== 'undefined') InventoryManager.refreshDashboard(); } catch (e) {}

  return response(`✅ 已回復上一步！\n刪除 ${deletedCount} 筆紀錄。\n庫存已復原。`, isWebApp);
}

function response(msg, isWebApp) {
  if (isWebApp) return msg;
  else { SpreadsheetApp.getUi().alert(msg); return msg; }
}

function saveToSalesDatabase(orders) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('[03_銷售數據池]');
  const newRows = [];
  orders.forEach(order => {
    const items = expandSku(order.sku, order.qty);
    items.forEach(item => {
      newRows.push([order.date, order.platform, order.orderId, item.sku, item.qty, order.raw]);
    });
  });
  if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
}

/**
 * 寫入 [05_撿貨單]
 * 修改：套用極簡化顯示邏輯
 */
function saveToPickingList(orders) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('[05_撿貨單]');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clearContent();

  const ordersMap = {};
  orders.forEach(order => {
    const oid = order.orderId;
    if (!ordersMap[oid]) {
      ordersMap[oid] = { date: order.date, logistics: order.logistics, tracking: order.trackingNumber || "", items: {} };
    }
    const abbr = order.abbr || "?";
    if (!ordersMap[oid].items[abbr]) ordersMap[oid].items[abbr] = 0;
    ordersMap[oid].items[abbr] += order.qty;
  });

  const newRows = Object.keys(ordersMap).map(oid => {
    const o = ordersMap[oid];
    const itemStr = Object.entries(o.items).map(([abbr, qty]) => `${qty}${abbr}`).join(' ');
    
    // 取得物流單號後4碼
    let trackingDisplay = "";
    if (o.tracking && o.tracking.length >= 4) {
      trackingDisplay = o.tracking.slice(-4);
    } else {
      trackingDisplay = o.tracking;
    }

    // --- 極簡顯示邏輯開始 ---
    let finalStr = itemStr;
    const isShopeeXpress = o.logistics.includes("蝦皮店到店");
    const isOneBig = (itemStr === "1大"); // 嚴格比對是否剛好是 "1大"

    // 1. 處理單號顯示
    // 規則：如果是 (蝦皮店到店 且 1大)，則隱藏單號；否則都要顯示
    if (trackingDisplay) {
      if ( !(isShopeeXpress && isOneBig) ) {
        finalStr += ` ${trackingDisplay}`;
      }
    }

    // 2. 處理物流名稱顯示
    // 規則：如果是 蝦皮店到店，則隱藏名稱；否則都要顯示
    if (!isShopeeXpress) {
      finalStr += ` (${o.logistics})`;
    }
    // --- 極簡顯示邏輯結束 ---

    return [o.date, finalStr, oid, o.logistics];
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
    results.push({ sku: finalSku, qty: orderQty * multiplier });
  });
  return results;
}