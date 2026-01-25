/**
 * WooCommerceParser.gs (V2.3)

 * 
 * 核心變更：
 * 1. 修正物流商欄位: H欄 (Idx 5).
 * 2. 修正單號欄位: I欄 (Idx 6).
 * 3. 輸出格式: 嚴格控制 4 欄 [日期, 撿貨字串, 訂單號, 物流商].
 */

const WOO_CONFIG = {
  SHEET_NAMES: {
    TEMP_DATA: '[00_數據暫存區]',
    SALES_DATA: '[03_銷售數據池]',
    SKU_MAP: '[04_SKU對照表]',
    PICKING_LIST: '[05_撿貨單]'
  }
};

/**
 * 解析官網數據 (V5.0)
 * @param {boolean} isAppend - 是否為附加模式 (預設 true)
 * @returns {number} - 處理的訂單數量
 */
function parseWooData(isAppend = true) {
  const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
  
  // 1. 讀取暫存區
  const tempSheet = ss.getSheetByName(WOO_CONFIG.SHEET_NAMES.TEMP_DATA);
  const lastRow = tempSheet.getLastRow();
  if (lastRow < 2) return 0;

  // 讀取範圍: Row 2 ~ LastRow, Col 3(C) ~ Col 9(I) (共7欄)
  // Indices (relative to C):
  // 0:C, 1:D(訂單), 2:E(商品), 3:F, 4:G(狀態), 5:H(運送至/物流商), 6:I(單號)
  const dataValues = tempSheet.getRange(2, 3, lastRow - 1, 7).getValues();

  Logger.log(`>>> [Woo V5.0] 開始解析表格，共 ${dataValues.length} 列`);

  const skuMapData = _getWooSkuMap(ss);
  
  const allSalesEntries = [];
  const allPickingEntries = [];
  const today = new Date();

  // 2. 逐列處理
  for (let i = 0; i < dataValues.length; i++) {
    const row = dataValues[i];
    
    // --- A. 基礎檢查 ---
    // 訂單號 (Idx 1 / D欄)
    if (!row[1]) continue;
    
    // 提取訂單數字
    const orderIdMatch = String(row[1]).match(/#(\d+)/);
    if (!orderIdMatch) continue; 
    const orderId = orderIdMatch[1];

    // 狀態檢查 (Idx 4 / G欄)
    const status = String(row[4]);
    if (status.includes("已取消") || status.includes("失敗")) {
      Logger.log(`   > 跳過已取消/失敗訂單 #${orderId}`);
      continue;
    }

    // --- B. 物流資訊 ---
    // 物流商 (Idx 5 / H欄 "運送至")
    const shippingInfoRaw = String(row[5]);
    let logisticsProvider = ''; 
    
    if (shippingInfoRaw.includes('7-ELEVEN')) logisticsProvider = '7-ELEVEN';
    else if (shippingInfoRaw.includes('全家')) logisticsProvider = '全家';
    else if (shippingInfoRaw.includes('萊爾富')) logisticsProvider = '萊爾富';
    else if (shippingInfoRaw.includes('OK')) logisticsProvider = 'OK';
    // 其他 -> ""

    // 物流單號 (Idx 6 / I欄 "物流單號")
    const trackingRaw = String(row[6]);
    // 抓取字串末尾 4 碼
    const trackMatch = trackingRaw.match(/(\d{4})\s*$/);
    let trackingLast4 = '';
    if (trackMatch) {
       trackingLast4 = trackMatch[1];
    } else {
       // 備用: 若無末尾符合，嘗試抓取任意10碼以上數字的末4碼
       const backup = trackingRaw.match(/(\d{10,})/);
       if (backup) trackingLast4 = backup[1].slice(-4);
    }

    // --- C. 商品解析 (Idx 2 / E欄) ---
    const productBlob = String(row[2]);
    const lines = productBlob.split('\n').map(l => l.trim()).filter(l => l);
    
    const pickingAggregator = new Map();
    
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const qtyMatch = line.match(/^Quantity:\s*[×x]\s*(\d+)/i);
      
      if (qtyMatch) {
        const rawQty = parseInt(qtyMatch[1], 10);
        
        // Look Behind: 上一行
        if (j > 0) {
          const variantName = lines[j-1]; // 上一行即商品名
          
          const explodedItems = _processWooSkuLogic(variantName, rawQty, skuMapData);
          
          explodedItems.forEach(item => {
            // Sales Collection
            allSalesEntries.push([
              today,
              'WooCommerce',
              orderId,
              item.sku,
              item.qty,
              variantName
            ]);
            
            // Picking Aggregation
            const abbr = item.abbr;
            const currentTotal = pickingAggregator.get(abbr) || 0;
            pickingAggregator.set(abbr, currentTotal + item.qty);
          });
        }
      }
    }

    // --- D. 生成撿貨字串 ---
    if (pickingAggregator.size > 0) {
      let pickStr = "";
      for (const [abbr, qty] of pickingAggregator) {
        pickStr += `${qty}${abbr}`;
      }
      
      if (trackingLast4) {
        pickStr += ` ${trackingLast4}`;
      }
      
      if (logisticsProvider) {
        pickStr += ` (${logisticsProvider})`;
      }

      // 嚴格輸出 4 欄
      allPickingEntries.push([
        today,
        pickStr,
        orderId,
        logisticsProvider
      ]);
      
      Logger.log(`     成功解析 #${orderId}: ${pickStr}`);
    } else {
      Logger.log(`     [Warning] 訂單 #${orderId} 未解析出商品`);
    }
  }

  // 3. 寫入資料
  if (allSalesEntries.length > 0) {
    const salesSheet = ss.getSheetByName(WOO_CONFIG.SHEET_NAMES.SALES_DATA);
    const lastRowSales = salesSheet.getLastRow();
    salesSheet.getRange(lastRowSales + 1, 1, allSalesEntries.length, allSalesEntries[0].length)
      .setValues(allSalesEntries);
  }

  if (allPickingEntries.length > 0) {
    const pickSheet = ss.getSheetByName(WOO_CONFIG.SHEET_NAMES.PICKING_LIST);
    const lastRowPick = pickSheet.getLastRow();
    pickSheet.getRange(lastRowPick + 1, 1, allPickingEntries.length, allPickingEntries[0].length)
      .setValues(allPickingEntries);
  }

  return allPickingEntries.length;
}

// --- Helpers (Same as before) ---

function _getWooSkuMap(ss) {
  const sheet = ss.getSheetByName(WOO_CONFIG.SHEET_NAMES.SKU_MAP);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return data.map(row => ({
    internalSku: String(row[0]).trim(),
    abbr: String(row[2]).trim(),
    officialKey: String(row[4]).trim()
  })).filter(item => item.officialKey !== "");
}

function _processWooSkuLogic(variantName, qty, mapData) {
  const match = mapData.find(m => variantName.includes(m.officialKey));
  
  if (!match) return [{ sku: 'UNKNOWN', qty: qty, abbr: '?' }];
  
  const results = [];
  const subTokens = match.internalSku.split(',');
  
  subTokens.forEach(token => {
    let sku = token.trim();
    let multiplier = 1;
    if (sku.includes('*')) {
      const parts = sku.split('*');
      sku = parts[0].trim();
      multiplier = parseInt(parts[1], 10) || 1;
    }
    
    const subItemParams = mapData.find(m => m.internalSku === sku);
    let finalAbbr = subItemParams ? subItemParams.abbr : match.abbr; 
    if (!finalAbbr) finalAbbr = '?';

    results.push({
      sku: sku,
      qty: qty * multiplier,
      abbr: finalAbbr
    });
  });
  
  return results;
}
