/**
 * InventoryManager.gs (V2.6)
 * 修正：將函式包裝為物件 (Object)，以配合 main.gs 與 Code.gs 的呼叫。
 */

var InventoryManager = {
  
  // 設定檔
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
   * 主函式：重新計算並刷新儀表板
   */
  refreshDashboard: function() {
    const ss = SpreadsheetApp.openById("16IP78MRPyFg73ummLQT8skJV5LbbdEVYSwgFoIrtD5A");
    let ui = null;
    try { ui = SpreadsheetApp.getUi(); } catch (e) {}

    console.log("=== 開始計算庫存 (InventoryManager V2.6) ===");

    // --- Step 1: 讀取並彙整數據 ---
    
    // 1.1 讀取 SKU 對照表
    const skuMap = this._loadSkuMap(ss);
    
    // 1.2 彙整生產數據 (B欄=SKU, C欄=Qty)
    const productionMap = this._aggregateSheetData(ss, this.CONFIG.SHEET_NAMES.PRODUCTION, 1, 2);

    // 1.3 彙整銷售數據 (D欄=SKU, E欄=Qty)
    const salesMap = this._aggregateSheetData(ss, this.CONFIG.SHEET_NAMES.SALES, 3, 4);

    const dashboardRows = [];
    
    // --- Step 2: 計算邏輯 ---
    for (const [sku, info] of skuMap) {
      const prodQty = productionMap.get(sku) || 0;
      const salesQty = salesMap.get(sku) || 0;
      
      let currentStock = prodQty - salesQty;

      // Lifecycle Rule
      if (info.status === this.CONFIG.STATUS.SOFT_DELETE || info.status === this.CONFIG.STATUS.EOL) {
        currentStock = 0;
      }
      
      // Health Check
      let healthStatus = "✅ 正常";
      if (info.status !== this.CONFIG.STATUS.ACTIVE) {
        healthStatus = "❌ 已下架";
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

    // --- Step 3: 更新儀表板 ---
    const dashSheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.DASHBOARD);
    if (!dashSheet) {
      console.error("找不到儀表板工作表");
      return;
    }

    // 3.1 清空舊資料 (保留第一列 Header)
    const lastRow = dashSheet.getLastRow();
    if (lastRow > 1) {
      dashSheet.getRange(2, 1, lastRow - 1, 5).clearContent().clearFormat();
    }

    // 3.2 寫入新資料
    if (dashboardRows.length > 0) {
      dashSheet.getRange(2, 1, dashboardRows.length, 5).setValues(dashboardRows);
      
      // 3.3 格式美化 (簡單版)
      const range = dashSheet.getRange(2, 1, dashboardRows.length, 5);
      const backgrounds = [];
      const fontColors = [];
      
      for (let i = 0; i < dashboardRows.length; i++) {
        const rowData = dashboardRows[i];
        const stock = rowData[2];
        const status = rowData[3];
        
        let bg = '#FFFFFF';
        let font = '#000000';
        
        if (status !== this.CONFIG.STATUS.ACTIVE) {
          font = '#999999';
          bg = '#F3F3F3';
        } else if (stock <= this.CONFIG.LOW_STOCK_THRESHOLD) {
          bg = '#F4C7C3'; // 紅底
        }
        
        // 填滿 5 格
        backgrounds.push([bg, bg, bg, bg, bg]);
        fontColors.push([font, font, font, font, font]);
      }
      
      range.setBackgrounds(backgrounds);
      range.setFontColors(fontColors);
      range.setHorizontalAlignment('center');
      // 名稱靠左
      dashSheet.getRange(2, 1, dashboardRows.length, 1).setHorizontalAlignment('left');
    }

    console.log(`庫存計算完成，共更新 ${dashboardRows.length} 筆 SKU`);
  },

  /**
   * 輔助：讀取 SKU 對照表
   */
  _loadSkuMap: function(ss) {
    const sheet = ss.getSheetByName(this.CONFIG.SHEET_NAMES.SKU_MAP);
    const lastRow = sheet.getLastRow();
    const map = new Map();
    
    if (lastRow < 2) return map;
    
    // A~F (A=SKU, B=Name, F=Status)
    const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    
    const ACTIVE = this.CONFIG.STATUS.ACTIVE;
    
    data.forEach(row => {
      const sku = String(row[0]).trim();
      if (sku) {
        map.set(sku, {
          name: row[1],
          status: row[5] || ACTIVE
        });
      }
    });
    return map;
  },

  /**
   * 輔助：彙整 Sheet 數量
   */
  _aggregateSheetData: function(ss, sheetName, skuColIdx, qtyColIdx) {
    const sheet = ss.getSheetByName(sheetName);
    const map = new Map();
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) return map;
    
    const maxCols = Math.max(skuColIdx, qtyColIdx) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, maxCols).getValues();
    
    data.forEach(row => {
      const sku = String(row[skuColIdx]).trim();
      const qty = Number(row[qtyColIdx]);
      
      if (sku && !isNaN(qty)) {
        const current = map.get(sku) || 0;
        map.set(sku, current + qty);
      }
    });
    return map;
  }
};