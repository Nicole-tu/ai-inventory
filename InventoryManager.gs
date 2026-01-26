/**
 * InventoryManager.gs (V2.8.1)
 * 修正：將查帳結果 (Debug Log) 回傳，讓前端可以直接顯示算式。
 */

var InventoryManager = {
  
  CONFIG: {
    SHEET_NAMES: {
      DASHBOARD: '[00_儀表板]',
      PRODUCTION: '[02_生產紀錄]',
      SALES: '[03_銷售數據池]',
      SKU_MAP: '[04_SKU對照表]'
    },
    STATUS: {
      ACTIVE: 'Active',
      SOFT_DELETE: 'Soft_Delete',
      EOL: 'EOL'
    },
    LOW_STOCK_THRESHOLD: 5
  },

  /**
   * 刷新儀表板
   * @return {string} 查帳日誌 (Debug Info)
   */
  refreshDashboard: function() {
    const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    console.log("=== [V2.8.1] 開始計算庫存 ===");

    // 1. 讀取資料
    const skuMap = this._loadSkuMap(ss);
    const productionMap = this._aggregateSheetData(ss, this.CONFIG.SHEET_NAMES.PRODUCTION, 1, 2);
    const salesMap = this._aggregateSheetData(ss, this.CONFIG.SHEET_NAMES.SALES, 3, 4);

    // --- 🕵️‍♂️ Debug 專區：查帳 wo_oil_100 ---
    // 這次我們把訊息存起來，回傳給前端看
    let debugInfo = "";
    const debugTarget = "wo_oil_100";
    
    if (skuMap.has(debugTarget)) {
      const p = productionMap.get(debugTarget) || 0;
      const s = salesMap.get(debugTarget) || 0;
      const finalStock = p - s;
      debugInfo = `🔍 [查帳] ${debugTarget}\n生產 ${p} - 銷售 ${s} = 剩 ${finalStock}`;
      console.log(debugInfo);
    } else {
      debugInfo = `⚠️ [查帳] 找不到 ${debugTarget} (請檢查 SKU 大小寫或空白)`;
      console.warn(debugInfo);
    }
    // ------------------------------------

    const dashboardRows = [];
    
    // 2. 計算邏輯
    for (const [sku, info] of skuMap) {
      const prodQty = productionMap.get(sku) || 0;
      const salesQty = salesMap.get(sku) || 0;
      
      let currentStock = prodQty - salesQty;

      // 狀態過濾
      if (info.status === this.CONFIG.STATUS.SOFT_DELETE || info.status === this.CONFIG.STATUS.EOL) {
        currentStock = 0;
      }
      
      // 燈號判斷
      let healthStatus = "✅ 正常";
      if (info.status !== this.CONFIG.STATUS.ACTIVE) {
        healthStatus = "❌ 已下架";
      } else if (currentStock < 0) {
        healthStatus = "🔥 超賣警示";
      } else if (currentStock <= this.CONFIG.LOW_STOCK_THRESHOLD) {
        healthStatus = "⚠️ 需補貨";
      }

      dashboardRows.push([
        info.name,
        sku,
        currentStock,
        info.status,
        healthStatus
      ]);
    }

    // 3. 寫入儀表板
    const dashSheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.DASHBOARD);
    if (dashSheet) {
      const lastRow = dashSheet.getLastRow();
      if (lastRow > 1) dashSheet.getRange(2, 1, lastRow - 1, 5).clearContent().clearFormat();
      
      if (dashboardRows.length > 0) {
        dashSheet.getRange(2, 1, dashboardRows.length, 5).setValues(dashboardRows);
        
        // 格式化
        const range = dashSheet.getRange(2, 1, dashboardRows.length, 5);
        range.setHorizontalAlignment('center');
        dashSheet.getRange(2, 1, dashboardRows.length, 1).setHorizontalAlignment('left');
      }
    }
    console.log("✅ 庫存儀表板更新完成");
    
    return debugInfo; // 回傳查帳訊息
  },

  /**
   * 檢查是否有超賣商品
   */
  checkOversoldItems: function() {
    const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    const sheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.DASHBOARD);
    if (!sheet) return [];
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    
    const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); 
    const oversold = [];
    
    data.forEach(row => {
      if (parseInt(row[2]) < 0) {
        oversold.push({ name: row[0], stock: row[2] });
      }
    });
    return oversold;
  },

  _loadSkuMap: function(ss) {
    const sheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.SKU_MAP);
    const lastRow = sheet.getLastRow();
    const map = new Map();
    if (lastRow < 2) return map;
    
    const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    data.forEach(row => {
      const sku = this._cleanSku(row[0]);
      if (sku) {
        map.set(sku, {
          name: row[1],
          status: row[5] || this.CONFIG.STATUS.ACTIVE
        });
      }
    });
    return map;
  },

  _aggregateSheetData: function(ss, sheetName, skuColIdx, qtyColIdx) {
    const sheet = ss.getSheetByName(sheetName);
    const map = new Map();
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) return map;
    
    const maxCols = Math.max(skuColIdx, qtyColIdx) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, maxCols).getValues();
    
    data.forEach(row => {
      const sku = this._cleanSku(row[skuColIdx]);
      const qty = Number(row[qtyColIdx]);
      
      if (sku && !isNaN(qty)) {
        const current = map.get(sku) || 0;
        map.set(sku, current + qty);
      }
    });
    return map;
  },

  _cleanSku: function(rawSku) {
    if (!rawSku) return "";
    return String(rawSku).trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  }
};