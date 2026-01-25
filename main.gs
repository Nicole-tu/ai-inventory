/**
 * main.gs (V2.9_Stats)
 * 新增：分別統計平台訂單數，並將平台資訊寫入撿貨單(E欄)供前端顯示。
 */

function generateDailyPickingList(isWebApp = false) {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  const stagingSheet = ss.getSheetByName('[00_數據暫存區]');
  if (!stagingSheet) return response("❌ 錯誤：找不到 [00_數據暫存區]", isWebApp);

  const shopeeRawData = stagingSheet.getRange("A2:A").getValues().flat().filter(String).join("\n");
  const lastRow = stagingSheet.getLastRow();
  const wooRawData = lastRow > 1 ? stagingSheet.getRange(2, 3, lastRow - 1, 8).getValues() : [];

  let allOrders = [];
  let shopeeCount = 0;
  let wooCount = 0;
  let errorLog = [];

  // 1. 解析蝦皮
  if (shopeeRawData && typeof ShopeeTextParser !== 'undefined') {
    try {
      const shopeeOrders = ShopeeTextParser.parseShopeeData(shopeeRawData);
      shopeeCount = shopeeOrders.length;
      allOrders = allOrders.concat(shopeeOrders);
    } catch (e) {
      console.error("蝦皮解析錯誤: " + e.toString());
      errorLog.push("蝦皮解析部分失敗");
    }
  }

  // 2. 解析官網
  if (wooRawData.length > 0 && typeof WooCommerceParser !== 'undefined') {
    try {
      const wooOrders = WooCommerceParser.parseWooData(wooRawData);
      // 依 OrderID 去重 (避免同一張單多商品被算成多筆訂單數? 這裡 wooOrders 是 Item 層級)
      // 但使用者通常看的是「訂單數」還是「商品數」？
      // 根據 parseWooData 回傳的是 Item Array。
      // 為了統計準確，我們先算 Item 數，或後續再 Unique OrderID。
      // 這裡簡單回傳 Item 數即可，或者可以做 Set 統計 Unique OrderID
      const uniqueWoo = new Set(wooOrders.map(o => o.orderId));
      wooCount = uniqueWoo.size; // 統計「單數」比較符合直覺
      
      allOrders = allOrders.concat(wooOrders);
    } catch (e) {
      console.error("官網解析錯誤: " + e.toString());
      errorLog.push("官網解析部分失敗");
    }
  }
  
  // 修正蝦皮計數為「單數」
  const uniqueShopee = new Set(allOrders.filter(o => o.platform === 'Shopee').map(o => o.orderId));
  shopeeCount = uniqueShopee.size;

  if (allOrders.length === 0) {
    return response('⚠️ 暫存區無有效訂單', isWebApp);
  }

  // 3. 寫入 DB
  saveToSalesDatabase(allOrders);

  // 4. 寫入撿貨單 (包含平台資訊)
  saveToPickingList(allOrders);

  SpreadsheetApp.flush(); 

  // 5. 更新庫存
  let invMsg = "";
  if (typeof InventoryManager !== 'undefined') {
    try {
      InventoryManager.refreshDashboard();
      invMsg = "庫存已更新";
    } catch (e) {
      invMsg = "❌ 庫存更新失敗";
    }
  }

  // 回傳詳細統計字串
  const totalOrders = shopeeCount + wooCount;
  const statMsg = `官網 ${wooCount} 筆，蝦皮 ${shopeeCount} 筆，總共: ${totalOrders} 筆`;
  
  return response(`✅ 成功！\n${statMsg}\n[${invMsg}]`, isWebApp);
}

// ... (undoLastImport 保持不變) ...
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
  if (pickSheet.getLastRow() > 1) pickSheet.getRange(2, 1, pickSheet.getLastRow() - 1, 5).clearContent(); // 清空 5 欄

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

/**
 * 寫入 [05_撿貨單] (修改版)
 * 增加第 5 欄：平台 (Shopee/WooCommerce)
 */
function saveToPickingList(orders) {
  const sheet = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A").getSheetByName('[05_撿貨單]');
  // 清空舊資料 (範圍擴大到 5 欄)
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();

  const ordersMap = {};
  orders.forEach(order => {
    const oid = order.orderId;
    if (!ordersMap[oid]) {
      // 記錄 platform
      ordersMap[oid] = { 
        date: order.date, 
        logistics: order.logistics, 
        tracking: order.trackingNumber || "", 
        platform: order.platform, 
        items: {} 
      };
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

    // 回傳 5 個欄位：[日期, 撿貨碼, 訂單號, 物流, 平台]
    return [o.date, finalStr, oid, o.logistics, o.platform];
  });

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, 5).setValues(newRows);
  }
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